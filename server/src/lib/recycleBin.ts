/** Recycle-bin retention window: each soft-deleted lead gets its own 30-day
 *  countdown from its own deletedAt (Windows Recycle Bin semantics -- the
 *  bin itself never empties on a fixed schedule, only individual items age
 *  out). GET /api/leads/bin and recycleBinPurge.job.ts both derive from this
 *  single constant so the displayed countdown and the actual purge cutoff
 *  can never drift apart. */
export const RECYCLE_BIN_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function computePurgeAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + RECYCLE_BIN_RETENTION_DAYS * DAY_MS);
}

/** Whole days left until this item is purged, floored at 0 (never negative).
 *  0 means "purges today" -- still restorable up to the exact purgeAt instant. */
export function daysUntilPurge(deletedAt: Date, now: Date = new Date()): number {
  const msLeft = computePurgeAt(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(msLeft / DAY_MS));
}

export function isPastRetention(deletedAt: Date, now: Date = new Date()): boolean {
  return computePurgeAt(deletedAt).getTime() <= now.getTime();
}
