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
import { extractQuestions, extractKeywords, deduplicateMatches } from "../lib/questionExtractor";

export const faqRouter = Router();

faqRouter.use(authenticateJwt);

// POST /api/faq/check — button-triggered: takes the lead's latest reply text,
// extracts individual questions, and looks them up against faq_entries via
// ranked full-text + trigram + tag match. Loosened thresholds for multilingual
// leads (non-native English, minimal punctuation). Combines matching answers
// into one response and flags unanswered questions. Returns match: "full"|"partial"|"none".
faqRouter.post("/check", async (req: Request, res: Response) => {
  try {
    const { leadMessage } = req.body || {};
    if (!leadMessage || typeof leadMessage !== "string" || !leadMessage.trim()) {
      return res.status(400).json({ error: "MISSING_LEAD_MESSAGE", message: "leadMessage is required" });
    }

    // Extract individual questions from the lead message (max 5)
    const extractedQuestions = extractQuestions(leadMessage);

    // Also extract FAQ keywords for better coverage of run-on sentences
    const extractedKeywords = extractKeywords(leadMessage);

    // Search each question independently
    const allMatches: Array<{
      originalQuestion: string;
      faqId?: string;
      question?: string;
      answer?: string;
      rank?: number;
      sim?: number;
      tag_match?: number;
    }> = [];

    // Combine questions and keywords for searching
    const searchTerms = [...extractedQuestions, ...extractedKeywords];

    for (const question of searchTerms) {
      const matches = await prisma.$queryRaw<
        Array<{ id: string; question: string; answer: string; rank: number; sim: number; tag_match: number }>
      >`
        SELECT id, question, answer,
          ts_rank(search_vector, plainto_tsquery('english', ${question})) AS rank,
          similarity(question, ${question}) AS sim,
          CASE
            WHEN array_to_string(tags, ' ') ILIKE '%' || ${question} || '%' THEN 1
            ELSE 0
          END AS tag_match
        FROM faq_entries
        WHERE is_active = true
          AND (search_vector @@ plainto_tsquery('english', ${question})
               OR similarity(question, ${question}) > 0.25
               OR array_to_string(tags, ' ') ILIKE '%' || ${question} || '%')
        ORDER BY tag_match DESC, rank DESC, sim DESC
        LIMIT 1
      `;

      const top = matches[0];
      // Loosened thresholds for multilingual leads (non-native English, no punctuation)
      // Tag matches always pass; non-tag matches use OR logic to catch more variations
      if (top && (top.tag_match === 1 || top.rank >= 0.2 || top.sim >= 0.3)) {
        allMatches.push({
          originalQuestion: question,
          faqId: top.id,
          question: top.question,
          answer: top.answer,
          rank: top.rank,
          sim: top.sim,
          tag_match: top.tag_match,
        });
      } else {
        // No match for this question
        allMatches.push({ originalQuestion: question });
      }
    }

    // Deduplicate: same FAQ matching multiple questions shows only once
    const deduped = deduplicateMatches(allMatches);
    const matchedFaqs = Array.from(deduped.values());
    const unansweredQuestions = allMatches.filter((m) => !m.faqId).map((m) => m.originalQuestion);

    // No matches at all
    if (matchedFaqs.length === 0) {
      return res.json({ match: "none", answers: [], unansweredQuestions });
    }

    // Generate combined response using Claude
    let phrased;
    try {
      const draftingConfig = loadDraftingConfig();
      const client = new ClaudeClient(draftingConfig);
      phrased = await generateFaqReply(client, draftingConfig, leadMessage, matchedFaqs, unansweredQuestions);
      if (!phrased || typeof phrased.body !== "string" || !phrased.body.trim()) {
        throw new Error("FAQ reply generation returned an unexpected response shape");
      }
    } catch (err: any) {
      return res.status(502).json({
        error: "FAQ_GENERATION_FAILED",
        message: `Could not generate FAQ reply: ${err.message || "unknown error"}`,
      });
    }

    const matchType = unansweredQuestions.length === 0 ? "full" : "partial";
    return res.json({
      match: matchType,
      answer: phrased.body,
      answers: matchedFaqs.map((f) => ({ topic: f.question, answer: f.answer })),
      unansweredQuestions,
    });
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

// DELETE /api/faq/:id — hard delete. Owner only.
faqRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "FAQ_NOT_FOUND", "FAQ entry not found");

    await prisma.faqEntry.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  })
);
