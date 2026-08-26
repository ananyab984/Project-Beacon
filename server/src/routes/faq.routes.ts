import { Router, Request, Response } from "express";
import { authenticateJwt } from "../middleware/auth";
import { prisma } from "../prisma";
import { generateFaqReply } from "../drafting/draftGenerator";
import { ClaudeClient } from "../drafting/claudeClient";
import { loadDraftingConfig } from "../drafting/config";

export const faqRouter = Router();

// POST /api/faq/check — button-triggered: takes the lead's latest reply text
// and looks it up against faq_entries via ranked full-text + trigram match
// (structured lookup, not vector RAG). Only if the match clears a confidence
// floor does it call the drafting service to phrase the matched answer;
// otherwise it returns match:false. Never auto-sends -- the frontend only
// autofills the compose box, which still requires a human Send click.
faqRouter.post("/check", authenticateJwt, async (req: Request, res: Response) => {
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
    // Starting thresholds, not calibrated against production data yet --
    // tune once you see real rank/sim values against the actual FAQ set.
    if (!top || (top.rank < 0.15 && top.sim < 0.3)) {
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
