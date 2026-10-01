import { prisma } from "../prisma";
import { purgeCutoff } from "../lib/recycleBin";

/** Daily sweep: permanently removes each recycle-bin lead once ITS OWN
 *  30-day window has elapsed -- Windows Recycle Bin semantics (every item
 *  ages out independently), not a single bin-wide expiry.
 *
 *  A single deleteMany with `deletedAt` re-checked directly in its own WHERE
 *  clause -- not a two-step "read candidates, then delete by id list" -- so a
 *  restore (POST /:id/restore) landing between an earlier scan and this call
 *  can't have its lead purged out from under it: by the time this statement
 *  runs, a just-restored row's deletedAt is already null and it no longer
 *  matches. Every dependent row (flags, conversations, interaction events,
 *  email queue items, ...) cascades via the `onDelete: Cascade` already
 *  declared on its `lead` relation in schema.prisma, so there's nothing left
 *  to clean up manually.
 *
 *  Takes an optional `now` so tests can simulate "30 days later" without
 *  waiting or mocking Date globally. */
export async function purgeExpiredRecycleBinLeads(now: Date = new Date()) {
  const result = await prisma.lead.deleteMany({ where: { deletedAt: { lte: purgeCutoff(now) } } });
  return { purgedCount: result.count };
}
