/**
 * Unit tests for the re-enrichment cost guardrail -- the only thing standing
 * between a recruiter re-clicking one lead and unbounded Autumn credit spend.
 *
 * Run: cd server && npx ts-node src/lib/reenrichmentRateLimit.test.ts
 */

import assert from "node:assert";
import { checkReenrichmentRateLimit } from "./reenrichmentRateLimit";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const OPTS = { cooldownMinutes: 10, dailyCap: 3 };
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

function test1_firstEverRunIsAllowed() {
  assert.deepStrictEqual(checkReenrichmentRateLimit([], NOW, OPTS), { allowed: true });
}

function test2_secondClickInsideCooldownIsBlocked() {
  const result = checkReenrichmentRateLimit([minutesAgo(2)], NOW, OPTS);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "COOLDOWN");
  assert.strictEqual(result.retryAt?.toISOString(), minutesAgo(2 - 10).toISOString());
  assert.ok(result.message?.includes("8 minutes"), `expected a remaining-time hint, got: ${result.message}`);
}

function test3_cooldownExpiryAllowsAgain() {
  assert.strictEqual(checkReenrichmentRateLimit([minutesAgo(11)], NOW, OPTS).allowed, true);
}

function test4_dailyCapBlocksEvenAfterCooldown() {
  // Three runs today, all well outside the 10-minute cooldown.
  const result = checkReenrichmentRateLimit([hoursAgo(9), hoursAgo(5), hoursAgo(1)], NOW, OPTS);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "DAILY_CAP");
  assert.strictEqual(
    result.retryAt?.toISOString(),
    new Date(hoursAgo(9).getTime() + 24 * 3_600_000).toISOString(),
    "the cap frees up when the oldest counted run rolls out of the 24h window"
  );
}

function test5_runsOlderThanADayDontCountTowardTheCap() {
  const result = checkReenrichmentRateLimit([hoursAgo(30), hoursAgo(26), hoursAgo(25), hoursAgo(2)], NOW, OPTS);
  assert.strictEqual(result.allowed, true, "only one run falls inside the rolling 24h window");
}

function test6_failedAndTimedOutRunsStillCount() {
  // Callers pass startedAt for runs of EVERY status: a run that timed out
  // still spent Autumn credits, so excluding it would reopen the exact hole
  // this guardrail exists to close.
  const result = checkReenrichmentRateLimit([hoursAgo(6), hoursAgo(4), hoursAgo(3)], NOW, OPTS);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "DAILY_CAP");
}

function main() {
  const tests = [
    test1_firstEverRunIsAllowed,
    test2_secondClickInsideCooldownIsBlocked,
    test3_cooldownExpiryAllowsAgain,
    test4_dailyCapBlocksEvenAfterCooldown,
    test5_runsOlderThanADayDontCountTowardTheCap,
    test6_failedAndTimedOutRunsStillCount,
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
