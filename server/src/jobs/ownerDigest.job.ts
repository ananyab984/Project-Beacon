import { prisma } from "../prisma";
import { createNotification, formatWeeklyTeamHealthSlackCard, getActiveOwnerIds } from "../services/notification.service";
import { computeTeamHealthStats } from "../routes/reports.routes";

/** Weekly, every owner: team avg score + fill rate -- computed the same way
 *  GET /api/reports/analytics computes them (see computeTeamHealthStats),
 *  plus a 7-day escalation count, which reports.routes.ts doesn't query
 *  today. */
export async function sendWeeklyTeamHealthDigest() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);

  const [{ teamAvgScore, fillRate }, escalationGroups, ownerIds] = await Promise.all([
    computeTeamHealthStats(),
    prisma.escalation.groupBy({ by: ["category"], where: { createdAt: { gte: weekAgo } }, _count: true }),
    getActiveOwnerIds(),
  ]);

  const escalationCount = escalationGroups.reduce((sum, g) => sum + g._count, 0);
  const stats = { teamAvgScore, fillRate, escalationCount };

  await Promise.all(
    ownerIds.map((ownerId) =>
      createNotification({
        recipientId: ownerId,
        type: "WEEKLY_TEAM_HEALTH_SUMMARY",
        title: "Your team's week in numbers",
        body: `your team's week: avg. score ${teamAvgScore}, fill rate ${fillRate}%, ${escalationCount} escalation${escalationCount === 1 ? "" : "s"}.`,
        slackCard: formatWeeklyTeamHealthSlackCard(stats),
        link: "/owner/reports",
      }).catch((err) => console.error(`[ownerDigest.job] weekly team health digest failed for ${ownerId}:`, err))
    )
  );
}
