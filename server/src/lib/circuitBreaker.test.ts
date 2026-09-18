/**
 * Run: cd server && npx ts-node src/lib/circuitBreaker.test.ts
 */
import assert from "node:assert";
import { CircuitBreaker } from "./circuitBreaker";

async function test1_passesThroughOnSuccess() {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  const result = await cb.call(() => Promise.resolve("ok"));
  assert.strictEqual(result, "ok");
}

async function test2_opensAfterThresholdFailures() {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => cb.call(() => Promise.reject(new Error("upstream down"))));
  }
  // 4th call should be rejected immediately by the OPEN breaker, not attempt the upstream at all
  let upstreamCalled = false;
  await assert.rejects(
    () =>
      cb.call(() => {
        upstreamCalled = true;
        return Promise.resolve("should not run");
      }),
    /circuit breaker is open/i
  );
  assert.strictEqual(upstreamCalled, false, "breaker must short-circuit without calling the upstream function");
}

async function test3_halfOpensAfterCooldownAndCloses() {
  const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 50 });
  await assert.rejects(() => cb.call(() => Promise.reject(new Error("fail"))));
  await assert.rejects(() => cb.call(() => Promise.reject(new Error("fail"))));
  await new Promise((resolve) => setTimeout(resolve, 60));
  const result = await cb.call(() => Promise.resolve("recovered"));
  assert.strictEqual(result, "recovered");
}

async function main() {
  const tests = [test1_passesThroughOnSuccess, test2_opensAfterThresholdFailures, test3_halfOpensAfterCooldownAndCloses];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
