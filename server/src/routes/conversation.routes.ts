import { Router, Request, Response } from "express";
import { z } from "zod";
import { MessageSender, ConversationChannel } from "@prisma/client";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { UnipileService } from "../services/unipile.service";
import { candidateRoleOf } from "../lib/messageTemplates";
import { buildDraftLeadPayload } from "../lib/draftLeadPayload";
import { getDraftingOrchestrator } from "../drafting/instance";

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

// GET /api/conversations — recruiter sees only their own; owner sees all.
conversationRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase();
    const where = role === "owner" ? {} : { recruiterId: req.user!.id };

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
      // Postgres defaults to NULLS FIRST for DESC, so threads with no
      // messages yet (lastMessageAt: null) would otherwise always outrank
      // ones with a real, more recent timestamp -- the opposite of "newest
      // activity at the top."
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    });
    return res.json({ conversations });
  })
);

// GET /api/conversations/by-lead/:leadId — look up a conversation by lead + optional channel
conversationRouter.get(
  "/by-lead/:leadId",
  asyncHandler(async (req: Request, res: Response) => {
    const { leadId } = req.params;
    const channel = (req.query.channel as string || "").toUpperCase();

    const role = req.user!.role.toLowerCase();
    const baseWhere: any = { leadId };
    if (role !== "owner") baseWhere.recruiterId = req.user!.id;
    if (channel) baseWhere.channel = channel;

    const conversation = await prisma.conversation.findFirst({
      where: baseWhere,
      include: {
        lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
      // Postgres defaults to NULLS FIRST for DESC, so threads with no
      // messages yet (lastMessageAt: null) would otherwise always outrank
      // ones with a real, more recent timestamp -- the opposite of "newest
      // activity at the top."
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    });

    if (!conversation) {
      return res.json({ conversation: null, messages: [] });
    }
    return res.json({ conversation, messages: conversation.messages });
  })
);


// GET /api/conversations/:id — single thread, recruiter-scoped
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

    const role = req.user!.role.toLowerCase();
    if (role !== "owner" && conversation.recruiterId !== req.user!.id) {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to view this conversation");
    }

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

    // This page only ever creates LINKEDIN-channel conversations -- confirmed
    // live, a ProZ lead ended up here with its proz.com profileLink shown in
    // the "TO" field, because nothing checked the lead was actually a
    // LinkedIn lead before creating one. Require both signals: `source` is
    // the intended one, the URL check catches a stale/mistagged `source`.
    const isLinkedInLead =
      lead.source === "LINKEDIN" && !!lead.profileLink && /linkedin\.com/i.test(lead.profileLink);
    if (!isLinkedInLead) {
      throw new ApiError(
        400,
        "LEAD_NOT_LINKEDIN",
        `${lead.displayName || lead.fullName || "This lead"} isn't a LinkedIn lead (source: ${lead.source}) -- LinkedIn conversations can only be started for leads with a real linkedin.com profile.`
      );
    }

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
        // displayName (the enrichment-verified name) wins once it exists --
        // fullName is just whatever was typed at Add-Lead time.
        candidateName: lead.displayName || lead.fullName || "Candidate",
        candidateRole: candidateRoleOf(lead.services, lead.targetLanguage),
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

    let draft: { subject: string | null; body: string };
    try {
      // Previously omitted Headline/About_Snippet/Current_Title/
      // Tools_Software/Certifications entirely -- LinkedIn drafts were
      // personalizing on strictly less material than email drafts. Now
      // shares the exact same payload builder (and gets Clay's richer
      // data) as the email route. Drafting runs in-process (server/src/drafting/)
      // -- no network hop, no DRAFTING_SERVICE_URL to misconfigure.
      const result = await getDraftingOrchestrator().processDraft(buildDraftLeadPayload(conversation.lead), "linkedin");
      draft = { subject: result.subject, body: result.body };
      if (result.verdict === "INELIGIBLE" || !draft.body.trim()) {
        const reason = result.flags[0] || "missing required lead data";
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
        "DRAFTING_FAILED",
        "Could not generate a draft — write the message manually"
      );
    }

    return res.json({ draft: { body: draft.body } });
  })
);

// POST /api/conversations/:id/messages — send a reply via Unipile, then log it
conversationRouter.post(
  "/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const { text, accountId, to, replyToMessageId } = z
      .object({
        text: z.string().min(1),
        accountId: z.string().optional(),
        to: z.string().optional(),
        // The specific inbound ConversationMessage.externalMessageId being
        // replied to (EMAIL only) -- Unipile's `reply_to`, confirmed via
        // their docs to need the actual message id, not a thread id.
        replyToMessageId: z.string().optional(),
      })
      .parse(req.body);

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { lead: true },
    });
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

    const role = req.user!.role.toLowerCase();
    if (role !== "owner" && conversation.recruiterId !== req.user!.id) {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to send messages in this conversation");
    }

    if (conversation.channel !== ConversationChannel.LINKEDIN && conversation.channel !== ConversationChannel.EMAIL) {
      throw new ApiError(
        400,
        "UNSUPPORTED_CHANNEL",
        `In-app replies aren't supported for ${conversation.channel} conversations yet`
      );
    }

    try {
      if (conversation.channel === ConversationChannel.LINKEDIN) {
        const target = to || conversation.lead.profileLink;
        if (!target) throw new ApiError(400, "MISSING_LINKEDIN_PROFILE", "Lead has no LinkedIn profile link");
        await UnipileService.sendLinkedInMessage(req.user!.id, conversation.leadId, target, text, accountId);
      } else {
        const target = to || conversation.lead.email;
        if (!target) throw new ApiError(400, "MISSING_EMAIL", "Lead has no email address");
        // Conversation has no subject of its own -- reuse whatever this
        // recruiter's most recent EmailQueueItem for this lead sent, same
        // pattern as the original cold-outreach subject, prefixed "Re:"
        // like any real reply (unless it already is one).
        const latestQueueItem = await prisma.emailQueueItem.findFirst({
          where: { leadId: conversation.leadId, recruiterId: conversation.recruiterId },
          orderBy: { receivedAt: "desc" },
        });
        const originalSubject = latestQueueItem?.subject || conversation.candidateName;
        const replySubject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
        await UnipileService.sendEmail(
          req.user!.id,
          conversation.leadId,
          target,
          replySubject,
          text,
          accountId,
          replyToMessageId
        );
      }
    } catch (err: any) {
      // Never write the message as if it sent when the Unipile call failed.
      throw toApiError(err);
    }

    // sendLinkedInMessage already records this message (and bumps
    // lastMessageAt) via its own internal syncToConversation call -- this
    // route used to ALSO create a second ConversationMessage for the exact
    // same text right here, which is the "message sent twice" duplicate
    // confirmed live in the UI. Fetch the row syncToConversation just wrote
    // instead of writing a second one.
    const message = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversation.id, sender: MessageSender.ME, text },
      orderBy: { sentAt: "desc" },
    });

    return res.status(201).json({ message });
  })
);
