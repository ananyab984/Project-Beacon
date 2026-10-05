/**
 * Unit tests for computeEnrichmentEvaluationMetrics -- the pure metric math
 * behind the Enrichment Evaluation dashboard. Mocks all data (plain fixture
 * arrays, no DB) since this is deliberately DB-free; see
 * enrichmentEvaluation.test.ts for the real-Prisma test of the two queries
 * that feed this function.
 *
 * Run: cd server && npx ts-node src/lib/enrichmentEvaluationMetrics.test.ts
 */
import assert from "node:assert";
import { computeEnrichmentEvaluationMetrics, runOutcome, RUN_OUTCOMES, TIME_REFERENCE_LINES, type RunRow, type LatestRunPerLead } from "./enrichmentEvaluationMetrics";

function run(over: Partial<RunRow>): RunRow {
  return { conclusion: "SHORT_CIRCUIT_SUCCESS", tier: null, enrichedFieldCount: 0, executionTimeMs: 0, ...over };
}

function test1_correctPercentMathForAKnownMix() {
  // 5 runs: 2 enriched, 2 exhausted, 1 timed out.
  const runs = [
    run({ conclusion: "SHORT_CIRCUIT_SUCCESS" }),
    run({ conclusion: "SHORT_CIRCUIT_SUCCESS" }),
    run({ conclusion: "EXHAUSTED_NO_MATCH" }),
    run({ conclusion: "EXHAUSTED_NO_MATCH" }),
    run({ conclusion: "TIMED_OUT" }),
  ];
  const result = computeEnrichmentEvaluationMetrics(runs, []);
  assert.strictEqual(result.totalRuns, 5);
  assert.deepStrictEqual(result.enrichmentPct, { enriched: 40, exhausted: 40, onHold: 20 });
}

function test2_onHoldBucketsBothTimedOutAndSystemError() {
  const runs = [run({ conclusion: "TIMED_OUT" }), run({ conclusion: "SYSTEM_ERROR" })];
  const result = computeEnrichmentEvaluationMetrics(runs, []);
  assert.strictEqual(result.enrichmentPct.onHold, 100);
}

function test3_timeTakenAvgMedianAndReferenceLinesAreCorrect() {
  const runs = [run({ executionTimeMs: 100 }), run({ executionTimeMs: 200 }), run({ executionTimeMs: 300 })];
  const result = computeEnrichmentEvaluationMetrics(runs, []);
  assert.strictEqual(result.timeTaken.avgMs, 200);
  assert.strictEqual(result.timeTaken.medianMs, 200);
  // Pinned exactly: NOT the spec's originally-assumed 15000/60000 -- the
  // real, git-history-confirmed values (see this feature's plan doc).
  assert.deepStrictEqual(result.timeTaken.referenceLines, TIME_REFERENCE_LINES);
  assert.strictEqual(TIME_REFERENCE_LINES.leadLevelCeilingMs, 4_100_000, "must be 4100s in ms, not 60000");
}

function test4_tierShapeHandlesAllThreeTiersUniformly() {
  // No platform-based branching lives in this function at all -- it just
  // counts whatever tiers are present, LinkedIn or not (see commit 70956ff:
  // Parallel/Tier 2 runs for every platform, and Tier 3 is equally
  // platform-agnostic).
  const runs = [
    run({ conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_1", enrichedFieldCount: 8 }),
    run({ conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_2", enrichedFieldCount: 5 }),
    run({ conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_3", enrichedFieldCount: 2 }),
  ];
  const result = computeEnrichmentEvaluationMetrics(runs, []);
  assert.deepStrictEqual(result.tierAttribution, { TIER_1: pctOf(1, 3), TIER_2: pctOf(1, 3), TIER_3: pctOf(1, 3) });
  assert.deepStrictEqual(result.qualityByTier, { TIER_1: 8, TIER_2: 5, TIER_3: 2 });
}

function pctOf(part: number, total: number): number {
  return Math.round((part / total) * 1000) / 10;
}

function test5_tierMetricsCountPartialRunsToo() {
  // Reversed on 2026-10-05. Tier metrics used to look at SHORT_CIRCUIT_SUCCESS
  // runs only, but success requires every critical field incl. a phone number
  // almost no profile has: on the live table 100/100 runs were
  // EXHAUSTED_NO_MATCH, so tier attribution and quality read 0% forever even
  // though tier is recorded on every run that resolved anything.
  const runs = [
    run({ conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_1", enrichedFieldCount: 10 }),
    run({ conclusion: "EXHAUSTED_NO_MATCH", tier: "TIER_2", enrichedFieldCount: 6 }),
    run({ conclusion: "EXHAUSTED_NO_MATCH", tier: null, enrichedFieldCount: 0 }), // found nothing: no tier
  ];
  const result = computeEnrichmentEvaluationMetrics(runs, []);
  assert.deepStrictEqual(result.tierAttribution, { TIER_1: 50, TIER_2: 50, TIER_3: 0 });
  assert.deepStrictEqual(result.qualityByTier, { TIER_1: 10, TIER_2: 6, TIER_3: 0 });
}

function test10_enrichedMeansFivePlusFieldsOrAContact() {
  // G3's rule (2026-10-05): Enriched = 5+ of 10 fields OR an email/phone found.
  // The waterfall's own "success" is not the bar -- it needs a phone too.
  const runs = [
    run({ conclusion: "EXHAUSTED_NO_MATCH", enrichedFieldCount: 5 }), // exactly 5: enriched
    run({ conclusion: "EXHAUSTED_NO_MATCH", enrichedFieldCount: 2, contactFound: true }), // few fields, but an email: enriched
    run({ conclusion: "TIMED_OUT", enrichedFieldCount: 6 }), // timed out but got 6: still enriched
    run({ conclusion: "EXHAUSTED_NO_MATCH", enrichedFieldCount: 4 }), // 4, no contact: partial
    run({ conclusion: "EXHAUSTED_NO_MATCH", enrichedFieldCount: 0 }), // nothing found
    run({ conclusion: "TIMED_OUT", enrichedFieldCount: 0 }), // timed out with too little
    run({ conclusion: "SYSTEM_ERROR", enrichedFieldCount: 0, contactFound: true }), // an error is always an error
  ];
  const r = computeEnrichmentEvaluationMetrics(runs, []);
  assert.deepStrictEqual(
    RUN_OUTCOMES.map((o) => r.outcomes[o].count),
    [3, 1, 1, 1, 1],
    "ENRICHED, PARTIALLY_ENRICHED, NOTHING_FOUND, TIMED_OUT, SYSTEM_ERROR"
  );
  assert.strictEqual(r.enrichedPct, 42.9, "3 of 7");
  assert.strictEqual(r.foundDataPct, 57.1, "enriched + partial = 4 of 7");
  assert.deepStrictEqual(r.enrichedRule, { minFields: 5, orContact: true });
}

function test11_fourFieldsWithoutAContactIsNotEnriched() {
  assert.strictEqual(runOutcome({ conclusion: "EXHAUSTED_NO_MATCH", enrichedFieldCount: 4 }), "PARTIALLY_ENRICHED");
  assert.strictEqual(runOutcome({ conclusion: "EXHAUSTED_NO_MATCH", enrichedFieldCount: 4, contactFound: true }), "ENRICHED");
  assert.strictEqual(runOutcome({ conclusion: "SHORT_CIRCUIT_SUCCESS", enrichedFieldCount: 10 }), "ENRICHED");
}

function test6_zeroDataReturnsWellFormedZerosNotCrashOrNaN() {
  const result = computeEnrichmentEvaluationMetrics([], []);
  assert.strictEqual(result.totalRuns, 0);
  assert.deepStrictEqual(result.enrichmentPct, { enriched: 0, exhausted: 0, onHold: 0 });
  assert.strictEqual(result.timeTaken.avgMs, 0);
  assert.strictEqual(result.timeTaken.medianMs, 0);
  assert.deepStrictEqual(result.tierAttribution, { TIER_1: 0, TIER_2: 0, TIER_3: 0 });
  assert.deepStrictEqual(result.qualityByTier, { TIER_1: 0, TIER_2: 0, TIER_3: 0 });
  assert.strictEqual(result.manualOverrideRate, 0);
  assert.strictEqual(result.foundDataPct, 0);
  assert.strictEqual(result.fieldCoverage.avgFields, 0);
  for (const v of Object.values(result.enrichmentPct)) assert.ok(!Number.isNaN(v));
}

function latestRun(over: Partial<LatestRunPerLead>): LatestRunPerLead {
  return { leadId: "lead-1", latestConcludedAt: new Date("2026-01-01"), lastManualOverrideAt: null, ...over };
}

function test7_manualOverrideRateOnlyCountsOverridesAfterTheLatestRun() {
  const leads = [
    latestRun({ leadId: "a", latestConcludedAt: new Date("2026-01-10"), lastManualOverrideAt: new Date("2026-01-15") }), // overridden after
    latestRun({ leadId: "b", latestConcludedAt: new Date("2026-01-10"), lastManualOverrideAt: new Date("2026-01-05") }), // "manual" tag predates this run -- a preserved pre-fill, not an override
    latestRun({ leadId: "c", latestConcludedAt: new Date("2026-01-10"), lastManualOverrideAt: null }), // never overridden
  ];
  const result = computeEnrichmentEvaluationMetrics([], leads);
  assert.strictEqual(result.manualOverrideRate, pctOf(1, 3));
}

function test8_manualOverrideDenominatorIsEveryLeadEnrichmentRanOn() {
  // Was "leads currently COMPLETE" -- but COMPLETE only ever meant "didn't
  // time out", so that filter excluded nothing real. A recruiter filling in
  // a lead the waterfall found nothing for is an override too.
  const leads = [
    latestRun({ leadId: "a", lastManualOverrideAt: new Date("2099-01-01") }),
    latestRun({ leadId: "b", lastManualOverrideAt: null }),
  ];
  const result = computeEnrichmentEvaluationMetrics([], leads);
  assert.strictEqual(result.manualOverrideRate, 50);
  assert.strictEqual(result.leadsEvaluated, 2);
  assert.strictEqual(result.leadsOverridden, 1);
}

function test9_reenrichmentUsesTheMostRecentRunNotAnEarlierOne() {
  // A lead re-enriched: its OWN latestConcludedAt already reflects the most
  // recent run (the route's groupBy _max ensures this) -- an override
  // timestamp between an earlier run and the latest one must NOT count.
  const leads = [
    latestRun({ leadId: "a", latestConcludedAt: new Date("2026-02-01"), lastManualOverrideAt: new Date("2026-01-20") }), // override happened BEFORE the latest (re-enrichment) run concluded
  ];
  const result = computeEnrichmentEvaluationMetrics([], leads);
  assert.strictEqual(result.manualOverrideRate, 0, "an override predating the lead's most recent run isn't a real override of it");
}

function main() {
  const tests = [
    test1_correctPercentMathForAKnownMix,
    test2_onHoldBucketsBothTimedOutAndSystemError,
    test3_timeTakenAvgMedianAndReferenceLinesAreCorrect,
    test4_tierShapeHandlesAllThreeTiersUniformly,
    test5_tierMetricsCountPartialRunsToo,
    test6_zeroDataReturnsWellFormedZerosNotCrashOrNaN,
    test7_manualOverrideRateOnlyCountsOverridesAfterTheLatestRun,
    test8_manualOverrideDenominatorIsEveryLeadEnrichmentRanOn,
    test9_reenrichmentUsesTheMostRecentRunNotAnEarlierOne,
    test10_enrichedMeansFivePlusFieldsOrAContact,
    test11_fourFieldsWithoutAContactIsNotEnriched,
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
