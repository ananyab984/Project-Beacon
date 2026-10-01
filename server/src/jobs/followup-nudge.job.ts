import { prisma } from "../prisma";
import { createNotification, formatFollowUpDueSlackCard } from "../services/notification.service";

const FOLLOW_UP_MIN_DAYS = 3;
const FOLLOW_UP_STEP_2_DAYS = 7;
const MAX_LEADS_PER_RUN = 200;

/** Outreach sent, no reply after 3 / 7 days -- a plain reminder nudge, not an
 *  AI-drafted follow-up (per plan decision: this stays human-in-the-loop).
 *  No new table: InteractionEvent already records every outbound send
 *  (UnipileService.sendLinkedInMessage/sendEmail) and every inbound reply,
 *  so "sent, no reply, N days" is a pure read-time query. */
export async function sendFollowUpNudges() {
  const cutoff = new Date(Date.now() - FOLLOW_UP_MIN_DAYS * 86_400_000);

  // Same "latest per group" shape as enrichmentEvaluation.routes.ts's
  // latestRunGroups -- group by leadId, take the max occurredAt, then look
  // up the real rows for whatever's due. Grouping on the lead's TRUE latest
  // outbound event (not just the latest among rows that already happen to
  // be old) is what makes a fresher, still-under-3-days send correctly
  // restart the clock: a lead with an old outbound plus a fresh one only
  // shows up here once its actual latest event crosses the 3-day mark.
  const latestPerLead = await prisma.interactionEvent.groupBy({
    by: ["leadId"],
    where: { direction: "OUTBOUND", lead: { deletedAt: null } },
    _max: { occurredAt: true },
    orderBy: { _max: { occurredAt: "asc" } }, // most-overdue leads first within the take bound
    take: MAX_LEADS_PER_RUN,
  });

  const due = latestPerLead.filter((row) => row._max.occurredAt !== null && row._max.occurredAt <= cutoff);
  if (due.length === 0) return;

  const events = await prisma.interactionEvent.findMany({
    where: {
      direction: "OUTBOUND",
      OR: due.map((row) => ({ leadId: row.leadId, occurredAt: row._max.occurredAt as Date })),
    },
    include: { lead: true },
  });

  for (const event of events) {
    if (!event.recruiterId) continue; // defensive -- outbound sends always set this today

    const reply = await prisma.interactionEvent.findFirst({
      where: { leadId: event.leadId, direction: "INBOUND", occurredAt: { gt: event.occurredAt } },
    });
    if (reply) continue; // they replied since this send

    const daysSince = Math.floor((Date.now() - event.occurredAt.getTime()) / 86_400_000);
    const step = daysSince >= FOLLOW_UP_STEP_2_DAYS ? 2 : 1;
    const link = `/recruiter/email-queue?leadId=${event.leadId}&followupStep=${step}&evt=${event.id}`;

    // Guards against re-notifying the same send+step on the next hourly run
    // -- link encodes both the interaction event and the step, so a lead
    // that later crosses from step 1 to step 2 still gets a second nudge.
    const alreadyNotified = await prisma.notification.findFirst({ where: { type: "FOLLOW_UP_DUE", link } });
    if (alreadyNotified) continue;

    const leadName = event.lead.displayName || event.lead.fullName || event.lead.maskedLabel || "this lead";
    await createNotification({
      recipientId: event.recruiterId,
      type: "FOLLOW_UP_DUE",
      title: `Time to follow up with ${leadName}`,
      body: `it's been ${daysSince} days since your last outreach to ${leadName} with no reply yet. Consider sending a follow-up.`,
      slackCard: formatFollowUpDueSlackCard(leadName, daysSince, link),
      link,
    }).catch((err) => console.error(`[followup-nudge.job] notify failed for lead ${event.leadId}:`, err));
  }
}
