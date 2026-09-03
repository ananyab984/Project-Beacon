/**
 * Unit tests for the shared On Hold transition rules used by
 * enrichLeadById, ClayService, and stallOverdueEnrichments.
 *
 * Run: cd server && npx ts-node src/lib/onHoldTransition.test.ts
 */

import assert from "node:assert";
import { computeOnHoldTransition } from "./onHoldTransition";

function test1_normalConclusionNeverSetsOnHold() {
  const result = computeOnHoldTransition({
    currentFlags: [],
    currentOnHoldReason: null,
    outcome: "concluded_normally",
  });
  assert.deepStrictEqual(result, { flags: [], onHoldReason: null }, "a normal conclusion, however low the field count, must never set On Hold");
}

function test2_timedOutSetsOnHoldWithReason() {
  const result = computeOnHoldTransition({
    currentFlags: ["WATCHING"],
    currentOnHoldReason: null,
    outcome: "timed_out",
  });
  assert.ok(result.flags.includes("ON_HOLD"));
  assert.ok(result.flags.includes("WATCHING"), "an unrelated existing flag must survive");
  assert.strictEqual(result.onHoldReason, "TIMEOUT");
}

function test3_systemErrorSetsOnHoldWithReason() {
  const result = computeOnHoldTransition({
    currentFlags: [],
    currentOnHoldReason: null,
    outcome: "system_error",
  });
  assert.ok(result.flags.includes("ON_HOLD"));
  assert.strictEqual(result.onHoldReason, "SYSTEM_ERROR");
}

function test4_normalConclusionAutoClearsTimeoutHold() {
  const result = computeOnHoldTransition({
    currentFlags: ["ON_HOLD"],
    currentOnHoldReason: "TIMEOUT",
    outcome: "concluded_normally",
  });
  assert.deepStrictEqual(result, { flags: [], onHoldReason: null }, "a clean run completing is exactly how TIMEOUT/SYSTEM_ERROR recover");
}

function test5_manualHoldNeverAutoClearedByNormalConclusion() {
  const result = computeOnHoldTransition({
    currentFlags: ["ON_HOLD"],
    currentOnHoldReason: "MANUAL",
    outcome: "concluded_normally",
  });
  assert.deepStrictEqual(result, { flags: ["ON_HOLD"], onHoldReason: "MANUAL" }, "only the recruiter's own toggle clears a MANUAL hold");
}

function test6_manualHoldNeverDowngradedByTimeoutOrSystemError() {
  for (const outcome of ["timed_out", "system_error"] as const) {
    const result = computeOnHoldTransition({
      currentFlags: ["ON_HOLD"],
      currentOnHoldReason: "MANUAL",
      outcome,
    });
    assert.deepStrictEqual(result, { flags: ["ON_HOLD"], onHoldReason: "MANUAL" }, `outcome=${outcome} must not downgrade an existing MANUAL hold`);
  }
}

function test7_stillInFlightLeavesEverythingUntouched() {
  const result = computeOnHoldTransition({
    currentFlags: ["ON_HOLD", "DNC"],
    currentOnHoldReason: "TIMEOUT",
    stillInFlight: true,
    outcome: "timed_out", // deliberately contradictory -- stillInFlight must win
  });
  assert.deepStrictEqual(result, { flags: ["ON_HOLD", "DNC"], onHoldReason: "TIMEOUT" }, "clay_awaiting must leave flags/onHoldReason completely untouched regardless of outcome");
}

function main() {
  const tests = [
    test1_normalConclusionNeverSetsOnHold,
    test2_timedOutSetsOnHoldWithReason,
    test3_systemErrorSetsOnHoldWithReason,
    test4_normalConclusionAutoClearsTimeoutHold,
    test5_manualHoldNeverAutoClearedByNormalConclusion,
    test6_manualHoldNeverDowngradedByTimeoutOrSystemError,
    test7_stillInFlightLeavesEverythingUntouched,
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
