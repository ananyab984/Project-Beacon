/**
 * Unit tests for buildDraftLeadPayload: the greeting-name fallback chain, and
 * the deep-section wiring (experience/education/languages/courses).
 *
 * --- Greeting name ---
 * Enrichment writes the resolved name to `displayName` and never back-fills
 * `firstName`, so 28 of 30 real leads had `firstName: null` (confirmed live
 * 2026-09-07). Drafting's own `fromRecord` then fell through to its literal
 * "there" placeholder, and evaluator's required-elements check -- which looks
 * for the lead's first name in the opening -- scanned for the word "there",
 * failed, and put 9 of 10 otherwise-good drafts on HOLD with
 * MISSING_REQUIRED_ELEMENTS. Tests 1-8 pin the fallback chain.
 *
 * --- Deep sections ---
 * draftLeadPayload.ts sourced Deep_Experience/Deep_Education/Deep_Languages
 * (then named Parallel_Experience/etc.) from `lead.parallelData` ONLY.
 * `mergeProfileSections` (lib/profileSections.ts) already recovers Bright
 * Data's deep sections for the enrichment dialog -- languages with
 * proficiency, education, courses -- but that merge was never wired into
 * drafting. So for every LinkedIn lead (where Parallel's browsing agent
 * cannot see these sections at all, only Bright Data's authenticated scrape
 * can), the curated grounding facts (additional_languages_spoken, education,
 * courses_completed) were empty while the data sat, unused, in
 * `rawScrapeData`. On a linguist recruitment platform, a candidate's stated
 * languages are the qualifying fact. Tests 9+ pin the fix.
 *
 * `Deep_Courses` in particular used to be read by drafting/leads.ts under the
 * name `Parallel_Courses`, which draftLeadPayload.ts never once produced --
 * courses_completed was structurally always empty regardless of what
 * enrichment found, for every lead, on every platform.
 *
 * Run: cd server && npx ts-node src/lib/draftLeadPayload.test.ts
 */

import assert from "node:assert";
import { buildDraftLeadPayload } from "./draftLeadPayload";
import { fromRecord } from "../drafting/leads";

/** Minimal Lead-shaped row -- only the fields buildDraftLeadPayload and
 *  mergeProfileSections actually read. */
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

// --- greeting name -----------------------------------------------------

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

// --- deep sections -------------------------------------------------------

// Verbatim shape from a real stored Bright Data LinkedIn payload (Dan
// Rairigh): languages with proficiency, an education record only under
// `educations_details`, and 29 courses in the real row (trimmed here).
const BRIGHTDATA_RAW = [
  {
    name: "Dan Rairigh",
    languages: [
      { title: "Spanish", subtitle: "Native or bilingual proficiency" },
      { title: "French", subtitle: "Full professional proficiency" },
    ],
    educations_details: "Middlebury Institute of International Studies at Monterey",
    courses: [{ title: "A Table! La nourriture dans le cinéma français", subtitle: "FRN371" }],
    experience: null, // confirmed: Bright Data returns null on 21 of 22 real profiles
  },
];

// A real Parallel LinkedIn result: flat fields land, every enumerated
// section comes back empty (Parallel cannot see them on LinkedIn).
const PARALLEL_EMPTY = {
  country: "United States",
  headline: "Localization QA Project Manager",
  experience: [],
  education: [],
  languages: [],
  certifications: [],
};

function test9_deep_languages_reach_the_payload_from_brightdata_alone() {
  const p = buildDraftLeadPayload(leadRow({ rawScrapeData: BRIGHTDATA_RAW, parallelData: PARALLEL_EMPTY }));
  assert.ok(Array.isArray(p.Deep_Languages), "Deep_Languages must be populated from Bright Data alone");
  assert.strictEqual(p.Deep_Languages!.length, 2);
  assert.strictEqual((p.Deep_Languages![0] as any).language, "Spanish");
  assert.strictEqual((p.Deep_Languages![0] as any).proficiency, "Native or bilingual proficiency");
}

function test10_deep_courses_reach_the_payload_for_the_first_time_ever() {
  // Previously named Parallel_Courses and read by drafting/leads.ts, but
  // never once produced -- this is the regression test for that gap.
  const p = buildDraftLeadPayload(leadRow({ rawScrapeData: BRIGHTDATA_RAW, parallelData: PARALLEL_EMPTY }));
  assert.ok(Array.isArray(p.Deep_Courses), "Deep_Courses must exist -- it was never produced before");
  assert.strictEqual((p.Deep_Courses![0] as any).title, "A Table! La nourriture dans le cinéma français");
}

function test11_a_thin_lead_with_no_deep_data_anywhere_omits_the_keys() {
  const p = buildDraftLeadPayload(leadRow({ rawScrapeData: null, parallelData: null }));
  assert.strictEqual(p.Deep_Experience, undefined);
  assert.strictEqual(p.Deep_Education, undefined);
  assert.strictEqual(p.Deep_Languages, undefined);
  assert.strictEqual(p.Deep_Courses, undefined);
}

function test12_languages_and_courses_become_real_grounding_facts() {
  const p = buildDraftLeadPayload(leadRow({ rawScrapeData: BRIGHTDATA_RAW, parallelData: PARALLEL_EMPTY }));
  const facts = fromRecord(p).groundingFacts();

  assert.ok(facts.additional_languages_spoken, "additional_languages_spoken must not be empty for this lead");
  assert.match(facts.additional_languages_spoken, /Spanish/);
  assert.match(facts.additional_languages_spoken, /French/);

  assert.ok(facts.courses_completed, "courses_completed must not be empty for this lead");
  assert.match(facts.courses_completed, /nourriture/);
}

function test13_no_experience_data_anywhere_means_no_recent_experience_fact() {
  // Bright Data's `experience: null` on this profile, Parallel's `[]` --
  // neither source has anything, so the fact must simply be ABSENT, never
  // fabricated from `current_role_or_company` or any other field. This is
  // the existing "gap-fill never fabricate" rule (promptBuilder.ts), just
  // confirmed to still hold once the deep sections are Bright-Data-sourced.
  const p = buildDraftLeadPayload(leadRow({ rawScrapeData: BRIGHTDATA_RAW, parallelData: PARALLEL_EMPTY }));
  const facts = fromRecord(p).groundingFacts();
  assert.strictEqual(facts.recent_experience, undefined);
}

function test14_the_deep_alias_still_accepts_the_old_parallel_prefixed_keys() {
  // fromRecord must keep reading Parallel_* for any other /draft caller that
  // has not moved to Deep_* yet.
  const legacyRecord = {
    First_Name: "Someone",
    Parallel_Languages: [{ language: "German", proficiency: "Native" }],
    Parallel_Courses: [{ title: "Old Course" }],
  };
  const facts = fromRecord(legacyRecord).groundingFacts();
  assert.match(facts.additional_languages_spoken || "", /German/);
  assert.match(facts.courses_completed || "", /Old Course/);
}

function test15_parallel_only_lead_still_works_unregressed() {
  // ProZ/Bodalgo: Parallel IS the deep tier there and already emits the
  // target shape. Recovering Bright Data must not regress that path.
  const p = buildDraftLeadPayload(
    leadRow({
      source: "PROZ",
      rawScrapeData: null,
      parallelData: {
        education: [{ institution: "Université de Haute-Alsace France", degree: "Master's degree" }],
        languages: [{ language: "French", proficiency: "Native in French" }],
      },
    })
  );
  const facts = fromRecord(p).groundingFacts();
  assert.match(facts.education || "", /Haute-Alsace/);
  assert.match(facts.additional_languages_spoken || "", /French/);
}

const tests = [
  test1_explicitFirstNameWins,
  test2_derivesFromDisplayNameWhenFirstNameMissing,
  test3_fallsBackToFullNameWhenNoDisplayName,
  test4_prefersDisplayNameOverFullName,
  test5_allCapsScrapeIsTitleCasedNotShouted,
  test6_mixedCaseNameIsLeftExactlyAsWritten,
  test7_genuinelyNamelessLeadYieldsNullNotAPlaceholder,
  test8_blankStringsAreTreatedAsMissing,
  test9_deep_languages_reach_the_payload_from_brightdata_alone,
  test10_deep_courses_reach_the_payload_for_the_first_time_ever,
  test11_a_thin_lead_with_no_deep_data_anywhere_omits_the_keys,
  test12_languages_and_courses_become_real_grounding_facts,
  test13_no_experience_data_anywhere_means_no_recent_experience_fact,
  test14_the_deep_alias_still_accepts_the_old_parallel_prefixed_keys,
  test15_parallel_only_lead_still_works_unregressed,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`  PASS  ${t.name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL  ${t.name}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
