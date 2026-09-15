/**
 * One-time backfill for EmailQueueItem.addedManually on rows that predate
 * the column (migration 20260911000000_add_email_queue_item_added_manually
 * defaults every row to true). Historical rows created by the now-removed
 * lead.routes.ts auto-add-on-lead-creation side effect need to be flagged
 * false instead, so GET /api/email-queue (which now filters on this column)
 * stops showing/counting leads a recruiter never actually chose to add via
 * the queue page's own "Search Lead" -> add action.
 *
 * There's no explicit historical record of which path created a given row,
 * but there IS a reliable proxy: the removed auto-add always ran in the
 * SAME request that created the lead, so its EmailQueueItem.receivedAt is
 * (near-)identical to Lead.createdAt. An explicit add via the queue page
 * happens at some LATER point, however small the gap. Confirmed against
 * the real dev DB (2026-09-11): of 39 existing rows, every one auto-added
 * by the bug had a gap of 0-1 seconds; every genuinely explicit add had a
 * gap of at least ~1 hour (the smallest observed was 25738s). A 60-second
 * threshold sits with wide margin in the gap between those two clusters,
 * so it isn't a fragile cutoff picked to match today's data by coincidence.
 *
 * This is non-destructive: no row is deleted, only the flag is set, so an
 * incorrectly-hidden lead can always be brought back into view by
 * searching for it and adding it again through the queue page (which also
 * promotes the existing row back to addedManually: true instead of
 * duplicating it -- see POST /api/email-queue).
 *
 * Run: cd server && npx ts-node scripts/backfill-email-queue-added-manually.ts
 */
import { prisma } from "../src/prisma";

const AUTO_ADD_GAP_THRESHOLD_MS = 60_000;

async function main() {
  const items = await prisma.emailQueueItem.findMany({
    select: { id: true, candidateName: true, receivedAt: true, recruiterId: true, lead: { select: { createdAt: true } } },
  });

  let flaggedAutoAdded = 0;
  let leftManual = 0;

  for (const item of items) {
    const gapMs = item.receivedAt.getTime() - item.lead.createdAt.getTime();
    if (gapMs < AUTO_ADD_GAP_THRESHOLD_MS) {
      await prisma.emailQueueItem.update({ where: { id: item.id }, data: { addedManually: false } });
      flaggedAutoAdded++;
      console.log(`Flagged auto-added: ${item.candidateName} (gap=${Math.round(gapMs / 1000)}s)`);
    } else {
      leftManual++;
    }
  }

  console.log(`\n${flaggedAutoAdded} row(s) flagged as auto-added (addedManually=false), ${leftManual} left as genuinely manual.`);
  await prisma.$disconnect();
}
main();
