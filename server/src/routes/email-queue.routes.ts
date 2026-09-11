import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError, toApiError } from "../lib/apiError";
import { UnipileService, findReplyAnchor, resolveReplySubject } from "../services/unipile.service";
import { buildDraftLeadPayload } from "../lib/draftLeadPayload";
import { candidateRoleOf } from "../lib/messageTemplates";
import { getDraftingOrchestrator } from "../drafting/instance";
import { assertContractorOwnsLead } from "./lead.routes";

export const emailQueueRouter = Router();

emailQueueRouter.use(authenticateJwt);
emailQueueRouter.use(requireRole("owner", "recruiter", "contractor"));

const CHANNELS = ["LINKEDIN", "EMAIL"] as const;

/** The recruiter's own queue (every role, owner included, sees only what
 * they personally added/were assigned -- this is a self-serve outreach
 * tool, not a cross-recruiter monitoring view). Exported so it's directly
 * unit-testable without constructing a fake request/response. */
export async function getEmailQueueForRecruiter(recruiterId: string) {
  // addedManually excludes historical rows lead.routes.ts used to silently
  // auto-create for every lead a recruiter created, before that side effect
  // was removed -- without this, the queue kept showing (and counting)
  // leads the recruiter never actually chose to add via this page's own
  // "Search Lead" -> add action.
  const items = await prisma.emailQueueItem.findMany({
    where: { recruiterId, addedManually: true },
    include: { lead: { select: { fullName: true, displayName: true, email: true, profileLink: true, replyCategoryId: true, replyClassificationSource: true } } },
  });

  // Sort by most recent activity (matching how /api/conversations orders
  // LinkedIn threads by lastMessageAt) rather than static receivedAt --
  // otherwise a lead that just replied stays wherever it was originally
  // added instead of surfacing to the top like an inbox does.
  //
  // Also pull each conversation's newest message text: `item.body` is the
  // queue item's OWN draft, set once at draft/send time and never touched
  // again, so a reply landing in the separate Conversation/
  // ConversationMessage tables never reached it -- the list's preview
  // snippet stayed frozen on the initial mail forever, even though the
  // item itself correctly climbed to the top of the sort above. Confirmed
  // live: "latest mail is not showing in the queue, showing only the
  // initial mail."
  const conversations = await prisma.conversation.findMany({
    where: { leadId: { in: items.map((i) => i.leadId) }, recruiterId, channel: "EMAIL" },
    select: {
      leadId: true,
      lastMessageAt: true,
      messages: { orderBy: { sentAt: "desc" }, take: 1, select: { text: true } },
    },
  });
  const lastMessageByLead = new Map(conversations.map((c) => [c.leadId, c.lastMessageAt]));
  const latestMessageTextByLead = new Map(conversations.map((c) => [c.leadId, c.messages[0]?.text ?? null]));

  items.sort((a, b) => {
    const aTime = Math.max(a.receivedAt.getTime(), lastMessageByLead.get(a.leadId)?.getTime() ?? 0);
    const bTime = Math.max(b.receivedAt.getTime(), lastMessageByLead.get(b.leadId)?.getTime() ?? 0);
    return bTime - aTime;
  });

  return items.map((item) => ({
    ...item,
    latestMessageText: latestMessageTextByLead.get(item.leadId) ?? null,
  }));
}

// GET /api/email-queue
emailQueueRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const items = await getEmailQueueForRecruiter(req.user!.id);
    return res.json({ items });
  })
);

const EMAIL_QUEUE_ITEM_INCLUDE_LEAD = {
  lead: { select: { fullName: true, displayName: true, email: true, profileLink: true, replyCategoryId: true, replyClassificationSource: true } },
};

/** Add a lead to the recruiter's queue via this page's own "Search Lead" ->
 * add action -- the only path left that creates an EmailQueueItem, now that
 * lead.routes.ts's auto-add-on-lead-creation side effect is gone. Exported
 * so it's directly unit-testable without constructing a fake request/
 * response.
 *
 * Security fix: this used to accept ANY leadId with no ownership check at
 * all -- a contractor could pass a lead they never created (found by
 * guessing/knowing its id, since nothing here validated it) and it would be
 * silently added to THEIR OWN queue, from which they could then generate a
 * draft and send a real email to that lead. Confirmed live via a direct
 * call to this function: contractor A successfully queued contractor B's
 * lead. assertContractorOwnsLead is the same guard lead.routes.ts already
 * uses for every other single-lead action -- recruiter/owner are
 * unaffected (they retain full-pool access, same as everywhere else). */
export async function addLeadToEmailQueue(leadId: string, recruiterId: string, requesterRole: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
  assertContractorOwnsLead(requesterRole, recruiterId, lead);

  const existing = await prisma.emailQueueItem.findFirst({
    where: { leadId, recruiterId },
    include: EMAIL_QUEUE_ITEM_INCLUDE_LEAD,
  });
  if (existing) {
    // A row can already exist here with addedManually: false -- this same
    // lead was silently auto-added before that side effect was removed
    // from lead.routes.ts, and it's excluded from GET's list until now. The
    // recruiter explicitly choosing to add it here is exactly the real
    // intent addedManually is meant to capture, so promote the existing row
    // (keeping whatever draft/status history it already has) rather than
    // leaving it hidden or creating a duplicate.
    if (existing.addedManually) return existing;
    return prisma.emailQueueItem.update({
      where: { id: existing.id },
      data: { addedManually: true },
      include: EMAIL_QUEUE_ITEM_INCLUDE_LEAD,
    });
  }

  // Body/subject start empty -- a lead landing in the queue should always
  // require an explicit "Generate Draft" click (or manual typing) before it
  // has any content, never arrive pre-written. The real AI-personalized
  // draft only ever comes from POST /:id/generate-draft below.
  return prisma.emailQueueItem.create({
    data: {
      leadId: lead.id,
      recruiterId,
      candidateName: lead.displayName || lead.fullName || "Candidate",
      candidateRole: candidateRoleOf(lead.services, lead.targetLanguage),
      status: "REVIEW_NEEDED",
      subject: "",
      body: "",
      aiGenerated: false,
      addedManually: true,
    },
    include: EMAIL_QUEUE_ITEM_INCLUDE_LEAD,
  });
}

// POST /api/email-queue — add a lead to recruiter's queue
emailQueueRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ leadId: z.string().uuid() });
    const { leadId } = schema.parse(req.body);
    const item = await addLeadToEmailQueue(leadId, req.user!.id, req.user!.role);
    return res.status(201).json({ item });
  })
);

// PATCH /api/email-queue/:id — partial update (autosave of subject/body/to)
emailQueueRouter.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ subject: z.string().optional(), body: z.string().optional(), to: z.string().optional() });
    const patch = schema.parse(req.body);

    // Ownership check folded into the lookup itself: a not-found row and a
    // not-owned row both 404 identically, so we never leak whether some other
    // recruiter's item exists at this id.
    const existing = await prisma.emailQueueItem.findFirst({
      where: { id: req.params.id, recruiterId: req.user!.id },
    });
    if (!existing) throw new ApiError(404, "EMAIL_QUEUE_ITEM_NOT_FOUND", "Email queue item not found");

    const updated = await prisma.emailQueueItem.update({ where: { id: existing.id }, data: patch });
    return res.json({ item: updated });
  })
);

// POST /api/email-queue/:id/generate-draft — calls the drafting_service,
// which personalizes the approved template using ALL of this lead's real
// enriched fields (years of experience, services, vendor/client experience,
// languages, country) via a strict, facts-only LLM prompt -- never a
// hardcoded phrase spliced in here. On any failure (service unreachable,
// bad response), fail loudly rather than silently falling back to a
// non-personalized or fabricated draft.
emailQueueRouter.post(
  "/:id/generate-draft",
  asyncHandler(async (req: Request, res: Response) => {
    const item = await prisma.emailQueueItem.findFirst({
      where: { id: req.params.id, recruiterId: req.user!.id },
      include: { lead: true },
    });
    if (!item) throw new ApiError(404, "EMAIL_QUEUE_ITEM_NOT_FOUND", "Email queue item not found");

    // Regenerating after send overwrites subject/body with a fresh draft
    // while the real email already went out with the old ones -- the queue
    // item's stored subject then silently drifts from the actual thread
    // subject Unipile is tracking, and any later reply's Re: subject built
    // from it gets rejected by Unipile as not matching the real thread.
    if (item.status === "SENT") {
      throw new ApiError(
        409,
        "ALREADY_SENT",
        "This email was already sent -- its subject and body can no longer be regenerated."
      );
    }

    // A recruiter typing an address into the TO field is a legitimate way to
    // supply an email the enrichment pipeline never found -- previously this
    // never reached generate-draft at all (only /send read it), so it could
    // never unblock a NO_EMAIL-ineligible lead no matter what was typed.
    const manualToRaw = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    const manualTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualToRaw) ? manualToRaw : null;
    const effectiveEmail = item.lead.email || manualTo;

    // Fill-only, never overwrite: if the lead had no email on file yet, a
    // manually-supplied one is real lead data worth keeping, not just a
    // one-off send-time detail -- but an existing (enriched) email always wins.
    if (manualTo && !item.lead.email) {
      await prisma.lead.update({ where: { id: item.lead.id }, data: { email: manualTo } });
    }

    let draft: { subject: string | null; body: string };
    try {
      // Drafting runs in-process (server/src/drafting/) -- no network hop,
      // no DRAFTING_SERVICE_URL to misconfigure.
      const result = await getDraftingOrchestrator().processDraft(
        buildDraftLeadPayload(item.lead, effectiveEmail),
        "email"
      );
      draft = { subject: result.subject, body: result.body };
      // INELIGIBLE means the pipeline correctly refused to draft anything
      // (e.g. no email address on file yet) -- its body is deliberately
      // empty, not a failure to surface as "unavailable".
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
      // Never fabricate a fallback draft here -- surface the failure and let
      // the recruiter write the message by hand or retry.
      throw new ApiError(
        502,
        "DRAFTING_FAILED",
        "Could not generate a draft — write the message manually"
      );
    }

    const updated = await prisma.emailQueueItem.update({
      where: { id: item.id },
      data: {
        subject: draft.subject ?? item.subject,
        body: draft.body,
        aiGenerated: true,
      },
    });
    return res.json({ item: updated });
  })
);

// POST /api/email-queue/:id/send — dispatch via Unipile, then mark as
// delivered in place (never delete) so the recruiter can still see it in the
// queue with the message that was actually sent.
emailQueueRouter.post(
  "/:id/send",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().min(1),
      channel: z.enum(CHANNELS),
      accountId: z.string().optional(),
      // The specific inbound ConversationMessage.externalMessageId this send
      // is answering (EMAIL only) -- same param, same purpose as
      // conversation.routes.ts's POST /:id/messages. Lets the composer say
      // exactly which of a lead's several pending emails this reply is for,
      // instead of always falling back to findReplyAnchor's "most recent"
      // guess, which is wrong whenever more than one is still unanswered.
      replyToMessageId: z.string().optional(),
    });
    const { to, subject, body, channel, accountId, replyToMessageId } = schema.parse(req.body);

    const item = await prisma.emailQueueItem.findFirst({
      where: { id: req.params.id, recruiterId: req.user!.id },
      include: { lead: true },
    });
    if (!item) throw new ApiError(404, "EMAIL_QUEUE_ITEM_NOT_FOUND", "Email queue item not found");

    let target: string;
    try {
      if (channel === "LINKEDIN") {
        target = to || item.lead.profileLink || "";
        if (!target) throw new ApiError(400, "MISSING_LINKEDIN_PROFILE", "Lead has no LinkedIn profile link");
        await UnipileService.sendLinkedInMessage(req.user!.id, item.leadId, target, body, accountId);
      } else {
        target = to || item.lead.email || "";
        if (!target) throw new ApiError(400, "MISSING_EMAIL", "Lead has no email address");
        const resolvedReplyToMessageId = replyToMessageId ?? (await findReplyAnchor(item.leadId, req.user!.id));
        // When the recruiter explicitly picked which message this reply
        // answers, the subject must match THAT thread, not whatever's
        // sitting in the composer (the queue item's own possibly-stale/
        // regenerated subject) -- see resolveReplySubject's doc comment for
        // why a mismatch gets hard-rejected by Unipile. Left untouched when
        // no explicit target was given, preserving the existing
        // subject-editing behavior on that (unchanged) path.
        const finalSubject = replyToMessageId
          ? await resolveReplySubject(item.leadId, req.user!.id, resolvedReplyToMessageId, item.candidateName)
          : subject || item.subject;
        await UnipileService.sendEmail(req.user!.id, item.leadId, target, finalSubject, body, accountId, resolvedReplyToMessageId);
      }
    } catch (err: any) {
      throw toApiError(err);
    }

    const updated = await prisma.emailQueueItem.update({
      where: { id: item.id },
      data: {
        subject: subject || item.subject,
        body,
        // The address actually used to send -- not re-derived from
        // lead.email afterward, which can drift from what this send
        // genuinely went to (an override, or a later enrichment correction).
        to: target,
        status: "SENT",
        sentAt: new Date(),
        sentChannel: channel,
      },
      include: { lead: { select: { fullName: true, displayName: true, email: true, profileLink: true, replyCategoryId: true, replyClassificationSource: true } } },
    });
    return res.json({ success: true, item: updated });
  })
);

// POST /api/email-queue/batch-send — best-effort per-id send; one failure must
// not abort the rest. Uses each item's own stored subject/body/lead contact
// info (no per-item override from the request).
emailQueueRouter.post(
  "/batch-send",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
    const { ids } = schema.parse(req.body);

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of ids) {
      try {
        const item = await prisma.emailQueueItem.findFirst({
          where: { id, recruiterId: req.user!.id },
          include: { lead: true },
        });
        if (!item) {
          results.push({ id, success: false, error: "EMAIL_QUEUE_ITEM_NOT_FOUND" });
          continue;
        }

        // EmailQueueItem carries no channel of its own -- prefer LinkedIn
        // (this queue's primary channel) when the lead has a profile link,
        // falling back to email.
        let sentChannel: "LINKEDIN" | "EMAIL";
        let target: string;
        if (item.lead.profileLink) {
          target = item.lead.profileLink;
          await UnipileService.sendLinkedInMessage(req.user!.id, item.leadId, target, item.body);
          sentChannel = "LINKEDIN";
        } else if (item.lead.email) {
          target = item.lead.email;
          const replyToMessageId = await findReplyAnchor(item.leadId, req.user!.id);
          await UnipileService.sendEmail(req.user!.id, item.leadId, target, item.subject, item.body, undefined, replyToMessageId);
          sentChannel = "EMAIL";
        } else {
          results.push({ id, success: false, error: "NO_CONTACT_TARGET" });
          continue;
        }

        await prisma.emailQueueItem.update({
          where: { id: item.id },
          data: { status: "SENT", sentAt: new Date(), sentChannel, to: target },
        });
        results.push({ id, success: true });
      } catch (err: any) {
        const apiErr = toApiError(err);
        results.push({ id, success: false, error: apiErr.code });
      }
    }

    return res.json({ results });
  })
);
