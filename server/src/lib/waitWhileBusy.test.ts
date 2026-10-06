/**
 * Run: cd server && npx ts-node src/lib/waitWhileBusy.test.ts
 */

import assert from "node:assert";
import { waitWhileBusy } from "./waitWhileBusy";

const busy = (retryAfter?: string) =>
  Object.assign(new Error("409"), { response: { status: 409, headers: retryAfter ? { "retry-after": retryAfter } : {} } });

async function test1_waitsOutA409ThenReturnsTheResult() {
  const slept: number[] = [];
  let calls = 0;
  const result = await waitWhileBusy(
    async () => {
      calls++;
      if (calls < 3) throw busy("15");
      return "stored result";
    },
    Date.now() + 60_000,
    { sleep: async (ms) => void slept.push(ms) }
  );
  assert.strictEqual(result, "stored result");
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(slept, [15_000, 15_000]);
}

async function test2_otherErrorsAreNotRetried() {
  let calls = 0;
  const boom = Object.assign(new Error("500"), { response: { status: 500 } });
  await assert.rejects(
    waitWhileBusy(async () => {
      calls++;
      throw boom;
    }, Date.now() + 60_000, { sleep: async () => {} }),
    (err) => err === boom
  );
  assert.strictEqual(calls, 1);
}

async function test3_givesUpAtTheDeadline() {
  let t = 0;
  let calls = 0;
  await assert.rejects(
    waitWhileBusy(
      async () => {
        calls++;
        throw busy();
      },
      40_000,
      { now: () => t, sleep: async (ms) => void (t += ms) }
    ),
    (err: any) => err.response.status === 409
  );
  // 0 -> 15s -> 30s -> 40s (capped at the deadline) -> give up
  assert.strictEqual(calls, 4);
}

const tests = [test1_waitsOutA409ThenReturnsTheResult, test2_otherErrorsAreNotRetried, test3_givesUpAtTheDeadline];

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
