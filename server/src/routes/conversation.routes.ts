import { Router, Request, Response } from "express";
import axios from "axios";
import { z } from "zod";
import { MessageSender, ConversationChannel } from "@prisma/client";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { config } from "../config";
import { UnipileService } from "../services/unipile.service";

export const conversationRouter = Router();

conversationRouter.use(authenticateJwt);
conversationRouter.use(requireRole("owner", "recruiter", "contractor"));

// UnipileService throws either a plain {statusCode, code, message} object or a
// generic Error -- never an ApiError -- so normalize before it reaches the
// central errorHandler (same pattern as email-queue.routes.ts / outreach.routes.ts).
function toApiError(err: any): ApiError {
  if (err instanceof ApiError) return err;
  const status = err?.statusCode || 500;
  const code = err?.code || "SEND_FAILED";
  const message = err?.message || "Failed to send message";
  return new ApiError(status, code, message);
}

// GET /api/conversations — full visibility: any recruiter/owner sees every
// conversation, not just their own (per the access model, no recruiterId filter here).
conversationRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const conversations = await prisma.conversation.findMany({
      include: {
        lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
      orderBy: { lastMessageAt: "desc" },
    });
    return res.json({ conversations });
  })
);

// GET /api/conversations/:id — single thread, messages ascending
conversationRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
    });
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    return res.json({ conversation });
  })
);

// POST /api/conversations — find-or-create the current recruiter's LinkedIn
// thread for a lead (mirrors POST /api/email-queue's "add lead" pattern), so
// the Conversations page can load a lead from search the same way the Email
// Queue page does, instead of misusing the email queue's own endpoint.
conversationRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { leadId } = z.object({ leadId: z.string().uuid() }).parse(req.body);

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    const existing = await prisma.conversation.findFirst({
      where: { leadId, recruiterId: req.user!.id, channel: ConversationChannel.LINKEDIN },
      include: {
        lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
    });
    if (existing) return res.json({ conversation: existing });

    const conversation = await prisma.conversation.create({
      data: {
        leadId: lead.id,
        recruiterId: req.user!.id,
        candidateName: lead.fullName || lead.displayName || "Candidate",
        candidateRole: lead.services.join(", ") || lead.targetLanguage || "Freelance Linguist",
        channel: ConversationChannel.LINKEDIN,
        unread: false,
      },
      include: {
        lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
    });

    return res.status(201).json({ conversation });
  })
);

// POST /api/conversations/:id/generate-draft — same real, facts-only AI
// personalization as email-queue.routes.ts's generate-draft, just channel:
// "linkedin". No hardcoded phrase is spliced in here -- the drafting service
// is given the lead's full enriched record and produces a genuinely
// personalized note. Stateless: there's no draft field on Conversation to
// persist to, so this just returns the generated body for the client to hold
// in its compose box, same as the local template it's replacing did.
conversationRouter.post(
  "/:id/generate-draft",
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, recruiterId: req.user!.id },
      include: { lead: true },
    });
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

    let draft: { subject?: string | null; body: string };
    try {
      const response = await axios.post(
        `${config.draftingServiceUrl}/draft`,
        {
          lead: {
            First_Name: conversation.lead.firstName,
            Full_Name: conversation.lead.fullName,
            Country_of_Residence: conversation.lead.country,
            Source: conversation.lead.source,
            Profile_Link: conversation.lead.profileLink,
            Email_Address: conversation.lead.email,
            Services: conversation.lead.services.join(", "),
            Source_Language: conversation.lead.sourceLanguage,
            Target_Language: conversation.lead.targetLanguage,
            Secondary_Languages: conversation.lead.secondaryLanguages.join(", "),
            Years_of_Exp: conversation.lead.yearsOfExperience ? conversation.lead.yearsOfExperience.toNumber() : null,
            Vendor_Experience: conversation.lead.vendorExperience,
            Enrichment_Status: conversation.lead.enrichmentStatus,
          },
          channel: "linkedin",
        },
        { timeout: 20_000 }
      );
      draft = response.data;
      if (!draft || typeof draft.body !== "string") {
        throw new Error("Drafting service returned an unexpected response shape");
      }
      if (response.data.verdict === "INELIGIBLE" || !draft.body.trim()) {
        const reason = (response.data.flags || [])[0] || "missing required lead data";
        throw new ApiError(
          422,
          "LEAD_NOT_DRAFT_ELIGIBLE",
          `Cannot draft for this lead yet (${reason}) — add the missing info to the lead first`
        );
      }
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        502,
        "DRAFTING_SERVICE_UNAVAILABLE",
        "Could not reach the drafting service — write the message manually"
      );
    }

    return res.json({ draft: { body: draft.body } });
  })
);

// POST /api/conversations/:id/messages — send a reply via Unipile, then log it
conversationRouter.post(
  "/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const { text, accountId, to } = z
      .object({ text: z.string().min(1), accountId: z.string().optional(), to: z.string().optional() })
      .parse(req.body);

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { lead: true },
    });
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

    if (conversation.channel !== ConversationChannel.LINKEDIN) {
      throw new ApiError(
        400,
        "UNSUPPORTED_CHANNEL",
        `In-app replies are only supported for LinkedIn conversations right now (this thread is ${conversation.channel})`
      );
    }

    const target = to || conversation.lead.profileLink;
    if (!target) throw new ApiError(400, "MISSING_LINKEDIN_PROFILE", "Lead has no LinkedIn profile link");

    try {
      await UnipileService.sendLinkedInMessage(req.user!.id, conversation.leadId, target, text, accountId);
    } catch (err: any) {
      // Never write the message as if it sent when the Unipile call failed.
      throw toApiError(err);
    }

    const message = await prisma.conversationMessage.create({
      data: { conversationId: conversation.id, sender: MessageSender.ME, text },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    return res.status(201).json({ message });
  })
);
