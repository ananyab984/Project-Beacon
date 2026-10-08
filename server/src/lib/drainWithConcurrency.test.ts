/**
 * Run: cd server && npx ts-node src/lib/drainWithConcurrency.test.ts
 */

import assert from "node:assert";
import { drainWithConcurrency } from "./drainWithConcurrency";

/** A fake queue standing in for the PENDING-lead claim query. */
function queueOf<T>(items: T[]) {
  const q = [...items];
  return { q, claimNext: async () => (q.length ? q.shift()! : null) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function test1_neverClaimsMoreThanItCanWorkOn() {
  // The bug this exists to fix: a claimed item is marked IN_PROGRESS, so an
  // item claimed but not yet being worked on is exactly the "Enriching (96%)"
  // row that was really just queued. claimed - finished must never exceed
  // the concurrency limit.
  let claimed = 0;
  let finished = 0;
  let maxOutstanding = 0;
  const { q } = queueOf(Array.from({ length: 20 }, (_, i) => i));

  await drainWithConcurrency(
    8,
    async () => {
      if (!q.length) return null;
      claimed++;
      maxOutstanding = Math.max(maxOutstanding, claimed - finished);
      return q.shift()!;
    },
    async () => {
      await tick();
      finished++;
    }
  );

  assert.ok(maxOutstanding <= 8, `saw ${maxOutstanding} claimed-but-unfinished, limit was 8`);
  assert.ok(maxOutstanding >= 2, "8 workers over 20 items should overlap");
  assert.strictEqual(finished, 20);
}

async function test2_everyItemIsProcessedExactlyOnce() {
  const seen: number[] = [];
  const { claimNext } = queueOf([1, 2, 3, 4, 5]);
  await drainWithConcurrency(2, claimNext, async (i) => {
    seen.push(i);
  });
  assert.deepStrictEqual(seen.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5]);
}

async function test3_itemsArrivingMidDrainArePickedUp() {
  // A bulk upload landing while the poller is already draining must be
  // worked by the SAME workers, not left for the next cron tick.
  const seen: number[] = [];
  const { q, claimNext } = queueOf([1, 2]);
  await drainWithConcurrency(2, claimNext, async (i) => {
    if (i === 1) q.push(3, 4);
    await tick();
    seen.push(i);
  });
  assert.deepStrictEqual(seen.slice().sort(), [1, 2, 3, 4]);
}

async function test4_emptyQueueDoesNothing() {
  let calls = 0;
  await drainWithConcurrency(4, async () => null, async () => {
    calls++;
  });
  assert.strictEqual(calls, 0);
}

async function test5_aSlowItemDoesNotHoldUpTheOtherSlots() {
  // Under the old fixed-batch design, the next batch waited for the slowest
  // lead of the current one. Here a slow item occupies only its own worker.
  const order: string[] = [];
  const { claimNext } = queueOf(["slow", "a", "b", "c"]);
  await drainWithConcurrency(2, claimNext, async (item) => {
    await new Promise((r) => setTimeout(r, item === "slow" ? 60 : 5));
    order.push(item);
  });
  assert.strictEqual(order[order.length - 1], "slow", `the fast items should all finish first, got ${order}`);
}

async function test6_aFailedClaimDoesNotRejectOrStopTheOtherWorkers() {
  const queue = [1, 2, 3, 4, 5, 6];
  let claims = 0;
  const done: number[] = [];
  const claimNext = async () => {
    // The first claim throws (e.g. a DB pool timeout); every other worker must still drain the queue.
    if (claims++ === 0) throw new Error("pool timeout");
    return queue.shift() ?? null;
  };
  await drainWithConcurrency(3, claimNext, async (n) => {
    done.push(n);
  });
  assert.deepStrictEqual(done.sort(), [1, 2, 3, 4, 5, 6]);
}

const tests = [
  test1_neverClaimsMoreThanItCanWorkOn,
  test2_everyItemIsProcessedExactlyOnce,
  test3_itemsArrivingMidDrainArePickedUp,
  test4_emptyQueueDoesNothing,
  test5_aSlowItemDoesNotHoldUpTheOtherSlots,
  test6_aFailedClaimDoesNotRejectOrStopTheOtherWorkers,
];

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`  PASS  ${t.name}`);
    } catch (err: any) {
      failed++;
      console.error(`  FAIL  ${t.name}: ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed}/${tests.length} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
