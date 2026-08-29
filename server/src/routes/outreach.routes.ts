import { Router, Request, Response } from "express";
import { UnipileService } from "../services/unipile.service";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { prisma } from "../prisma";
import { toApiError } from "../lib/apiError";

export const outreachRouter = Router();

// POST /api/outreach/send — Sends outreach message via Unipile & records InteractionEvent
outreachRouter.post("/send", authenticateJwt, requireRole("owner", "recruiter", "contractor"), async (req: Request, res: Response) => {
  try {
    const { leadId, channel, to, subject, body, emailQueueId } = req.body || {};
    if (!leadId || !channel || !body) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "leadId, channel (LINKEDIN | EMAIL), and body are required" });
    }

    const userId = req.user!.id;
    const channelUpper = channel.toUpperCase();
    let result: any;

    if (channelUpper === "LINKEDIN") {
      const profileTarget = to || (await prisma.lead.findUnique({ where: { id: leadId } }))?.profileLink;
      if (!profileTarget) {
        return res.status(400).json({ error: "MISSING_LINKEDIN_PROFILE", message: "Lead has no LinkedIn profile link" });
      }
      result = await UnipileService.sendLinkedInMessage(userId, leadId, profileTarget, body);
    } else if (channelUpper === "EMAIL") {
      const emailTarget = to || (await prisma.lead.findUnique({ where: { id: leadId } }))?.email;
      if (!emailTarget) {
        return res.status(400).json({ error: "MISSING_EMAIL", message: "Lead has no email address" });
      }
      result = await UnipileService.sendEmail(userId, leadId, emailTarget, subject || "Outreach from Global3", body);
    } else {
      return res.status(400).json({ error: "INVALID_CHANNEL", message: "Channel must be LINKEDIN or EMAIL" });
    }

    // If an EmailQueueItem ID was provided, delete or update it in DB.
    // SECURITY: scoped by recruiterId -- a bare `where: { id: emailQueueId }`
    // would let any authenticated user delete ANY recruiter's queue item by
    // guessing/passing an arbitrary id, since nothing here confirms the id
    // actually belongs to the caller. deleteMany + recruiterId filter makes
    // it a no-op (not a 500) if it doesn't.
    if (emailQueueId) {
      try {
        await prisma.emailQueueItem.deleteMany({ where: { id: emailQueueId, recruiterId: userId } });
      } catch (err: any) {
        // Silently skip if item already deleted or doesn't exist
      }
    }

    return res.json({
      success: true,
      message: "Outreach message dispatched successfully via Unipile",
      result,
    });
  } catch (err: any) {
    const apiErr = toApiError(err);
    return res.status(apiErr.statusCode).json({ error: apiErr.code, message: apiErr.message });
  }
});
