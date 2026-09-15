/** Presentation-only formatting for a recycle-bin row's countdown. The actual
 *  day count is computed server-side (server/src/lib/recycleBin.ts) and sent
 *  as `daysUntilPurge` on every GET /api/leads/bin row -- this just turns
 *  that number into copy, mirroring how Windows' own Recycle Bin shows each
 *  item's own remaining time rather than one bin-wide countdown. */
export function formatDaysUntilPurge(days: number): string {
  if (days <= 0) return "Deletes today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}
