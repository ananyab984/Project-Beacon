import { prisma } from "../prisma";
import {
  createNotification,
  formatDailyDemandSummarySlackCard,
  formatWeeklyLeadsSummarySlackCard,
  formatWeeklyPerformanceSummarySlackCard,
} from "../services/notification.service";

// Same set performance-page-view.tsx uses client-side (CLOSED_STATUSES) --
// kept in sync by hand since this is a server-side recompute of the exact
// same "active leads" definition, not a new metric.
const CLOSED_LEAD_STATUSES = new Set(["CLOSED", "REJECTED", "PLACED", "ON_HOLD"]);
const FOLLOW_UP_QUEUE_STATUSES = new Set(["FOLLOW_UP", "REVIEW_NEEDED"]);

/** Daily, every contractor: total open requirement headcount across the org
 *  -- not per-contractor (demand isn't owned by whoever's looking at it),
 *  same broadcast figure to everyone with this notification type on. */
export async function sendDailyDemandSummary() {
  const openRequirements = await prisma.requirement.findMany({
    where: { status: { not: "FULFILLED" } },
    select: { gap: true },
  });
  if (openRequirements.length === 0) return;

  const openHeadcount = openRequirements.reduce((sum, r) => sum + r.gap, 0);
  const contractors = await prisma.user.findMany({ where: { role: "CONTRACTOR" }, select: { id: true } });

  await Promise.all(
    contractors.map((c) =>
      createNotification({
        recipientId: c.id,
        type: "DAILY_DEMAND_SUMMARY",
        title: `${openHeadcount} candidate${openHeadcount === 1 ? "" : "s"} needed across ${openRequirements.length} open requirement${openRequirements.length === 1 ? "" : "s"}`,
        body: `there ${openRequirements.length === 1 ? "is" : "are"} ${openRequirements.length} open requirement${openRequirements.length === 1 ? "" : "s"} right now, needing ${openHeadcount} more candidate${openHeadcount === 1 ? "" : "s"} in total.`,
        slackCard: formatDailyDemandSummarySlackCard(openHeadcount, openRequirements.length),
        link: "/contractor/requirements",
      }).catch((err) => console.error(`[contractorDigest.job] daily demand summary failed for ${c.id}:`, err))
    )
  );
}

/** Weekly, every contractor: how many leads they added this week, plus the
 *  same live pipeline snapshot performance-page-view.tsx shows them
 *  on-demand (active leads, unread replies, pending follow-ups) -- recomputed
 *  here rather than imported since that component's math runs client-side
 *  against already-fetched API responses, with nothing server-side to call
 *  into directly. Deliberately NOT the monthly rubric score (scoring.job.ts)
 *  -- different cadence, would be stale by up to 30 days if reused weekly. */
export async function sendWeeklyContractorDigest() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const contractors = await prisma.user.findMany({ where: { role: "CONTRACTOR" }, select: { id: true } });

  await Promise.all(
    contractors.map(async (c) => {
      const [leadsAddedThisWeek, leads, conversations, emailQueue] = await Promise.all([
        prisma.lead.count({
          where: { createdByContractorId: c.id, deletedAt: null, createdAt: { gte: weekAgo } },
        }),
        prisma.lead.findMany({
          where: { createdByContractorId: c.id, deletedAt: null },
          select: { status: true },
        }),
        prisma.conversation.findMany({ where: { recruiterId: c.id }, select: { unread: true } }),
        prisma.emailQueueItem.findMany({ where: { recruiterId: c.id }, select: { status: true } }),
      ]);

      const active = leads.filter((l) => !CLOSED_LEAD_STATUSES.has(l.status)).length;
      const activePct = leads.length ? Math.round((active / leads.length) * 100) : 0;
      const unreadConversations = conversations.filter((cv) => cv.unread).length;
      const followUps = emailQueue.filter((e) => FOLLOW_UP_QUEUE_STATUSES.has(e.status)).length;

      await createNotification({
        recipientId: c.id,
        type: "WEEKLY_LEADS_SUMMARY",
        title: `You added ${leadsAddedThisWeek} lead${leadsAddedThisWeek === 1 ? "" : "s"} this week`,
        body: `you added ${leadsAddedThisWeek} lead${leadsAddedThisWeek === 1 ? "" : "s"} this week.`,
        slackCard: formatWeeklyLeadsSummarySlackCard(leadsAddedThisWeek),
        link: "/contractor/leads",
      }).catch((err) => console.error(`[contractorDigest.job] weekly leads summary failed for ${c.id}:`, err));

      await createNotification({
        recipientId: c.id,
        type: "WEEKLY_PERFORMANCE_SUMMARY",
        title: "Your week in numbers",
        body: `here's your week: ${active} active lead${active === 1 ? "" : "s"} (${activePct}%), ${unreadConversations} unread repl${unreadConversations === 1 ? "y" : "ies"}, ${followUps} follow-up${followUps === 1 ? "" : "s"} pending.`,
        slackCard: formatWeeklyPerformanceSummarySlackCard({ active, activePct, unreadConversations, followUps }),
        link: "/contractor/performance",
      }).catch((err) => console.error(`[contractorDigest.job] weekly performance summary failed for ${c.id}:`, err));
    })
  );
}
