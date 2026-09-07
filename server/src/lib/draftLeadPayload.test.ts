/**
 * Unit tests for the greeting name the drafting payload resolves.
 *
 * Enrichment writes the resolved name to `displayName` and never back-fills
 * `firstName`, so 28 of 30 real leads had `firstName: null` (confirmed live
 * 2026-09-07). Drafting's own `fromRecord` then fell through to its literal
 * "there" placeholder, and evaluator's required-elements check -- which looks
 * for the lead's first name in the opening -- scanned for the word "there",
 * failed, and put 9 of 10 otherwise-good drafts on HOLD with
 * MISSING_REQUIRED_ELEMENTS. These tests pin the fallback chain.
 *
 * Run: cd server && npx ts-node src/lib/draftLeadPayload.test.ts
 */

import assert from "node:assert";
import { buildDraftLeadPayload } from "./draftLeadPayload";

/** Minimal Lead-shaped row -- only the fields buildDraftLeadPayload reads. */
function leadRow(over: Record<string, any> = {}): any {
  return {
    firstName: null,
    fullName: null,
    displayName: null,
    country: null,
    source: "LINKEDIN",
    profileLink: "https://www.linkedin.com/in/someone",
    email: null,
    services: [],
    sourceLanguage: null,
    targetLanguage: null,
    secondaryLanguages: [],
    yearsOfExperience: null,
    vendorExperience: null,
    enrichmentStatus: "COMPLETE",
    headline: null,
    aboutSnippet: null,
    currentTitle: null,
    toolsSoftware: [],
    certifications: [],
    parallelData: null,
    rawScrapeData: null,
    ...over,
  };
}

function test1_explicitFirstNameWins() {
  const p = buildDraftLeadPayload(leadRow({ firstName: "Jo", displayName: "Joanna Smith" }));
  assert.strictEqual(p.First_Name, "Jo", "a recruiter-typed firstName must not be overridden");
}

function test2_derivesFromDisplayNameWhenFirstNameMissing() {
  const p = buildDraftLeadPayload(leadRow({ displayName: "Alex Anthraper", fullName: "Alex Anthraper" }));
  assert.strictEqual(p.First_Name, "Alex", "should greet by the verified displayName's first token");
}

function test3_fallsBackToFullNameWhenNoDisplayName() {
  const p = buildDraftLeadPayload(leadRow({ fullName: "Mathumitha Senthil" }));
  assert.strictEqual(p.First_Name, "Mathumitha");
}

function test4_prefersDisplayNameOverFullName() {
  // displayName is what enrichment verified; fullName is the audit trail of
  // whatever was typed at Add-Lead, which can be a partial or a typo.
  const p = buildDraftLeadPayload(leadRow({ fullName: "Mathumitha", displayName: "Mathumitha Senthil" }));
  assert.strictEqual(p.First_Name, "Mathumitha");
}

function test5_allCapsScrapeIsTitleCasedNotShouted() {
  const p = buildDraftLeadPayload(leadRow({ displayName: "MARIE-ANNE HAASSER" }));
  assert.strictEqual(p.First_Name, "Marie-anne", "an ALL-CAPS scrape must not shout in the greeting");
}

function test6_mixedCaseNameIsLeftExactlyAsWritten() {
  // Someone who writes their own name lowercase ("ananth") or mid-caps
  // ("McPherson") gets it back unchanged -- we only fix all-caps shouting.
  assert.strictEqual(buildDraftLeadPayload(leadRow({ displayName: "ananth" })).First_Name, "ananth");
  assert.strictEqual(buildDraftLeadPayload(leadRow({ displayName: "Ian McPherson" })).First_Name, "Ian");
}

function test7_genuinelyNamelessLeadYieldsNullNotAPlaceholder() {
  // Null here lets drafting's own fromRecord apply its documented "there"
  // last resort; inventing a placeholder in this layer would hide the gap.
  const p = buildDraftLeadPayload(leadRow());
  assert.strictEqual(p.First_Name, null);
}

function test8_blankStringsAreTreatedAsMissing() {
  const p = buildDraftLeadPayload(leadRow({ firstName: "   ", displayName: "Enver XIN" }));
  assert.strictEqual(p.First_Name, "Enver", "whitespace-only firstName must not win over a real name");
}

function main() {
  const tests = [
    test1_explicitFirstNameWins,
    test2_derivesFromDisplayNameWhenFirstNameMissing,
    test3_fallsBackToFullNameWhenNoDisplayName,
    test4_prefersDisplayNameOverFullName,
    test5_allCapsScrapeIsTitleCasedNotShouted,
    test6_mixedCaseNameIsLeftExactlyAsWritten,
    test7_genuinelyNamelessLeadYieldsNullNotAPlaceholder,
    test8_blankStringsAreTreatedAsMissing,
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
