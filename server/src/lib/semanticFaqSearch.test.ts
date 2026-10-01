/**
 * Regression test for the "MSA process" FAQ bug's infrastructure root
 * cause: findKeywordCandidates silently returned zero candidates for every
 * query, because the faq_entries table's `search_vector` column (referenced
 * by this query) was missing on this dev database despite the migration
 * that adds it being recorded as applied -- see migration
 * 20260911102720_recover_faq_search_vector for the full root-cause writeup.
 * A missing column referenced anywhere in a SQL statement fails the WHOLE
 * statement at parse time, so this broke every branch of the query
 * (full-text, trigram, ILIKE), not just the tsvector one.
 *
 * Also covers the fix for a narrower, separate gap found afterward:
 * findKeywordCandidates alone still can't find a candidate for very
 * conversational phrasing with filler words ("Tell me MSA process") -- it
 * queries the raw, unprocessed message with an AND-based plainto_tsquery
 * and no similarity() WHERE clause. gatherFaqCandidates (called by
 * semanticFaqSearch) now merges those SQL-based candidates with a tag scan
 * (see faqTagMatcher.ts), so the semantic fallback finds the same
 * conversational-phrasing cases the main /api/faq/check handler does,
 * without a live Claude call (tested at the candidate-gathering stage,
 * before Claude verification -- see faqCheck.test.ts for the main
 * handler's equivalent coverage).
 *
 * Run: cd server && npx ts-node src/lib/semanticFaqSearch.test.ts
 */

import assert from "node:assert";
import { findKeywordCandidates, gatherFaqCandidates } from "./semanticFaqSearch";

async function test1_findsFaqForDirectMsaPhrasing() {
  const candidates = await findKeywordCandidates("What is the MSA?");
  assert.ok(candidates.length > 0, "expected at least one candidate for a direct MSA question");
  assert.ok(
    candidates.some((c) => c.question.toLowerCase().includes("msa") || c.answer.toLowerCase().includes("msa")),
    `expected a genuinely MSA-related candidate among: ${candidates.map((c) => c.question).join(" | ")}`
  );
}

async function test2_findsFaqForKeywordOnlyPhrasing() {
  const candidates = await findKeywordCandidates("msa");
  assert.ok(candidates.length > 0, "expected at least one candidate for the bare keyword 'msa'");
}

async function test3_findKeywordCandidatesAloneStillMissesConversationalPhrasing() {
  // Documents the narrower, still-true limitation of the SQL-only stage on
  // its own -- gatherFaqCandidates (test4 below) is what actually closes
  // this for real requests.
  const candidates = await findKeywordCandidates("Tell me MSA process");
  assert.strictEqual(candidates.length, 0, "findKeywordCandidates alone is not expected to find this on its own");
}

async function test4_gatherFaqCandidatesClosesTheGapViaTagMatching() {
  const candidates = await gatherFaqCandidates("Tell me MSA process");
  assert.ok(candidates.length > 0, "gatherFaqCandidates must find MSA candidates via the tag scan even though the SQL stage alone finds none");
  assert.ok(candidates.some((c) => c.question.toLowerCase().includes("msa")));
}

async function test5_existingMatchIdsAreExcludedFromGatheredCandidates() {
  const all = await gatherFaqCandidates("What is the MSA?");
  assert.ok(all.length > 0);
  const excluded = await gatherFaqCandidates("What is the MSA?", new Set(all.map((c) => c.id)));
  assert.strictEqual(excluded.length, 0, "candidates already matched elsewhere must be excluded");
}

async function main() {
  const tests = [
    test1_findsFaqForDirectMsaPhrasing,
    test2_findsFaqForKeywordOnlyPhrasing,
    test3_findKeywordCandidatesAloneStillMissesConversationalPhrasing,
    test4_gatherFaqCandidatesClosesTheGapViaTagMatching,
    test5_existingMatchIdsAreExcludedFromGatheredCandidates,
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
