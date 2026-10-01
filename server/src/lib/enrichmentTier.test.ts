/**
 * Unit tests for tierFromFieldSources -- the deepest-tier-resolved rule the
 * Enrichment Evaluation dashboard's tier-attribution/quality-by-tier metrics
 * depend on. Pins that Clay is dead (no such source string) and Parallel is
 * Tier 2 for every platform (see commit 70956ff), and that state-tracking
 * keys never get mistaken for real fields.
 *
 * Run: cd server && npx ts-node src/lib/enrichmentTier.test.ts
 */
import assert from "node:assert";
import { tierFromFieldSources } from "./enrichmentTier";

function test1_brightdataOnlyIsTier1() {
  assert.strictEqual(tierFromFieldSources({ Email_Address: "brightdata", Country_of_Residence: "brightdata" }), "TIER_1");
}

function test2_tavilyIsAlsoTier1() {
  assert.strictEqual(tierFromFieldSources({ Headline: "tavily" }), "TIER_1");
}

function test3_parallelIsTier2ForAnyPlatform() {
  // Confirms no Clay-era LinkedIn-only assumption survives here -- parallel
  // is Tier 2 unconditionally.
  assert.strictEqual(tierFromFieldSources({ Headline: "parallel" }), "TIER_2");
}

function test4_llmFallbackIsTier3() {
  assert.strictEqual(tierFromFieldSources({ About_Snippet: "llm_fallback" }), "TIER_3");
}

function test5_deepestTierWinsWhenMixed() {
  // Tier 1 found some fields, Parallel (Tier 2) found others -- the LEAD's
  // tier is the deepest one that had to be invoked, not the first.
  assert.strictEqual(
    tierFromFieldSources({ Email_Address: "brightdata", Headline: "parallel", About_Snippet: "llm_fallback" }),
    "TIER_3"
  );
  assert.strictEqual(tierFromFieldSources({ Email_Address: "brightdata", Headline: "parallel" }), "TIER_2");
}

function test6_existingAndManualAreIgnored() {
  assert.strictEqual(tierFromFieldSources({ Full_Name: "existing", Country_of_Residence: "manual" }), null);
}

function test7_underscorePrefixedStateKeysAreIgnored() {
  // _parallel_fallback/_websearch_fallback are bookkeeping markers
  // (orchestrator.py), not real field names -- must never be mistaken for
  // a resolved field even though their values ("complete", "failed:1") look
  // superficially like real source tags.
  assert.strictEqual(tierFromFieldSources({ _parallel_fallback: "complete", _websearch_fallback: "failed_transient:1" }), null);
}

function test8_emptyOrMissingFieldSourcesIsNull() {
  assert.strictEqual(tierFromFieldSources({}), null);
  assert.strictEqual(tierFromFieldSources(null), null);
  assert.strictEqual(tierFromFieldSources(undefined), null);
}

function main() {
  const tests = [
    test1_brightdataOnlyIsTier1,
    test2_tavilyIsAlsoTier1,
    test3_parallelIsTier2ForAnyPlatform,
    test4_llmFallbackIsTier3,
    test5_deepestTierWinsWhenMixed,
    test6_existingAndManualAreIgnored,
    test7_underscorePrefixedStateKeysAreIgnored,
    test8_emptyOrMissingFieldSourcesIsNull,
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
