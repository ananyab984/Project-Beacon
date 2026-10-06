/**
 * Run: cd server && npx ts-node src/lib/gracefulShutdown.test.ts
 */

import assert from "node:assert";
import { runShutdown } from "./gracefulShutdown";

async function test1_runsEveryStepInOrder() {
  const order: string[] = [];
  await runShutdown({
    stopJobs: () => void order.push("stop"),
    drain: async () => void order.push("drain"),
    requeue: async () => (order.push("requeue"), 3),
    close: async () => void order.push("close"),
    log: () => {},
  });
  assert.deepStrictEqual(order, ["stop", "drain", "requeue", "close"]);
}

async function test2_requeueStillRunsWhenTheDrainFails() {
  const order: string[] = [];
  await runShutdown({
    stopJobs: () => {
      throw new Error("cron gone");
    },
    drain: async () => {
      throw new Error("drain blew up");
    },
    requeue: async () => (order.push("requeue"), 1),
    close: async () => void order.push("close"),
    log: () => {},
  });
  assert.deepStrictEqual(order, ["requeue", "close"]);
}

const tests = [test1_runsEveryStepInOrder, test2_requeueStillRunsWhenTheDrainFails];

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
