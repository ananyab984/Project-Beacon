import type { EnrichmentRunConclusion, EnrichmentTier } from "@prisma/client";

/** Reference lines for Metric 2 -- see this feature's plan doc for the
 *  confirmed git history behind these numbers (NOT 15s/60s as originally
 *  assumed): 15s is core/resilience.py's shared fast-provider deadline
 *  (BrightData/Tavily/Claude); 4,100,000ms = 4100s is orchestrator.py's
 *  LEAD_LEVEL_TIMEOUT_SECONDS. */
export const TIME_REFERENCE_LINES = { perStepDeadlineMs: 15000, leadLevelCeilingMs: 4_100_000 };

export interface RunRow {
  conclusion: EnrichmentRunConclusion;
  tier: EnrichmentTier | null;
  enrichedFieldCount: number;
  executionTimeMs: number;
}

/** One row per lead: that lead's most recent EnrichmentRun.concludedAt
 *  within the filtered set, plus whether it's currently COMPLETE and (if so)
 *  its lastManualOverrideAt. */
export interface LatestRunPerLead {
  leadId: string;
  latestConcludedAt: Date;
  isComplete: boolean;
  lastManualOverrideAt: Date | null;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(nums: number[]): number {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

const ALL_CONCLUSIONS: EnrichmentRunConclusion[] = ["SHORT_CIRCUIT_SUCCESS", "EXHAUSTED_NO_MATCH", "TIMED_OUT", "SYSTEM_ERROR"];
const ALL_TIERS: EnrichmentTier[] = ["TIER_1", "TIER_2", "TIER_3"];

/** Pure computation of all 5 Enrichment Evaluation metrics from already-
 *  fetched rows -- no Prisma calls in here, so it's testable with plain
 *  fixture arrays. See server/src/routes/enrichmentEvaluation.routes.ts for
 *  the two queries that produce `runs` and `latestRunPerLead`. */
export function computeEnrichmentEvaluationMetrics(runs: RunRow[], latestRunPerLead: LatestRunPerLead[]) {
  const totalRuns = runs.length;
  const enrichedRuns = runs.filter((r) => r.conclusion === "SHORT_CIRCUIT_SUCCESS");
  const exhaustedCount = runs.filter((r) => r.conclusion === "EXHAUSTED_NO_MATCH").length;
  const onHoldCount = runs.filter((r) => r.conclusion === "TIMED_OUT" || r.conclusion === "SYSTEM_ERROR").length;

  // Metric 1
  const enrichmentPct = {
    enriched: pct(enrichedRuns.length, totalRuns),
    exhausted: pct(exhaustedCount, totalRuns),
    onHold: pct(onHoldCount, totalRuns),
  };

  // Metric 2
  const allTimes = runs.map((r) => r.executionTimeMs);
  const byConclusion: Record<string, { avgMs: number; medianMs: number }> = {};
  for (const c of ALL_CONCLUSIONS) {
    const subset = runs.filter((r) => r.conclusion === c).map((r) => r.executionTimeMs);
    byConclusion[c] = { avgMs: avg(subset), medianMs: Math.round(median(subset)) };
  }
  const timeTaken = {
    avgMs: avg(allTimes),
    medianMs: Math.round(median(allTimes)),
    byConclusion,
    referenceLines: TIME_REFERENCE_LINES,
  };

  // Metrics 3 & 4 -- only over SHORT_CIRCUIT_SUCCESS runs (tier is
  // meaningless/null for anything else).
  const tierCounts: Record<EnrichmentTier, number> = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };
  const tierFieldSums: Record<EnrichmentTier, number> = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };
  for (const r of enrichedRuns) {
    if (!r.tier) continue;
    tierCounts[r.tier]++;
    tierFieldSums[r.tier] += r.enrichedFieldCount;
  }
  const tieredTotal = ALL_TIERS.reduce((sum, t) => sum + tierCounts[t], 0);
  const tierAttribution: Record<EnrichmentTier, number> = {
    TIER_1: pct(tierCounts.TIER_1, tieredTotal),
    TIER_2: pct(tierCounts.TIER_2, tieredTotal),
    TIER_3: pct(tierCounts.TIER_3, tieredTotal),
  };
  const qualityByTier: Record<EnrichmentTier, number> = {
    TIER_1: tierCounts.TIER_1 ? Math.round((tierFieldSums.TIER_1 / tierCounts.TIER_1) * 10) / 10 : 0,
    TIER_2: tierCounts.TIER_2 ? Math.round((tierFieldSums.TIER_2 / tierCounts.TIER_2) * 10) / 10 : 0,
    TIER_3: tierCounts.TIER_3 ? Math.round((tierFieldSums.TIER_3 / tierCounts.TIER_3) * 10) / 10 : 0,
  };

  // Metric 5 -- denominator is leads currently COMPLETE whose most recent
  // run falls in the filtered set; numerator is those overridden strictly
  // after that specific run concluded.
  let completeCount = 0;
  let overriddenCount = 0;
  for (const row of latestRunPerLead) {
    if (!row.isComplete) continue;
    completeCount++;
    if (row.lastManualOverrideAt && row.lastManualOverrideAt > row.latestConcludedAt) {
      overriddenCount++;
    }
  }
  const manualOverrideRate = pct(overriddenCount, completeCount);

  return { totalRuns, enrichmentPct, timeTaken, tierAttribution, qualityByTier, manualOverrideRate };
}
