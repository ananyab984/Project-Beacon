/**
 * Regression test for the reported bug: "Tell me MSA process" returned
 * "No confident FAQ match" via the FAQ check button, despite real MSA FAQs
 * existing (faq_msa_definition, faq_msa_preview, faq_msa_negotiation, all
 * tagged "msa"). Root cause: "msa" was missing from FAQ_KEYWORDS, so
 * extractKeywords never pulled it out of the raw message -- and with no
 * sentence-ending punctuation, extractQuestions couldn't split the message
 * into anything shorter than the whole raw phrase either. The main
 * /api/faq/check handler's exact-match search therefore only ever tried the
 * full raw phrase as one search term, which is too diluted with filler
 * words ("Tell me", "process") to clear the tsquery/similarity thresholds --
 * see semanticFaqSearch.test.ts's header comment for the (separate, already
 * fixed) missing-search_vector-column bug this investigation also found.
 *
 * Run: cd server && npx ts-node src/lib/questionExtractor.test.ts
 */

import assert from "node:assert";
import { extractKeywords, extractQuestions } from "./questionExtractor";

async function test1_extractsMsaFromConversationalPhrasing() {
  const keywords = extractKeywords("Tell me MSA process");
  assert.ok(keywords.includes("msa"), `expected "msa" to be extracted, got: ${JSON.stringify(keywords)}`);
}

async function test2_extractsMsaCaseInsensitively() {
  assert.ok(extractKeywords("what's the MSA situation").includes("msa"));
  assert.ok(extractKeywords("tell me about the msa").includes("msa"));
}

async function test3_noPunctuationStillYieldsWholeMessageAsAQuestion() {
  // Documents the existing (unchanged) behavior extractKeywords now
  // compensates for: with no sentence-ending punctuation, extractQuestions
  // can't split "Tell me MSA process" into anything shorter than itself.
  const questions = extractQuestions("Tell me MSA process");
  assert.deepStrictEqual(questions, ["Tell me MSA process"]);
}

async function main() {
  const tests = [
    test1_extractsMsaFromConversationalPhrasing,
    test2_extractsMsaCaseInsensitively,
    test3_noPunctuationStillYieldsWholeMessageAsAQuestion,
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
