/**
 * Run: cd server && npx ts-node src/lib/mapWithConcurrency.test.ts
 */

import assert from "node:assert";
import { mapWithConcurrency } from "./mapWithConcurrency";

async function test1_neverExceedsTheConcurrencyLimit() {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);

  await mapWithConcurrency(items, 3, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
  });

  assert.ok(maxInFlight <= 3, `saw ${maxInFlight} in flight, limit was 3`);
  assert.ok(maxInFlight >= 2, "concurrency 3 over 10 items should overlap at least some of the time");
}

async function test2_everyItemIsProcessedExactlyOnce() {
  const seen: number[] = [];
  const items = [1, 2, 3, 4, 5];
  await mapWithConcurrency(items, 2, async (i) => {
    seen.push(i);
  });
  assert.deepStrictEqual(seen.slice().sort((a, b) => a - b), items);
  assert.strictEqual(seen.length, items.length, "no item processed twice");
}

async function test3_concurrency_larger_than_the_list_is_fine() {
  const seen: number[] = [];
  await mapWithConcurrency([1, 2], 10, async (i) => {
    seen.push(i);
  });
  assert.strictEqual(seen.length, 2);
}

async function test4_emptyListDoesNothing() {
  let calls = 0;
  await mapWithConcurrency([], 4, async () => {
    calls++;
  });
  assert.strictEqual(calls, 0);
}

async function test5_oneItemFailingDoesNotStopTheOthers() {
  const seen: number[] = [];
  const items = [1, 2, 3, 4];
  await assert.rejects(
    mapWithConcurrency(items, 2, async (i) => {
      seen.push(i);
      if (i === 2) throw new Error("boom");
    }),
    /boom/
  );
  // Workers already in flight when item 2 threw still ran to completion --
  // this pins the actual behavior (a bare Promise.all over N workers, so a
  // throw in one worker does not cancel the others), not a claim that every
  // item is guaranteed to run. enrichment.job.ts wraps each call in its own
  // try/catch precisely because mapWithConcurrency itself does not swallow
  // errors -- callers that need "keep going regardless" must catch inside fn.
  assert.ok(seen.length >= 2, `expected at least 2 items attempted, saw ${seen.length}`);
}

const tests = [
  test1_neverExceedsTheConcurrencyLimit,
  test2_everyItemIsProcessedExactlyOnce,
  test3_concurrency_larger_than_the_list_is_fine,
  test4_emptyListDoesNothing,
  test5_oneItemFailingDoesNotStopTheOthers,
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
