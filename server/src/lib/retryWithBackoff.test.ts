/**
 * Unit tests for the shared retry/backoff + wall-clock-deadline utility.
 *
 * No test runner is configured in this project (see package.json) -- matches
 * the existing convention in src/__tests__/webhook.test.ts: a standalone
 * script with manual assertions, not a framework.
 *
 * Run: cd server && npx ts-node src/lib/retryWithBackoff.test.ts
 */

import assert from "node:assert";
import { retryWithBackoff, RetryExhaustedError, DeadlineExceededError, isRetryableByDefault } from "./retryWithBackoff";

function retryableError(status: number) {
  return { response: { status } };
}

async function test1_defaultContractIsFiveAttemptsWithDoublingDelay() {
  const delays: number[] = [];
  let calls = 0;
  const sleep = async (ms: number) => {
    delays.push(ms);
  };

  await assert.rejects(
    () =>
      retryWithBackoff(async () => {
        calls++;
        throw retryableError(500);
      }, { sleep }),
    RetryExhaustedError
  );

  assert.strictEqual(calls, 5, "expected 5 total attempts (1 initial + 4 retries)");
  assert.deepStrictEqual(delays, [1000, 2000, 4000, 8000], "expected 1s/2s/4s/8s delay sequence");
}

async function test2_nonRetryableErrorShortCircuitsImmediately() {
  let calls = 0;
  const sleep = async () => {
    throw new Error("sleep should never be called for a non-retryable error");
  };

  await assert.rejects(
    () =>
      retryWithBackoff(async () => {
        calls++;
        throw retryableError(401);
      }, { sleep }),
    (err: unknown) => !(err instanceof RetryExhaustedError)
  );

  assert.strictEqual(calls, 1, "a non-retryable error must not be retried");
}

async function test3_succeedsWithoutRetryingOnFirstSuccess() {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    return "ok";
  });
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 1);
}

async function test4_deadlineFiresAndAbortsInFlightCall() {
  let observedSignal: AbortSignal | undefined;
  let abortedInsideFn = false;

  await assert.rejects(
    () =>
      retryWithBackoff(
        (signal) => {
          observedSignal = signal;
          return new Promise((_, reject) => {
            signal?.addEventListener("abort", () => {
              abortedInsideFn = true;
              reject(new Error("aborted"));
            });
            // Deliberately never resolves on its own -- forces the deadline
            // branch to win the race so we can observe the abort.
          });
        },
        { deadlineMs: 30 }
      ),
    DeadlineExceededError
  );

  assert.ok(observedSignal, "fn must receive an AbortSignal when deadlineMs is set");
  assert.strictEqual(observedSignal?.aborted, true, "the signal passed to fn must actually be aborted when the deadline fires");
  assert.strictEqual(
    abortedInsideFn,
    true,
    "fn's own abort listener must have fired -- proves it's the SAME signal instance that gets aborted, not a decoy"
  );
}

async function test5_deadlineDoesNotAffectCallersWhoDontPassIt() {
  const result = await retryWithBackoff(async (signal) => {
    assert.strictEqual(signal, undefined, "signal must be undefined when no deadlineMs is set");
    return "done";
  });
  assert.strictEqual(result, "done");
}

async function test6_deadlineExceededEvenWithAttemptsRemaining() {
  let calls = 0;
  await assert.rejects(
    () =>
      retryWithBackoff(
        async () => {
          calls++;
          throw retryableError(500);
        },
        // baseDelayMs of 50ms means the backoff sleep before attempt 2 alone
        // already exceeds the 30ms deadline -- it must win before all 5
        // attempts run, exactly the "abort mid-sequence" case this exists for.
        { deadlineMs: 30, baseDelayMs: 50 }
      ),
    DeadlineExceededError
  );
  assert.ok(calls < 5, `expected the deadline to cut the sequence short, got ${calls} attempts`);
}

async function test7_isRetryableByDefaultClassifiesStatusesCorrectly() {
  assert.strictEqual(isRetryableByDefault({ response: { status: 429 } }), true, "429 is retryable");
  assert.strictEqual(isRetryableByDefault({ response: { status: 500 } }), true, "5xx is retryable");
  assert.strictEqual(isRetryableByDefault({ response: { status: 503 } }), true, "5xx is retryable");
  assert.strictEqual(isRetryableByDefault({ response: { status: 400 } }), false, "400 is not retryable");
  assert.strictEqual(isRetryableByDefault({ response: { status: 401 } }), false, "401 is not retryable");
  assert.strictEqual(isRetryableByDefault({}), true, "no response (network/timeout error) is retryable");
}

async function main() {
  const tests = [
    test1_defaultContractIsFiveAttemptsWithDoublingDelay,
    test2_nonRetryableErrorShortCircuitsImmediately,
    test3_succeedsWithoutRetryingOnFirstSuccess,
    test4_deadlineFiresAndAbortsInFlightCall,
    test5_deadlineDoesNotAffectCallersWhoDontPassIt,
    test6_deadlineExceededEvenWithAttemptsRemaining,
    test7_isRetryableByDefaultClassifiesStatusesCorrectly,
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
