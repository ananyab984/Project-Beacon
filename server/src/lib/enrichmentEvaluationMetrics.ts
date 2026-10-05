import type { EnrichmentRunConclusion, EnrichmentTier } from "@prisma/client";
import { ENRICHMENT_COUNT_TOTAL } from "./enrichmentCount";

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
  /** Enrichment found an email or a phone (lib/enrichmentCount.ts
   *  hasEnrichedContact). Optional so callers that only need the timing or
   *  tier math can leave it out; missing reads as false. */
  contactFound?: boolean;
}

/** One row per lead: that lead's most recent EnrichmentRun.concludedAt
 *  within the filtered set, plus its lastManualOverrideAt. */
export interface LatestRunPerLead {
  leadId: string;
  latestConcludedAt: Date;
  lastManualOverrideAt: Date | null;
}

/** Out of how many fields enrichedFieldCount is counted (lib/enrichmentCount.ts). */
export const FIELD_TOTAL = ENRICHMENT_COUNT_TOTAL;

/** A run counts as Enriched at this many of the 10 fields (or any contact). */
export const ENRICHED_MIN_FIELDS = 5;

/**
 * What a run actually achieved -- G3's rule (Ananya, 2026-10-05): a lead is
 * **Enriched** when enrichment filled 5 or more of the 10 fields, OR found
 * an email or a phone. That is deliberately not the waterfall's own
 * `conclusion`: SHORT_CIRCUIT_SUCCESS needs every critical field including
 * a phone almost no public profile shows, so on real data it read "exhausted,
 * no match" for runs that filled most of a lead.
 *
 * Checked in this order: a system error is always an error; then data
 * found decides it (even a timed-out run that got 6 fields enriched the
 * lead); only a run that found too little is labelled by how it ended.
 */
export type RunOutcome = "ENRICHED" | "PARTIALLY_ENRICHED" | "NOTHING_FOUND" | "TIMED_OUT" | "SYSTEM_ERROR";
export const RUN_OUTCOMES: RunOutcome[] = ["ENRICHED", "PARTIALLY_ENRICHED", "NOTHING_FOUND", "TIMED_OUT", "SYSTEM_ERROR"];

export function runOutcome(r: Pick<RunRow, "conclusion" | "enrichedFieldCount" | "contactFound">): RunOutcome {
  if (r.conclusion === "SYSTEM_ERROR") return "SYSTEM_ERROR";
  if (r.enrichedFieldCount >= ENRICHED_MIN_FIELDS || r.contactFound) return "ENRICHED";
  if (r.conclusion === "TIMED_OUT") return "TIMED_OUT";
  return r.enrichedFieldCount > 0 ? "PARTIALLY_ENRICHED" : "NOTHING_FOUND";
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

  // What each run actually achieved (see runOutcome).
  const outcomeCounts = Object.fromEntries(RUN_OUTCOMES.map((o) => [o, 0])) as Record<RunOutcome, number>;
  for (const r of runs) outcomeCounts[runOutcome(r)]++;
  const outcomes = Object.fromEntries(
    RUN_OUTCOMES.map((o) => [o, { count: outcomeCounts[o], pct: pct(outcomeCounts[o], totalRuns) }])
  ) as Record<RunOutcome, { count: number; pct: number }>;
  const enrichedPct = pct(outcomeCounts.ENRICHED, totalRuns);
  const foundDataPct = pct(outcomeCounts.ENRICHED + outcomeCounts.PARTIALLY_ENRICHED, totalRuns);

  // How much of a lead a run fills, out of the 10 dialog fields.
  const fieldCoverage = {
    total: FIELD_TOTAL,
    avgFields: totalRuns ? Math.round((runs.reduce((a, r) => a + r.enrichedFieldCount, 0) / totalRuns) * 10) / 10 : 0,
    buckets: [
      { label: "None", min: 0, max: 0 },
      { label: "1-3 fields", min: 1, max: 3 },
      { label: "4-6 fields", min: 4, max: 6 },
      { label: "7-10 fields", min: 7, max: FIELD_TOTAL },
    ].map((b) => {
      const count = runs.filter((r) => r.enrichedFieldCount >= b.min && r.enrichedFieldCount <= b.max).length;
      return { label: b.label, count, pct: pct(count, totalRuns) };
    }),
  };

  // Metrics 3 & 4 -- over every run where a provider tier resolved
  // something. This used to be SHORT_CIRCUIT_SUCCESS runs only, which on
  // real data is ~none (see runOutcome), so both read 0% forever even
  // though tier is recorded on every run that found anything.
  const tierCounts: Record<EnrichmentTier, number> = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };
  const tierFieldSums: Record<EnrichmentTier, number> = { TIER_1: 0, TIER_2: 0, TIER_3: 0 };
  for (const r of runs) {
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

  // Metric 5 -- of the leads enrichment ran on (most recent run in the
  // filtered set), the share a recruiter edited strictly after that run.
  // The denominator used to be "leads currently COMPLETE", but COMPLETE
  // only ever meant "didn't time out" (see lib/enrichmentVerdict.ts), so it
  // was every lead regardless of what enrichment found.
  const overriddenCount = latestRunPerLead.filter(
    (row) => row.lastManualOverrideAt && row.lastManualOverrideAt > row.latestConcludedAt
  ).length;
  const manualOverrideRate = pct(overriddenCount, latestRunPerLead.length);

  return {
    totalRuns,
    outcomes,
    enrichedPct,
    enrichedRule: { minFields: ENRICHED_MIN_FIELDS, orContact: true },
    foundDataPct,
    fieldCoverage,
    enrichmentPct,
    timeTaken,
    tierAttribution,
    qualityByTier,
    manualOverrideRate,
    leadsEvaluated: latestRunPerLead.length,
    leadsOverridden: overriddenCount,
  };
}
