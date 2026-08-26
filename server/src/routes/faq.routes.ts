import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { prisma } from "../prisma";
import { generateFaqReply, generateFaqKeywords } from "../drafting/draftGenerator";
import { ClaudeClient } from "../drafting/claudeClient";
import { loadDraftingConfig } from "../drafting/config";

export const faqRouter = Router();

faqRouter.use(authenticateJwt);

// POST /api/faq/check — button-triggered: takes the lead's latest reply text
// and looks it up against faq_entries via ranked full-text + trigram match
// (structured lookup, not vector RAG). Only if the match clears a confidence
// floor does it call the drafting service to phrase the matched answer;
// otherwise it returns match:false. Never auto-sends -- the frontend only
// autofills the compose box, which still requires a human Send click.
faqRouter.post("/check", async (req: Request, res: Response) => {
  try {
    const { leadMessage } = req.body || {};
    if (!leadMessage || typeof leadMessage !== "string" || !leadMessage.trim()) {
      return res.status(400).json({ error: "MISSING_LEAD_MESSAGE", message: "leadMessage is required" });
    }

    const matches = await prisma.$queryRaw<
      Array<{ id: string; question: string; answer: string; rank: number; sim: number }>
    >`
      SELECT id, question, answer,
        ts_rank(search_vector, plainto_tsquery('english', ${leadMessage})) AS rank,
        similarity(question, ${leadMessage}) AS sim
      FROM faq_entries
      WHERE is_active = true
        AND (search_vector @@ plainto_tsquery('english', ${leadMessage})
             OR similarity(question, ${leadMessage}) > 0.25)
      ORDER BY rank DESC, sim DESC
      LIMIT 1
    `;

    const top = matches[0];
    // Both thresholds must be met: rank >= 0.3 AND similarity >= 0.4.
    // This prevents loose matches like "contract" matching FAQ about "training"
    // just because both mention generic business terms.
    if (!top || top.rank < 0.3 || top.sim < 0.4) {
      return res.json({ match: false });
    }

    let phrased;
    try {
      const draftingConfig = loadDraftingConfig();
      const client = new ClaudeClient(draftingConfig);
      phrased = await generateFaqReply(client, draftingConfig, leadMessage, top.question, top.answer);
      if (!phrased || typeof phrased.body !== "string" || !phrased.body.trim()) {
        throw new Error("FAQ reply generation returned an unexpected response shape");
      }
    } catch (err: any) {
      return res.status(502).json({
        error: "FAQ_GENERATION_FAILED",
        message: `Could not generate FAQ reply: ${err.message || "unknown error"}`,
      });
    }

    return res.json({ match: true, answer: phrased.body, matchedQuestion: top.question });
  } catch (err: any) {
    const status = err.statusCode || 500;
    const code = err.code || "FAQ_CHECK_FAILED";
    return res.status(status).json({ error: code, message: err.message || "Failed to check FAQ" });
  }
});

// All three fields required on create -- unlike the PATCH schema below, there is
// no prior record to fall back on. `tags` is not accepted from the client: it is
// filled by auto-tagging so FAQs stay searchable without manual curation.
const createFaqSchema = z.object({
  category: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
});

// Every field optional (PATCH semantics), but at least one must be present --
// an empty body would otherwise be a no-op UPDATE that still bumps updated_at.
const updateFaqSchema = z
  .object({
    category: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

// GET /api/faq — list all active FAQs, newest first.
faqRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const faqEntries = await prisma.faqEntry.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ faqEntries });
  })
);

// GET /api/faq/:id — single FAQ.
faqRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const faqEntry = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!faqEntry) throw new ApiError(404, "FAQ_NOT_FOUND", "FAQ entry not found");
    return res.json({ faqEntry });
  })
);

// POST /api/faq — create an FAQ with auto-generated keywords. Owner only.
// Keyword generation is best-effort: if Claude is unreachable or returns nothing
// usable, the FAQ is still created (with no tags) and keywordsGenerated is false,
// so a drafting-service outage never blocks FAQ authoring.
faqRouter.post(
  "/",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, question, answer } = createFaqSchema.parse(req.body);

    let tags: string[] = [];
    let keywordsGenerated = false;
    try {
      const draftingConfig = loadDraftingConfig();
      const client = new ClaudeClient(draftingConfig);
      const result = await generateFaqKeywords(client, draftingConfig, question, answer);
      tags = result.keywords;
      keywordsGenerated = tags.length > 0;
    } catch (err: any) {
      console.warn("[faqRouter] Keyword generation failed, creating FAQ without tags:", err.message);
    }

    const faqEntry = await prisma.faqEntry.create({
      data: {
        id: `faq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        category,
        question,
        answer,
        tags,
        isActive: true,
      },
    });

    return res.status(201).json({ faqEntry, keywordsGenerated });
  })
);

// PATCH /api/faq/:id — update provided fields only. Owner only.
faqRouter.patch(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const patch = updateFaqSchema.parse(req.body);

    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "FAQ_NOT_FOUND", "FAQ entry not found");

    const faqEntry = await prisma.faqEntry.update({ where: { id: req.params.id }, data: patch });
    return res.json({ faqEntry });
  })
);

// DELETE /api/faq/:id — soft delete (isActive: false), never a hard delete. Owner only.
faqRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "FAQ_NOT_FOUND", "FAQ entry not found");

    await prisma.faqEntry.update({ where: { id: req.params.id }, data: { isActive: false } });
    return res.json({ success: true });
  })
);
