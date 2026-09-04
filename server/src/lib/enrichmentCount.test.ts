/**
 * Unit tests for the live "Enriched (n)" field count -- scoped to the 11
 * genuinely enrichment-findable fields, excluding creation-time fields
 * (profileLink/sourceLanguage/targetLanguage/services) that would otherwise
 * inflate the count for a lead enrichment found nothing for.
 *
 * Run: cd server && npx ts-node src/lib/enrichmentCount.test.ts
 */

import assert from "node:assert";
import { countPopulatedFields } from "./enrichmentCount";

const EMPTY_LEAD = {
  fullName: null,
  email: null,
  contactNumber: null,
  country: null,
  yearsOfExperience: null,
  vendorExperience: null,
  headline: null,
  currentTitle: null,
  aboutSnippet: null,
  toolsSoftware: [],
  certifications: [],
} as const;

function test1_allEmptyCountsZero() {
  assert.strictEqual(countPopulatedFields(EMPTY_LEAD as any), 0);
}

function test2_allElevenPopulatedCountsEleven() {
  const lead = {
    fullName: "Jane Doe",
    email: "jane@example.com",
    contactNumber: "+1 555 0100",
    country: "Germany",
    yearsOfExperience: 5 as any,
    vendorExperience: "Netflix, Amazon",
    headline: "Senior Translator",
    currentTitle: "Freelance Translator",
    aboutSnippet: "Experienced translator...",
    toolsSoftware: ["Trados"],
    certifications: ["ATA Certified"],
  };
  assert.strictEqual(countPopulatedFields(lead as any), 11);
}

function test3_onlyEmailAndPhoneCountsTwo_notTreatedAsFailure() {
  const lead = { ...EMPTY_LEAD, email: "jane@example.com", contactNumber: "+1 555 0100" };
  // The count function itself has no opinion on "failure" -- this test just
  // documents that a low count from only these two fields is a completely
  // ordinary result (2), not a special-cased zero or an error.
  assert.strictEqual(countPopulatedFields(lead as any), 2);
}

function test4_whitespaceOnlyStringDoesNotCount() {
  const lead = { ...EMPTY_LEAD, headline: "   " };
  assert.strictEqual(countPopulatedFields(lead as any), 0, "a whitespace-only string must not count as populated");
}

function test5_emptyArrayDoesNotCountButNonEmptyDoes() {
  const empty = { ...EMPTY_LEAD, toolsSoftware: [] };
  const nonEmpty = { ...EMPTY_LEAD, toolsSoftware: ["Trados"] };
  assert.strictEqual(countPopulatedFields(empty as any), 0);
  assert.strictEqual(countPopulatedFields(nonEmpty as any), 1);
}

function test6_zeroYearsOfExperienceStillCounts() {
  // 0 is a real, meaningful value (not "empty") -- must count as populated,
  // not be treated as falsy.
  const lead = { ...EMPTY_LEAD, yearsOfExperience: 0 as any };
  assert.strictEqual(countPopulatedFields(lead as any), 1);
}

function test7_creationTimeFieldsDoNotInflateAFailedEnrichmentLead() {
  // The actual bug this rework closes: a lead where enrichment found
  // NOTHING, but profileLink/sourceLanguage/targetLanguage/services were set
  // at creation (the last two sometimes defaulted to "English" by a CSV/
  // sheet import, not real data) -- these must not count, so the lead shows
  // "Enriched (1)" (just the name), not 6-8 misrepresenting real success.
  const lead = {
    ...EMPTY_LEAD,
    fullName: "Jane Doe",
    // These 4 fields are deliberately NOT part of the Pick<> this function
    // accepts anymore -- simulating what a real Lead row would still have
    // set even though they're excluded from counting (passed through `as
    // any` below, since the function's own type no longer declares them).
    profileLink: "https://www.linkedin.com/in/janedoe",
    sourceLanguage: "English",
    targetLanguage: "English",
    services: ["Subtitling"],
  };
  assert.strictEqual(countPopulatedFields(lead as any), 1, "creation-time fields must not count toward enrichment success");
}

function main() {
  const tests = [
    test1_allEmptyCountsZero,
    test2_allElevenPopulatedCountsEleven,
    test3_onlyEmailAndPhoneCountsTwo_notTreatedAsFailure,
    test4_whitespaceOnlyStringDoesNotCount,
    test5_emptyArrayDoesNotCountButNonEmptyDoes,
    test6_zeroYearsOfExperienceStillCounts,
    test7_creationTimeFieldsDoNotInflateAFailedEnrichmentLead,
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
