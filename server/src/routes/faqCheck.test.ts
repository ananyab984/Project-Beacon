/**
 * Regression test for POST /api/faq/check's exact-match search, mirroring
 * the per-term loop in faq.routes.ts (same pattern already used by
 * leadReplyOverride.test.ts / replyCategories.routes.test.ts for logic that
 * lives inline in a route handler rather than a separately-exported
 * function) -- if that loop's structure changes, update this alongside it.
 *
 * Covers the systemic fix for the reported bug ("Tell me MSA process"
 * returned no match despite real MSA FAQs existing): the per-term tag scan
 * (findFaqsByMessageTags) now runs as a fallback for any term the SQL
 * search misses, catching a FAQ by its own tags regardless of message
 * punctuation or wording -- not a hardcoded keyword list entry per topic.
 *
 * Also covers the correctness fix this uncovered along the way: a term
 * must never appear in BOTH matchedFaqs and unansweredQuestions for the
 * same request (an earlier version of this fix, which ran the tag scan
 * once against the whole raw message instead of per-term, could do exactly
 * that for multi-question messages).
 *
 * Run: cd server && npx ts-node src/routes/faqCheck.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";
import { extractQuestions, extractKeywords, deduplicateMatches } from "../lib/questionExtractor";
import { findFaqsByMessageTags } from "../lib/faqTagMatcher";

interface MatchEntry {
  originalQuestion: string;
  faqId?: string;
  question?: string;
  answer?: string;
}

/** Mirrors faq.routes.ts's POST /check per-term loop exactly: SQL
 * full-text/trigram/tag search first, falling back to the tag scan only
 * when the SQL search finds nothing for that term. */
async function runFaqCheck(leadMessage: string): Promise<{ matchedFaqs: any[]; unansweredQuestions: string[] }> {
  const extractedQuestions = extractQuestions(leadMessage);
  const extractedKeywords = extractKeywords(leadMessage);
  const searchTerms = [...extractedQuestions, ...extractedKeywords];
  const allMatches: MatchEntry[] = [];

  for (const question of searchTerms) {
    const matches = await prisma.$queryRaw<Array<{ id: string; question: string; answer: string; rank: number; sim: number; tag_match: number }>>`
      SELECT id, question, answer,
        COALESCE(ts_rank(search_vector, plainto_tsquery('english', ${question})), 0) AS rank,
        COALESCE(similarity(question, ${question}), 0) AS sim,
        CASE WHEN array_to_string(tags, ' ') ILIKE '%' || ${question} || '%' THEN 1 ELSE 0 END AS tag_match
      FROM faq_entries
      WHERE is_active = true
        AND (search_vector @@ plainto_tsquery('english', ${question})
             OR similarity(question, ${question}) > 0.25
             OR array_to_string(tags, ' ') ILIKE '%' || ${question} || '%')
      ORDER BY tag_match DESC, rank DESC, sim DESC
      LIMIT 1
    `;
    const top = matches[0];
    const isShortKeyword = question.length <= 10;
    const passesThreshold = top && (top.tag_match === 1 || (!isShortKeyword && (top.rank >= 0.2 || top.sim >= 0.3)) || (isShortKeyword && top.rank >= 0.3 && top.sim >= 0.35));

    if (passesThreshold) {
      allMatches.push({ originalQuestion: question, faqId: top.id, question: top.question, answer: top.answer });
      continue;
    }

    const tagMatches = await findFaqsByMessageTags(question);
    if (tagMatches.length > 0) {
      for (const m of tagMatches) allMatches.push({ originalQuestion: question, faqId: m.id, question: m.question, answer: m.answer });
    } else {
      allMatches.push({ originalQuestion: question });
    }
  }

  const deduped = deduplicateMatches(allMatches as any);
  const matchedFaqs = Array.from(deduped.values());
  const unansweredQuestions = allMatches.filter((m) => !m.faqId).map((m) => m.originalQuestion);
  return { matchedFaqs, unansweredQuestions };
}

async function test1_originalBugReportNowFindsRealMsaFaqs() {
  const { matchedFaqs, unansweredQuestions } = await runFaqCheck("Tell me MSA process");
  assert.ok(matchedFaqs.length > 0, "expected the MSA FAQs to be found");
  assert.strictEqual(unansweredQuestions.length, 0);
}

async function test2_directPhrasingWithPunctuationAlsoFindsMsaFaqs() {
  const { matchedFaqs, unansweredQuestions } = await runFaqCheck("What is the MSA?");
  assert.ok(matchedFaqs.length > 0);
  assert.strictEqual(unansweredQuestions.length, 0, "a matched question must never also appear in unansweredQuestions");
}

async function test3_genuinelyUnrelatedMessageFindsNothing() {
  const { matchedFaqs, unansweredQuestions } = await runFaqCheck("random unrelated chit chat about the weather");
  assert.strictEqual(matchedFaqs.length, 0);
  assert.strictEqual(unansweredQuestions.length, 1);
}

async function test4_matchedAndUnansweredNeverOverlapOnMultiQuestionMessages() {
  const { matchedFaqs, unansweredQuestions } = await runFaqCheck("What is the MSA? Also what's the pmt cycle?");
  assert.ok(matchedFaqs.length > 0, "expected at least the MSA and payment-related FAQs");
  // The specific regression this guards: no text should ever be in both
  // lists for the same request.
  const matchedTexts = new Set(matchedFaqs.map((m: any) => m.originalQuestions).flat());
  for (const u of unansweredQuestions) {
    assert.ok(!matchedTexts.has(u), `"${u}" must not appear as both matched and unanswered`);
  }
}

async function test5_newlyCreatedUntaggedTopicIsFindableWithNoCodeChange() {
  const created = await prisma.faqEntry.create({
    data: {
      id: `test_faqcheck_${Date.now()}`,
      category: "Test",
      question: "Do you support zorbatronic scheduling?",
      answer: "Yes, zorbatronic scheduling is fully supported.",
      tags: ["zorbatronic"],
      isActive: true,
    },
  });

  try {
    const { matchedFaqs, unansweredQuestions } = await runFaqCheck("Tell me about zorbatronic scheduling");
    assert.ok(matchedFaqs.some((m: any) => m.faqId === created.id), "a brand-new FAQ must be findable by its own tag immediately");
    assert.strictEqual(unansweredQuestions.length, 0);
  } finally {
    await prisma.faqEntry.delete({ where: { id: created.id } });
  }
}

async function main() {
  const tests = [
    test1_originalBugReportNowFindsRealMsaFaqs,
    test2_directPhrasingWithPunctuationAlsoFindsMsaFaqs,
    test3_genuinelyUnrelatedMessageFindsNothing,
    test4_matchedAndUnansweredNeverOverlapOnMultiQuestionMessages,
    test5_newlyCreatedUntaggedTopicIsFindableWithNoCodeChange,
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
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
