import { prisma } from "../prisma";
import { isPastRetention } from "../lib/recycleBin";

/** Daily sweep: permanently removes each recycle-bin lead once ITS OWN
 *  30-day window has elapsed -- Windows Recycle Bin semantics (every item
 *  ages out independently), not a single bin-wide expiry. Mirrors the exact
 *  cascade cleanup the old hard-delete batch-delete route used to do inline
 *  (lead.routes.ts), just deferred from delete-time to retention-expiry.
 *  Takes an optional `now` so tests can simulate "30 days later" without
 *  waiting or mocking Date globally. */
export async function purgeExpiredRecycleBinLeads(now: Date = new Date()) {
  const candidates = await prisma.lead.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, deletedAt: true },
  });
  const expiredIds = candidates.filter((lead) => isPastRetention(lead.deletedAt!, now)).map((lead) => lead.id);
  if (expiredIds.length === 0) return { purgedCount: 0 };

  await prisma.$transaction([
    prisma.emailQueueItem.deleteMany({ where: { leadId: { in: expiredIds } } }),
    prisma.conversationMessage.deleteMany({ where: { conversation: { leadId: { in: expiredIds } } } }),
    prisma.conversation.deleteMany({ where: { leadId: { in: expiredIds } } }),
    prisma.leadFlagEvent.deleteMany({ where: { leadId: { in: expiredIds } } }),
    prisma.interactionEvent.deleteMany({ where: { leadId: { in: expiredIds } } }),
    prisma.lead.deleteMany({ where: { id: { in: expiredIds } } }),
  ]);
  return { purgedCount: expiredIds.length };
}
