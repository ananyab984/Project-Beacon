/**
 * Unit tests for the Autumn poll loop's terminal-state and deadline rules --
 * the difference between "we waited for the agent" and "the recruiter's
 * modal hung forever", and between "finished" and "hasn't started yet"
 * (Autumn reports both as activity: "idle").
 *
 * Uses a fake clock and fake sleep, so it neither waits 300 real seconds nor
 * touches the network.
 *
 * Run: cd server && npx ts-node src/jobs/reenrichment.job.test.ts
 */

import assert from "node:assert";
import { pollUntilIdle, parseCreditSnapshot, creditsSpent, type TaskState } from "./reenrichment.job";

/** Verbatim GET /credits body, captured from the real API on 2026-09-08. */
const REAL_CREDITS_BODY = {
  plan: null,
  unlimited: false,
  credits_remaining: 0,
  credits_used: 500,
  credits_total: 500,
  monthly_credits: null,
  billing_reset_at: null,
};

async function test7_creditsAreReadFromTheRealResponseShape() {
  // The PoC guessed at "balance"/"credits"/"credit_balance"/"remaining"/
  // "available_credits" -- none of which Autumn actually sends, so every run
  // logged a null cost. This pins the shape that's really on the wire.
  const snap = parseCreditSnapshot(REAL_CREDITS_BODY);
  assert.deepStrictEqual(snap, { used: 500, remaining: 0 });
  assert.deepStrictEqual(parseCreditSnapshot({}), { used: null, remaining: null });
}

async function test8_costUsesTheMonotonicCounterNotTheBalance() {
  const before = { used: 100, remaining: 400 };
  assert.strictEqual(creditsSpent(before, { used: 107, remaining: 393 }), 7);

  // A top-up landing mid-run inflates `remaining`; the used counter is the
  // only one that still reports the true cost rather than a negative number.
  assert.strictEqual(creditsSpent(before, { used: 107, remaining: 9393 }), 7);
  assert.strictEqual(creditsSpent(before, { used: null, remaining: 393 }), 7, "falls back to the balance diff when the counter is absent");
  assert.strictEqual(creditsSpent(null, { used: 107, remaining: 393 }), null, "an unreadable snapshot reports unknown, not a bogus 0");
}

/** Fake clock that only advances when the code under test sleeps. */
function fakeDeps(states: TaskState[]) {
  let clock = 0;
  const polls: number[] = [];
  return {
    deps: {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      fetchTask: async () => {
        polls.push(clock);
        return states[Math.min(polls.length - 1, states.length - 1)];
      },
    },
    polls,
    elapsed: () => clock,
  };
}

const RUNNING: TaskState = { status: "plan", activity: "executing" };
const IDLE: TaskState = { status: "plan", activity: "idle" };

async function test1_idleAfterRunningIsCompletion() {
  const { deps } = fakeDeps([RUNNING, RUNNING, IDLE]);
  const result = await pollUntilIdle("t1", 300_000, deps);
  assert.strictEqual(result.outcome, "idle");
}

async function test2_idleBeforeStartIsNotCompletion() {
  // A task that never leaves idle and never produces output is a task that
  // never started -- treating that first idle as "done" would hand the
  // recruiter an empty result instantly.
  const { deps, elapsed } = fakeDeps([IDLE]);
  const result = await pollUntilIdle("t2", 300_000, deps);
  assert.strictEqual(result.outcome, "timed_out");
  assert.ok(elapsed() >= 300_000, "it should have waited out the full deadline, not exited early");
}

async function test3_idleWithOutputCatchesAFastFinish() {
  // Finished between two polls: never observed running, but output exists.
  const { deps } = fakeDeps([{ status: "plan", activity: "idle", output_count: 1 }]);
  const result = await pollUntilIdle("t3", 300_000, deps);
  assert.strictEqual(result.outcome, "idle");
}

async function test4_deadlineIsHonouredAndNeverOvershot() {
  const { deps, elapsed } = fakeDeps([RUNNING]);
  const result = await pollUntilIdle("t4", 300_000, deps);
  assert.strictEqual(result.outcome, "timed_out");
  assert.strictEqual(elapsed(), 300_000, "the loop must stop exactly at the deadline, not sleep past it");
}

async function test5_deletedTaskIsTerminalNotATimeout() {
  const { deps } = fakeDeps([RUNNING, { status: "deleted" }]);
  const result = await pollUntilIdle("t5", 300_000, deps);
  assert.strictEqual(result.outcome, "deleted", "out-of-credits mid-run must surface as its own failure, not a 5-minute wait");
}

async function test6_backoffGrowsAndRespectsAutumnsHint() {
  const { deps, polls } = fakeDeps([RUNNING]);
  await pollUntilIdle("t6", 300_000, deps);
  const gaps = polls.slice(1).map((t, i) => t - polls[i]);
  assert.deepStrictEqual(gaps.slice(0, 4), [5_000, 10_000, 20_000, 30_000], "should double 5s -> 30s, not poll at a fixed short interval");
  assert.ok(gaps.every((g) => g <= 30_000), "backoff must stay capped at the 30s ceiling");

  const hinted = fakeDeps([{ ...RUNNING, poll_after_s: 12 }]);
  await pollUntilIdle("t6b", 60_000, hinted.deps);
  assert.strictEqual(hinted.polls[1] - hinted.polls[0], 12_000, "Autumn's own poll_after_s hint wins over our default");
}

async function main() {
  const tests = [
    test1_idleAfterRunningIsCompletion,
    test2_idleBeforeStartIsNotCompletion,
    test3_idleWithOutputCatchesAFastFinish,
    test4_deadlineIsHonouredAndNeverOvershot,
    test5_deletedTaskIsTerminalNotATimeout,
    test6_backoffGrowsAndRespectsAutumnsHint,
    test7_creditsAreReadFromTheRealResponseShape,
    test8_costUsesTheMonotonicCounterNotTheBalance,
  ];

  let failed = 0;
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

  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
