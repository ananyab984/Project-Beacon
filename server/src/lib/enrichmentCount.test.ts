/**
 * Unit tests for the live "Enriched (n)" field count -- every field counts,
 * no exclusions, including a low count from only email+contactNumber (no
 * longer a failure signal).
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
  profileLink: null,
  sourceLanguage: null,
  targetLanguage: null,
  services: [],
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

function test2_allFifteenPopulatedCountsFifteen() {
  const lead = {
    fullName: "Jane Doe",
    email: "jane@example.com",
    contactNumber: "+1 555 0100",
    country: "Germany",
    profileLink: "https://www.linkedin.com/in/janedoe",
    sourceLanguage: "English",
    targetLanguage: "German",
    services: ["Subtitling"],
    yearsOfExperience: 5 as any,
    vendorExperience: "Netflix, Amazon",
    headline: "Senior Translator",
    currentTitle: "Freelance Translator",
    aboutSnippet: "Experienced translator...",
    toolsSoftware: ["Trados"],
    certifications: ["ATA Certified"],
  };
  assert.strictEqual(countPopulatedFields(lead as any), 15);
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
  const empty = { ...EMPTY_LEAD, services: [] };
  const nonEmpty = { ...EMPTY_LEAD, services: ["Dubbing"] };
  assert.strictEqual(countPopulatedFields(empty as any), 0);
  assert.strictEqual(countPopulatedFields(nonEmpty as any), 1);
}

function test6_zeroYearsOfExperienceStillCounts() {
  // 0 is a real, meaningful value (not "empty") -- must count as populated,
  // not be treated as falsy.
  const lead = { ...EMPTY_LEAD, yearsOfExperience: 0 as any };
  assert.strictEqual(countPopulatedFields(lead as any), 1);
}

function main() {
  const tests = [
    test1_allEmptyCountsZero,
    test2_allFifteenPopulatedCountsFifteen,
    test3_onlyEmailAndPhoneCountsTwo_notTreatedAsFailure,
    test4_whitespaceOnlyStringDoesNotCount,
    test5_emptyArrayDoesNotCountButNonEmptyDoes,
    test6_zeroYearsOfExperienceStillCounts,
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
