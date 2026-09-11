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
 * Note: this function still won't find a candidate for very conversational
 * phrasing with filler words ("Tell me MSA process") on its own -- it
 * queries the raw, unprocessed message with an AND-based plainto_tsquery
 * and no similarity() WHERE clause, unlike the main /api/faq/check
 * handler's per-extracted-term search. That's a separate, narrower
 * limitation of this function specifically (only reached when the main
 * handler finds nothing for every extracted question/keyword), not the
 * cause of the reported bug -- see questionExtractor.test.ts for the fix
 * that actually resolves the reported "Tell me MSA process" case, via the
 * main handler's keyword+tag-match path.
 *
 * Run: cd server && npx ts-node src/lib/semanticFaqSearch.test.ts
 */

import assert from "node:assert";
import { findKeywordCandidates } from "./semanticFaqSearch";

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

async function main() {
  const tests = [test1_findsFaqForDirectMsaPhrasing, test2_findsFaqForKeywordOnlyPhrasing];
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
