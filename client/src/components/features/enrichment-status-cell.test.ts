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
import { enrichmentStatusKindOf, estimateEnrichmentProgress } from "./enrichment-status-cell";
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

// --- estimateEnrichmentProgress ---------------------------------------
//
// This is deliberately an ESTIMATE (elapsed time since enrichmentStartedAt),
// not a real per-stage progress feed -- the whole /enrich call is one
// blocking HTTP round-trip and Python has no channel back to the client
// mid-call. Its only job is to keep a genuinely-running row from reading as
// halted during the real ~4 minute typical wait (measured live this
// session: 233s/247s/256s/263s, one outlier at 486s).

function test7_noStartedAtMeansNoEstimate() {
  // A lead still PENDING/queued has no elapsed time to estimate from --
  // must return null, not a fabricated "0%" that just relocates the
  // "looks halted" problem.
  assert.strictEqual(estimateEnrichmentProgress(null, Date.now()), null);
  assert.strictEqual(estimateEnrichmentProgress(undefined, Date.now()), null);
}

function test8_progressClimbsWithElapsedTime() {
  const started = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const at = (ms: number) => new Date("2026-01-01T00:00:00.000Z").getTime() + ms;

  const p0 = estimateEnrichmentProgress(started, at(0));
  const p1min = estimateEnrichmentProgress(started, at(60_000));
  const p4min = estimateEnrichmentProgress(started, at(4 * 60_000));

  assert.strictEqual(p0, 0);
  assert.ok(p1min !== null && p1min > 0 && p1min < p4min!, "must climb monotonically with elapsed time");
}

function test9_neverReaches100OnItsOwn() {
  // The one rule that matters most: only the server flipping
  // enrichmentStatus to COMPLETE may ever show 100%. A client-side estimate
  // that reaches 100% turns "still running" into an active lie, not just an
  // imprecise guess.
  const started = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const farFuture = new Date("2026-01-01T00:00:00.000Z").getTime() + 999 * 60_000; // 16+ hours later
  const pct = estimateEnrichmentProgress(started, farFuture);
  assert.ok(pct !== null && pct < 100, `expected a capped estimate below 100, got ${pct}`);
}

function test10_holdsAtTheOutlierCapPastTheOutlierWindow() {
  // Past the measured outlier (486s ~= 8min), the estimate must stop
  // climbing rather than keep pretending to approach 100% -- a stalled or
  // exceptionally slow lead should read as "still waiting," not as
  // perpetually "almost done."
  const started = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const at8min = new Date("2026-01-01T00:00:00.000Z").getTime() + 8 * 60_000;
  const at20min = new Date("2026-01-01T00:00:00.000Z").getTime() + 20 * 60_000;
  assert.strictEqual(
    estimateEnrichmentProgress(started, at8min),
    estimateEnrichmentProgress(started, at20min),
    "must hold flat past the outlier window, not keep climbing"
  );
}

function test11_measuredDurationsLandInASensibleRange() {
  // Sanity check against this session's own real, measured Parallel `core`
  // durations (233s/247s/256s/263s) -- none of these should read as "just
  // started" or as "basically done."
  const started = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  for (const measuredSeconds of [233, 247, 256, 263]) {
    const pct = estimateEnrichmentProgress(started, base + measuredSeconds * 1000);
    assert.ok(pct !== null && pct >= 40 && pct <= 95, `${measuredSeconds}s produced an unreasonable ${pct}%`);
  }
}

function main() {
  const tests = [
    test1_completeReadsAsEnriched,
    test2_onHoldWinsOverComplete,
    test3_inProgressReadsAsEnriching,
    test4_stalledIsNotShownAsStillRunning,
    test5_onHoldWithoutCompletionStillReadsAsHeld,
    test6_missingFlagsArrayDoesNotThrow,
    test7_noStartedAtMeansNoEstimate,
    test8_progressClimbsWithElapsedTime,
    test9_neverReaches100OnItsOwn,
    test10_holdsAtTheOutlierCapPastTheOutlierWindow,
    test11_measuredDurationsLandInASensibleRange,
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
