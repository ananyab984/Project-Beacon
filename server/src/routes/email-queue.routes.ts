import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError, toApiError } from "../lib/apiError";
import { UnipileService } from "../services/unipile.service";
import { buildDraftLeadPayload } from "../lib/draftLeadPayload";
import { candidateRoleOf } from "../lib/messageTemplates";
import { getDraftingOrchestrator } from "../drafting/instance";

export const emailQueueRouter = Router();

emailQueueRouter.use(authenticateJwt);
emailQueueRouter.use(requireRole("owner", "recruiter", "contractor"));

const CHANNELS = ["LINKEDIN", "EMAIL"] as const;

// GET /api/email-queue — the recruiter's own queue (every role, owner
// included, sees only what they personally added/were assigned -- this is a
// self-serve outreach tool, not a cross-recruiter monitoring view).
emailQueueRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const items = await prisma.emailQueueItem.findMany({
      where: { recruiterId: req.user!.id },
      include: { lead: { select: { fullName: true, displayName: true, email: true, profileLink: true } } },
    });

    // Sort by most recent activity (matching how /api/conversations orders
    // LinkedIn threads by lastMessageAt) rather than static receivedAt --
    // otherwise a lead that just replied stays wherever it was originally
    // added instead of surfacing to the top like an inbox does.
    const conversations = await prisma.conversation.findMany({
      where: { leadId: { in: items.map((i) => i.leadId) }, recruiterId: req.user!.id, channel: "EMAIL" },
      select: { leadId: true, lastMessageAt: true },
    });
    const lastMessageByLead = new Map(conversations.map((c) => [c.leadId, c.lastMessageAt]));

    items.sort((a, b) => {
      const aTime = Math.max(a.receivedAt.getTime(), lastMessageByLead.get(a.leadId)?.getTime() ?? 0);
      const bTime = Math.max(b.receivedAt.getTime(), lastMessageByLead.get(b.leadId)?.getTime() ?? 0);
      return bTime - aTime;
    });

    return res.json({ items });
  })
);

// POST /api/email-queue — add a lead to recruiter's queue
emailQueueRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ leadId: z.string().uuid() });
    const { leadId } = schema.parse(req.body);

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    const existing = await prisma.emailQueueItem.findFirst({
      where: { leadId, recruiterId: req.user!.id },
      include: { lead: { select: { fullName: true, displayName: true, email: true, profileLink: true } } },
    });
    if (existing) return res.json({ item: existing });

    // Body/subject start empty -- a lead landing in the queue should always
    // require an explicit "Generate Draft" click (or manual typing) before
    // it has any content, never arrive pre-written. The real AI-personalized
    // draft only ever comes from POST /:id/generate-draft below.
    const item = await prisma.emailQueueItem.create({
      data: {
        leadId: lead.id,
        recruiterId: req.user!.id,
        candidateName: lead.displayName || lead.fullName || "Candidate",
        candidateRole: candidateRoleOf(lead.services, lead.targetLanguage),
        status: "REVIEW_NEEDED",
        subject: "",
        body: "",
        aiGenerated: false,
      },
      include: { lead: { select: { fullName: true, displayName: true, email: true, profileLink: true } } },
    });

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
        "email",
        false,
        item.lead.id
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
    });
    const { to, subject, body, channel, accountId } = schema.parse(req.body);

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
        await UnipileService.sendEmail(req.user!.id, item.leadId, target, subject || item.subject, body, accountId);
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
      include: { lead: { select: { fullName: true, displayName: true, email: true, profileLink: true } } },
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
          await UnipileService.sendEmail(req.user!.id, item.leadId, target, item.subject, item.body);
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
