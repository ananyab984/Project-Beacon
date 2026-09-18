import { prisma } from "../prisma";
import { createNotification } from "../services/notification.service";

const SLA_BREACH_HOURS = 24;
const STALE_ON_HOLD_DAYS = 5;
const EMAIL_QUEUE_BACKLOG_THRESHOLD = 25;

async function escalationExists(category: string, leadId?: string | null, recruiterId?: string | null) {
  return prisma.escalation.findFirst({
    where: { category, leadId: leadId ?? undefined, recruiterId: recruiterId ?? undefined, status: { not: "IN_PROGRESS" } },
  });
}

/** Scans for SLA breaches, stale on-hold leads, and email-queue backlog, and
 *  inserts an Escalation row for anything not already tracked. Escalations are
 *  otherwise never manually created -- this job is their only producer. */
export async function scanForEscalations() {
  await Promise.all([scanSlaBreaches(), scanStaleLeads(), scanEmailQueueBacklog()]);
}

async function scanSlaBreaches() {
  const cutoff = new Date(Date.now() - SLA_BREACH_HOURS * 3600_000);
  const breaches = await prisma.interactionEvent.findMany({
    where: {
      direction: "INBOUND",
      isUrgentFlag: true,
      recruiterRespondedAt: null,
      occurredAt: { lt: cutoff },
      lead: { deletedAt: null },
    },
    include: { lead: true },
    take: 50,
  });

  for (const b of breaches) {
    if (await escalationExists("SLA Breach", b.leadId)) continue;
    const hoursOverdue = (Date.now() - b.occurredAt.getTime()) / 3600_000 - SLA_BREACH_HOURS;
    const hoursSinceReply = Math.round((Date.now() - b.occurredAt.getTime()) / 3600_000);
    const title = `Unanswered high-priority reply — ${b.lead.fullName ?? b.lead.maskedLabel}`;
    const detail = `Lead replied ${hoursSinceReply}h ago and hasn't been responded to.`;
    const recommendedAction = "Respond to this lead immediately to avoid losing engagement momentum.";
    await prisma.escalation.create({
      data: {
        priority: "P1",
        category: "SLA Breach",
        title,
        detail,
        recommendedAction,
        slaHoursRemaining: -Math.round(hoursOverdue),
        leadId: b.leadId,
        recruiterId: b.lead.assignedRecruiterId,
      },
    });
    if (b.lead.assignedRecruiterId) {
      const notificationBody = `${b.lead.fullName ?? b.lead.maskedLabel} replied ${hoursSinceReply}h ago and still hasn't been responded to. ${recommendedAction}`;
      await mirrorEscalationNotification(b.lead.assignedRecruiterId, title, notificationBody, "/recruiter/leads");
    }
  }
}

async function scanStaleLeads() {
  const cutoff = new Date(Date.now() - STALE_ON_HOLD_DAYS * 86_400_000);
  const stale = await prisma.lead.findMany({
    where: { OR: [{ identityResolved: false }, { flags: { has: "ON_HOLD" } }], createdAt: { lt: cutoff }, deletedAt: null },
    take: 50,
  });

  for (const lead of stale) {
    if (await escalationExists("Recruiter Performance", lead.id)) continue;
    const ageDays = Math.round((Date.now() - lead.createdAt.getTime()) / 86_400_000);
    const title = `Lead stuck On Hold for ${ageDays}d — ${lead.fullName ?? lead.maskedLabel}`;
    const detail = "This lead has not had its identity resolved / manual enrichment completed.";
    const recommendedAction = "Complete manual enrichment to promote this lead to the Global pool, or close it out.";
    await prisma.escalation.create({
      data: {
        priority: ageDays > STALE_ON_HOLD_DAYS * 2 ? "P2" : "P3",
        category: "Recruiter Performance",
        title,
        detail,
        recommendedAction,
        leadId: lead.id,
        recruiterId: lead.assignedRecruiterId,
      },
    });
    if (lead.assignedRecruiterId) {
      const notificationBody = `the lead "${lead.fullName ?? lead.maskedLabel}" has been stuck on hold for ${ageDays} day${ageDays === 1 ? "" : "s"} -- its identity hasn't been resolved or manual enrichment completed yet. ${recommendedAction}`;
      await mirrorEscalationNotification(lead.assignedRecruiterId, title, notificationBody, "/recruiter/performance");
    }
  }
}

async function scanEmailQueueBacklog() {
  const recruiters = await prisma.user.findMany({ where: { role: "RECRUITER", isActive: true }, select: { id: true, name: true } });
  for (const r of recruiters) {
    // addedManually: true only -- matches GET /api/email-queue's own filter
    // (email-queue.routes.ts). lead.routes.ts used to silently auto-create
    // an EmailQueueItem for every lead a recruiter created; those historical
    // rows are excluded from the queue a recruiter actually sees, so
    // counting them here produced a stale, inflated backlog escalation that
    // never matched what the recruiter could see or act on -- confirmed
    // live: "ananya's email queue has 25 unsent drafts" while the real,
    // visible queue held only 2.
    const backlog = await prisma.emailQueueItem.count({ where: { recruiterId: r.id, addedManually: true } });
    const existing = await prisma.escalation.findFirst({
      where: { category: "Email Queue Threshold Alert", recruiterId: r.id, status: { not: "IN_PROGRESS" } },
    });

    if (backlog < EMAIL_QUEUE_BACKLOG_THRESHOLD) {
      // The condition that created this escalation no longer holds (drafts
      // were sent/discarded, or -- as happened live -- the count itself was
      // corrected). This schema has no "resolved" status and nothing else
      // ever revisits an escalation once created (see this function's own
      // doc comment: "this job is their only producer"), so without this an
      // escalation keeps showing a stale count forever even after the real
      // backlog clears.
      if (existing) await prisma.escalation.delete({ where: { id: existing.id } });
      continue;
    }

    if (existing) continue;
    const title = `${r.name}'s email queue has ${backlog} unsent drafts`;
    const detail = `Backlog exceeds the ${EMAIL_QUEUE_BACKLOG_THRESHOLD}-item threshold.`;
    const recommendedAction = "Review and send or discard queued drafts to keep outreach timely.";
    await prisma.escalation.create({
      data: {
        priority: "P2",
        category: "Email Queue Threshold Alert",
        title,
        detail,
        recommendedAction,
        recruiterId: r.id,
      },
    });
    // Fuller than the Escalation table's own `detail` -- that field is read
    // on its own elsewhere, but the notification (bell/email/Slack) has no
    // sibling `recommendedAction` field to fall back on, so it's folded in
    // here as a full sentence instead of getting dropped.
    const notificationBody = `your email queue backlog has reached ${backlog} unsent draft${backlog === 1 ? "" : "s"}, over the ${EMAIL_QUEUE_BACKLOG_THRESHOLD}-item threshold. ${recommendedAction}`;
    await mirrorEscalationNotification(r.id, title, notificationBody, "/recruiter/email-queue");
  }
}

// Mirrors a newly created Escalation into the unified Notification feed so
// the recruiter's bell picks it up too (matching the old popover's
// category -> route heuristic). Only fires when there's an individual
// recruiter to notify -- Escalation.ownerUserId ("System"-owned escalations)
// has no single deterministic recipient to target, so those stay
// Escalation-table-only; the owner's EscalationsBell reads that table
// directly and is unaffected either way.
async function mirrorEscalationNotification(recruiterId: string, title: string, detail: string, link: string) {
  await createNotification({
    recipientId: recruiterId,
    type: "ESCALATION",
    title,
    body: detail,
    link,
  }).catch((err) => console.error("[notifications] escalation mirror failed:", err));
}
