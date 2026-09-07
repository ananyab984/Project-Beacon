/**
 * Unit tests for which enrichment state a lead is in.
 *
 * The classification used to be duplicated inline in owner.leads.tsx and
 * recruiter.leads.tsx, where it had already drifted between the two and was
 * untestable. These pin the rules the shared cell now owns -- above all that
 * ON_HOLD is an overlay checked BEFORE completion, so a lead that is both
 * COMPLETE and held reads as held rather than silently as enriched.
 *
 * Run: cd client && npx tsx src/components/features/enrichment-status-cell.test.ts
 */

import assert from "node:assert";
import { enrichmentStatusKindOf } from "./enrichment-status-cell";
import type { ApiLead } from "@/lib/api-types";

function lead(over: Partial<ApiLead> = {}): ApiLead {
  return { flags: [], enrichmentStatus: "PENDING", onHoldReason: null, ...over } as ApiLead;
}

function test1_completeReadsAsEnriched() {
  assert.strictEqual(enrichmentStatusKindOf(lead({ enrichmentStatus: "COMPLETE" })), "enriched");
}

function test2_onHoldWinsOverComplete() {
  // The overlay case: both true at once must read as held, because "held"
  // is the state that still needs a human, and showing "Enriched" would
  // hide it.
  const held = lead({ enrichmentStatus: "COMPLETE", flags: ["ON_HOLD"] });
  assert.strictEqual(enrichmentStatusKindOf(held), "on_hold");
}

function test3_inProgressReadsAsEnriching() {
  assert.strictEqual(enrichmentStatusKindOf(lead({ enrichmentStatus: "IN_PROGRESS" })), "enriching");
  assert.strictEqual(enrichmentStatusKindOf(lead({ enrichmentStatus: "PENDING" })), "enriching");
}

function test4_stalledIsNotShownAsStillRunning() {
  // A stalled run is finished-and-failed, not in flight -- showing
  // "Enriching…" for it told the recruiter to keep waiting on nothing.
  assert.strictEqual(enrichmentStatusKindOf(lead({ enrichmentStatus: "STALLED" })), "pending");
}

function test5_onHoldWithoutCompletionStillReadsAsHeld() {
  assert.strictEqual(
    enrichmentStatusKindOf(lead({ enrichmentStatus: "PENDING", flags: ["ON_HOLD"] })),
    "on_hold"
  );
}

function test6_missingFlagsArrayDoesNotThrow() {
  assert.strictEqual(enrichmentStatusKindOf({ enrichmentStatus: "COMPLETE" } as ApiLead), "enriched");
}

function main() {
  const tests = [
    test1_completeReadsAsEnriched,
    test2_onHoldWinsOverComplete,
    test3_inProgressReadsAsEnriching,
    test4_stalledIsNotShownAsStillRunning,
    test5_onHoldWithoutCompletionStillReadsAsHeld,
    test6_missingFlagsArrayDoesNotThrow,
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
