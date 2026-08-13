import { prisma } from "../prisma";

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
    where: { direction: "INBOUND", isUrgentFlag: true, recruiterRespondedAt: null, occurredAt: { lt: cutoff } },
    include: { lead: true },
    take: 50,
  });

  for (const b of breaches) {
    if (await escalationExists("SLA Breach", b.leadId)) continue;
    const hoursOverdue = (Date.now() - b.occurredAt.getTime()) / 3600_000 - SLA_BREACH_HOURS;
    await prisma.escalation.create({
      data: {
        priority: "P1",
        category: "SLA Breach",
        title: `Unanswered high-priority reply — ${b.lead.fullName ?? b.lead.maskedLabel}`,
        detail: `Lead replied ${Math.round((Date.now() - b.occurredAt.getTime()) / 3600_000)}h ago and hasn't been responded to.`,
        recommendedAction: "Respond to this lead immediately to avoid losing engagement momentum.",
        slaHoursRemaining: -Math.round(hoursOverdue),
        leadId: b.leadId,
        recruiterId: b.lead.assignedRecruiterId,
      },
    });
  }
}

async function scanStaleLeads() {
  const cutoff = new Date(Date.now() - STALE_ON_HOLD_DAYS * 86_400_000);
  const stale = await prisma.lead.findMany({
    where: { OR: [{ identityResolved: false }, { flags: { has: "ON_HOLD" } }], createdAt: { lt: cutoff } },
    take: 50,
  });

  for (const lead of stale) {
    if (await escalationExists("Recruiter Performance", lead.id)) continue;
    const ageDays = Math.round((Date.now() - lead.createdAt.getTime()) / 86_400_000);
    await prisma.escalation.create({
      data: {
        priority: ageDays > STALE_ON_HOLD_DAYS * 2 ? "P2" : "P3",
        category: "Recruiter Performance",
        title: `Lead stuck On Hold for ${ageDays}d — ${lead.fullName ?? lead.maskedLabel}`,
        detail: "This lead has not had its identity resolved / manual enrichment completed.",
        recommendedAction: "Complete manual enrichment to promote this lead to the Global pool, or close it out.",
        leadId: lead.id,
        recruiterId: lead.assignedRecruiterId,
      },
    });
  }
}

async function scanEmailQueueBacklog() {
  const recruiters = await prisma.user.findMany({ where: { role: "RECRUITER", isActive: true }, select: { id: true, name: true } });
  for (const r of recruiters) {
    const backlog = await prisma.emailQueueItem.count({ where: { recruiterId: r.id } });
    if (backlog < EMAIL_QUEUE_BACKLOG_THRESHOLD) continue;
    if (await escalationExists("Email Queue Threshold Alert", null, r.id)) continue;
    await prisma.escalation.create({
      data: {
        priority: "P2",
        category: "Email Queue Threshold Alert",
        title: `${r.name}'s email queue has ${backlog} unsent drafts`,
        detail: `Backlog exceeds the ${EMAIL_QUEUE_BACKLOG_THRESHOLD}-item threshold.`,
        recommendedAction: "Review and send or discard queued drafts to keep outreach timely.",
        recruiterId: r.id,
      },
    });
  }
}
