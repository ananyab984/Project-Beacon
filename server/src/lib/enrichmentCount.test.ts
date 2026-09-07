/**
 * Unit tests for the live "Enriched (n)" field count -- scoped to the 10
 * fields the enrichment-details dialog shows, and counting only the ones
 * enrichment (or a recruiter's manual stand-in) actually found: anything the
 * lead arrived with ("existing", or no provenance at all) must not count.
 *
 * Run: cd server && npx ts-node src/lib/enrichmentCount.test.ts
 */

import assert from "node:assert";
import { countPopulatedFields, ENRICHMENT_COUNT_TOTAL } from "./enrichmentCount";

const EMPTY_LEAD = {
  email: null,
  contactNumber: null,
  country: null,
  profileLink: null,
  sourceLanguage: null,
  targetLanguage: null,
  services: [],
  headline: null,
  currentTitle: null,
  aboutSnippet: null,
  fieldSources: null,
} as const;

/** A lead with every one of the 10 fields populated, all attributed to a
 *  real enrichment provider. */
const FULLY_ENRICHED = {
  email: "jane@example.com",
  contactNumber: "+1 555 0100",
  country: "Germany",
  profileLink: "https://www.linkedin.com/in/janedoe",
  sourceLanguage: "English",
  targetLanguage: "German",
  services: ["Subtitling"],
  headline: "Senior Translator",
  currentTitle: "Freelance Translator",
  aboutSnippet: "Experienced translator...",
  fieldSources: {
    Email_Address: "brightdata",
    Contact_Number: "brightdata",
    Country_of_Residence: "brightdata",
    Profile_Link: "brightdata",
    Source_Language: "llm_fallback",
    Target_Language: "llm_fallback",
    Services: "brightdata",
    Headline: "brightdata",
    Current_Title: "parallel",
    About_Snippet: "brightdata",
  },
};

function test1_allEmptyCountsZero() {
  assert.strictEqual(countPopulatedFields(EMPTY_LEAD as any), 0);
}

function test2_denominatorIsTen() {
  assert.strictEqual(ENRICHMENT_COUNT_TOTAL, 10, "the dialog shows 10 fields -- the count must be out of 10");
  assert.strictEqual(countPopulatedFields(FULLY_ENRICHED as any), 10);
}

function test3_inputFieldsDoNotCount() {
  // THE bug this rework closes: a lead imported with profileLink/languages/
  // services set and enrichment finding nothing must read "Enriched (0)",
  // not (4-6) misrepresenting a total failure as partial success.
  const lead = {
    ...FULLY_ENRICHED,
    email: null,
    contactNumber: null,
    country: null,
    headline: null,
    currentTitle: null,
    aboutSnippet: null,
    fieldSources: {
      Profile_Link: "existing",
      Source_Language: "existing",
      Target_Language: "existing",
      Services: "existing",
    },
  };
  assert.strictEqual(countPopulatedFields(lead as any), 0, "imported fields must not count as enriched");
}

function test4_populatedWithNoProvenanceDoesNotCount() {
  // Nothing ever claimed to have found these, so they came in with the lead.
  const lead = { ...FULLY_ENRICHED, fieldSources: null };
  assert.strictEqual(countPopulatedFields(lead as any), 0);
}

function test5_mixedInputAndEnrichedCountsOnlyEnriched() {
  // The real-world shape: 3 fields off the import row, 2 genuinely found.
  const lead = {
    ...EMPTY_LEAD,
    profileLink: "https://www.linkedin.com/in/janedoe",
    sourceLanguage: "English",
    targetLanguage: "German",
    services: ["Subtitling", "Dubbing"],
    email: "jane@example.com",
    fieldSources: {
      Profile_Link: "existing",
      Source_Language: "existing",
      Target_Language: "existing",
      Services: "brightdata",
      Email_Address: "manual",
    },
  };
  assert.strictEqual(countPopulatedFields(lead as any), 2);
}

function test6_sourceWithoutValueDoesNotCount() {
  // A stale/optimistic provenance entry for a field that ended up empty
  // must not inflate the count -- both halves have to hold.
  const lead = { ...EMPTY_LEAD, fieldSources: { Email_Address: "brightdata", Headline: "tavily" } };
  assert.strictEqual(countPopulatedFields(lead as any), 0);
}

function test7_whitespaceOnlyStringDoesNotCount() {
  const lead = { ...EMPTY_LEAD, headline: "   ", fieldSources: { Headline: "brightdata" } };
  assert.strictEqual(countPopulatedFields(lead as any), 0, "a whitespace-only string must not count as populated");
}

function test8_emptyArrayDoesNotCountButNonEmptyDoes() {
  const empty = { ...EMPTY_LEAD, services: [], fieldSources: { Services: "brightdata" } };
  const nonEmpty = { ...EMPTY_LEAD, services: ["Subtitling"], fieldSources: { Services: "brightdata" } };
  assert.strictEqual(countPopulatedFields(empty as any), 0);
  assert.strictEqual(countPopulatedFields(nonEmpty as any), 1);
}

function test9_outOfDialogFieldsAreIgnored() {
  // yearsOfExperience/vendorExperience/toolsSoftware/certifications/fullName
  // are not shown in the dialog, so counting them would make the number
  // unverifiable against what the recruiter sees.
  const lead = {
    ...EMPTY_LEAD,
    fullName: "Jane Doe",
    yearsOfExperience: 5,
    vendorExperience: "Netflix",
    toolsSoftware: ["Trados"],
    certifications: ["ATA Certified"],
    fieldSources: {
      Full_Name: "brightdata",
      Years_of_Exp: "brightdata",
      Vendor_Experience: "brightdata",
      Tools_Software: "brightdata",
      Certifications: "brightdata",
    },
  };
  assert.strictEqual(countPopulatedFields(lead as any), 0);
}

function test10_countNeverExceedsTheDenominator() {
  const lead = { ...FULLY_ENRICHED, fieldSources: { ...FULLY_ENRICHED.fieldSources, Years_of_Exp: "brightdata" } };
  assert.ok(countPopulatedFields(lead as any) <= ENRICHMENT_COUNT_TOTAL);
}

function main() {
  const tests = [
    test1_allEmptyCountsZero,
    test2_denominatorIsTen,
    test3_inputFieldsDoNotCount,
    test4_populatedWithNoProvenanceDoesNotCount,
    test5_mixedInputAndEnrichedCountsOnlyEnriched,
    test6_sourceWithoutValueDoesNotCount,
    test7_whitespaceOnlyStringDoesNotCount,
    test8_emptyArrayDoesNotCountButNonEmptyDoes,
    test9_outOfDialogFieldsAreIgnored,
    test10_countNeverExceedsTheDenominator,
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
