/**
 * Pure unit tests for the recycle-bin retention math (server/src/lib/recycleBin.ts),
 * shared by GET /api/leads/bin and recycleBinPurge.job.ts. No DB involved.
 *
 * Run: cd server && npx ts-node src/lib/recycleBin.test.ts
 */
import assert from "node:assert";
import { RECYCLE_BIN_RETENTION_DAYS, computePurgeAt, daysUntilPurge, isPastRetention } from "./recycleBin";

const DAY_MS = 24 * 60 * 60 * 1000;

function test1_purgeAtIsExactlyThirtyDaysAfterDeletion() {
  const deletedAt = new Date("2026-01-01T00:00:00.000Z");
  const purgeAt = computePurgeAt(deletedAt);
  assert.strictEqual(purgeAt.getTime() - deletedAt.getTime(), RECYCLE_BIN_RETENTION_DAYS * DAY_MS);
}

function test2_daysUntilPurgeCountsDownFromThirty() {
  const deletedAt = new Date("2026-01-01T00:00:00.000Z");
  const rightAfterDeletion = new Date(deletedAt.getTime() + 1);
  assert.strictEqual(daysUntilPurge(deletedAt, rightAfterDeletion), 30);
}

function test3_daysUntilPurgeIsPerItemNotBinWide() {
  // Two items deleted on different days must each carry their own
  // independent countdown -- neither one's remaining days depends on when
  // the other was deleted (the whole point of "not a single bin-wide 30-day
  // clock").
  const now = new Date("2026-01-20T00:00:00.000Z");
  const deletedYesterday = new Date("2026-01-19T00:00:00.000Z");
  const deletedTenDaysAgo = new Date("2026-01-10T00:00:00.000Z");
  assert.strictEqual(daysUntilPurge(deletedYesterday, now), 29);
  assert.strictEqual(daysUntilPurge(deletedTenDaysAgo, now), 20);
}

function test4_daysUntilPurgeNeverGoesNegative() {
  const deletedAt = new Date("2026-01-01T00:00:00.000Z");
  const wayPastRetention = new Date(deletedAt.getTime() + 90 * DAY_MS);
  assert.strictEqual(daysUntilPurge(deletedAt, wayPastRetention), 0);
}

function test5_isPastRetentionFlipsExactlyAtThirtyDays() {
  const deletedAt = new Date("2026-01-01T00:00:00.000Z");
  const purgeAt = computePurgeAt(deletedAt);
  assert.strictEqual(isPastRetention(deletedAt, new Date(purgeAt.getTime() - 1)), false);
  assert.strictEqual(isPastRetention(deletedAt, purgeAt), true);
  assert.strictEqual(isPastRetention(deletedAt, new Date(purgeAt.getTime() + 1)), true);
}

function main() {
  const tests = [
    test1_purgeAtIsExactlyThirtyDaysAfterDeletion,
    test2_daysUntilPurgeCountsDownFromThirty,
    test3_daysUntilPurgeIsPerItemNotBinWide,
    test4_daysUntilPurgeNeverGoesNegative,
    test5_isPastRetentionFlipsExactlyAtThirtyDays,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
