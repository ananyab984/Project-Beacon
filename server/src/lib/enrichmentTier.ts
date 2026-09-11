import type { EnrichmentTier } from "@prisma/client";

/**
 * Maps a fieldSources value (the Python-pipeline-style provenance tag --
 * see enrichment_pipeline/orchestrator.py) to the waterfall tier that
 * produced it. brightdata/tavily are both Tier 1 (the platform's primary
 * scraper); parallel is Tier 2 for every platform (Clay, the old
 * LinkedIn-only Tier 2, was fully replaced -- see commit 70956ff); llm_fallback
 * is Tier 3 (Stage 6 Claude web search, also platform-agnostic).
 */
const TIER_BY_SOURCE: Record<string, EnrichmentTier> = {
  brightdata: "TIER_1",
  tavily: "TIER_1",
  parallel: "TIER_2",
  llm_fallback: "TIER_3",
};

const TIER_RANK: Record<EnrichmentTier, number> = { TIER_1: 1, TIER_2: 2, TIER_3: 3 };

/**
 * Deepest tier that actually resolved a field on this lead, or null if
 * nothing was -- excludes "existing" (arrived pre-populated), "manual"
 * (a recruiter's own entry), and the underscore-prefixed state-tracking
 * keys (_parallel_fallback, _websearch_fallback) that aren't real field
 * names at all.
 */
export function tierFromFieldSources(fieldSources: Record<string, string> | null | undefined): EnrichmentTier | null {
  if (!fieldSources) return null;

  let deepest: EnrichmentTier | null = null;
  for (const [key, source] of Object.entries(fieldSources)) {
    if (key.startsWith("_")) continue;
    const tier = TIER_BY_SOURCE[source];
    if (!tier) continue;
    if (!deepest || TIER_RANK[tier] > TIER_RANK[deepest]) deepest = tier;
  }
  return deepest;
}
