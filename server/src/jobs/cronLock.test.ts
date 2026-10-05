/**
 * Cross-instance cron lock tests (audit AUDIT-33). Real dev database: each
 * "instance" is a concurrent claimTick call, which is exactly what two
 * servers racing on the same tick look like to Postgres. Uses test-only job
 * names and deletes its own system_config rows before and after.
 *
 * Run: cd server && npx ts-node src/jobs/cronLock.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { claimTick, runOncePerTick, tickId } from "./cronLock";

const PREFIX = "test_cronlock_";

async function cleanup() {
  await prisma.systemConfig.deleteMany({ where: { key: { contains: `:${PREFIX}` } } });
}

async function test1_exactlyOneOfFiveRacingInstancesWinsATick() {
  const tick = "2026-10-05T08:00:00.000Z";
  const results = await Promise.all(Array.from({ length: 5 }, () => claimTick(`${PREFIX}race`, tick)));
  assert.strictEqual(results.filter(Boolean).length, 1, `exactly one winner, got ${JSON.stringify(results)}`);
}

async function test2_aClaimedTickCanNeverBeClaimedAgain() {
  const tick = "2026-10-05T09:00:00.000Z";
  assert.strictEqual(await claimTick(`${PREFIX}repeat`, tick), true);
  assert.strictEqual(await claimTick(`${PREFIX}repeat`, tick), false, "even after the first run has finished");
}

async function test3_theNextTickIsFreeAndAnOlderOneNeverIs() {
  const name = `${PREFIX}sequence`;
  assert.strictEqual(await claimTick(name, "2026-10-05T10:00:00.000Z"), true);
  assert.strictEqual(await claimTick(name, "2026-10-05T10:03:00.000Z"), true, "the next scheduled run is a new tick");
  assert.strictEqual(await claimTick(name, "2026-10-05T10:00:00.000Z"), false, "a late, older tick must not run again");
}

async function test4_jobsAndTicksAreIndependent() {
  const tick = "2026-10-05T11:00:00.000Z";
  assert.strictEqual(await claimTick(`${PREFIX}job_a`, tick), true);
  assert.strictEqual(await claimTick(`${PREFIX}job_b`, tick), true, "a different job on the same tick is unaffected");
}

function test5_tickIdAbsorbsClockSkewAroundTheMinute() {
  const at = (iso: string) => tickId(Date.parse(iso));
  assert.strictEqual(at("2026-10-05T08:00:00.400Z"), "2026-10-05T08:00:00.000Z", "a server firing slightly late");
  assert.strictEqual(at("2026-10-05T07:59:59.600Z"), "2026-10-05T08:00:00.000Z", "a server whose clock is slightly behind");
  assert.notStrictEqual(at("2026-10-05T08:03:00.100Z"), at("2026-10-05T08:00:00.100Z"), "consecutive 3-minute ticks differ");
}

async function test6_runOncePerTickRunsTheJobOnceWhenInstancesRace() {
  let runs = 0;
  const job = async () => {
    runs++;
  };
  // Racing on the real current tick, under a test-only name.
  await Promise.all(Array.from({ length: 4 }, () => runOncePerTick(`${PREFIX}run_once`, job)));
  assert.strictEqual(runs, 1);
}

async function main() {
  const tests = [
    test1_exactlyOneOfFiveRacingInstancesWinsATick,
    test2_aClaimedTickCanNeverBeClaimedAgain,
    test3_theNextTickIsFreeAndAnOlderOneNeverIs,
    test4_jobsAndTicksAreIndependent,
    test5_tickIdAbsorbsClockSkewAroundTheMinute,
    test6_runOncePerTickRunsTheJobOnceWhenInstancesRace,
  ];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  await cleanup();
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
