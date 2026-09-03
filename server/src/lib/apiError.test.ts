/**
 * Unit tests for toApiError's handling of RetryExhaustedError/
 * DeadlineExceededError -- confirms a retry-exhausted or deadline-exceeded
 * failure surfaces the real upstream status instead of falling through to a
 * generic 500.
 *
 * Run: cd server && npx ts-node src/lib/apiError.test.ts
 */

import assert from "node:assert";
import { ApiError, toApiError } from "./apiError";
import { RetryExhaustedError, DeadlineExceededError } from "./retryWithBackoff";

function axiosLikeError(status: number, data?: any) {
  return { response: { status, data } };
}

async function test1_retryExhaustedUnwrapsToUpstreamStatus() {
  const cause = axiosLikeError(429, { message: "Too many requests" });
  const err = new RetryExhaustedError("All 5 attempts failed", cause);

  const apiErr = toApiError(err);
  assert.strictEqual(apiErr.statusCode, 502, "should map through the same upstream-status branch a raw axios error would hit");
  assert.ok(apiErr.message.includes("429"), "should surface the real upstream status, not a generic 500");
}

async function test2_deadlineExceededWithNoCauseMapsTo504() {
  const err = new DeadlineExceededError("Deadline of 15000ms exceeded");
  const apiErr = toApiError(err);
  assert.strictEqual(apiErr.statusCode, 504);
  assert.strictEqual(apiErr.code, "UPSTREAM_TIMEOUT");
}

async function test3_deadlineExceededWithCauseUnwraps() {
  const cause = axiosLikeError(503);
  const err = new DeadlineExceededError("Deadline exceeded", cause);
  const apiErr = toApiError(err);
  assert.strictEqual(apiErr.statusCode, 502, "a cause, if present, should still be unwrapped rather than defaulting to 504");
}

async function test4_plainApiErrorPassesThroughUnchanged() {
  const original = new ApiError(404, "NOT_FOUND", "nope");
  assert.strictEqual(toApiError(original), original);
}

async function test5_ordinaryErrorFallsBackToFiveHundred() {
  const apiErr = toApiError(new Error("something broke"));
  assert.strictEqual(apiErr.statusCode, 500);
  assert.strictEqual(apiErr.message, "something broke");
}

async function main() {
  const tests = [
    test1_retryExhaustedUnwrapsToUpstreamStatus,
    test2_deadlineExceededWithNoCauseMapsTo504,
    test3_deadlineExceededWithCauseUnwraps,
    test4_plainApiErrorPassesThroughUnchanged,
    test5_ordinaryErrorFallsBackToFiveHundred,
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
