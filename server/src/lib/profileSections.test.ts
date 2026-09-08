/**
 * Unit tests for the merged deep profile sections.
 *
 * The bug these pin down (measured 2026-09-08): the enrichment dialog read
 * `lead.parallelData` and nothing else. With one output schema and one task
 * instruction, Parallel returns these sections for ProZ (education 1,
 * languages 3, certifications 3) and returns NOTHING for LinkedIn even on the
 * "pro" processor, because LinkedIn serves them only behind a login. Bright
 * Data does get them, and on one real lead it returned 4 languages with
 * proficiency, 10 certifications and 29 courses -- every one of which the UI
 * displayed as "None found".
 *
 * Fixtures below are verbatim shapes from real stored payloads, not invented.
 *
 * Run: cd server && npx ts-node src/lib/profileSections.test.ts
 */

import assert from "node:assert";
import { mergeProfileSections, decodeEntities } from "./profileSections";

// Verbatim from Dan Rairigh's stored rawScrapeData.
const BRIGHTDATA_LINKEDIN = [
  {
    name: "Dan Rairigh",
    city: "San Francisco, California, United States",
    country_code: "US",
    location: "San Francisco",
    about: "Process-oriented senior project manager with 7+ years",
    experience: null,
    education: null,
    educations_details: "Middlebury Institute of International Studies at Monterey",
    languages: [
      { title: "Spanish", subtitle: "Native or bilingual proficiency" },
      { title: "French", subtitle: "Full professional proficiency" },
      { title: "Chinese", subtitle: "Limited working proficiency" },
      { title: "English", subtitle: "Native or bilingual proficiency" },
    ],
    certifications: [
      { meta: "Issued Sep 2023", title: "Agile Project Management with Jira Cloud", subtitle: "LinkedIn" },
      { meta: "Issued Jan 2022", title: "Localization Project Management", subtitle: "LinkedIn" },
    ],
    courses: [{ title: "A Table! La nourriture dans le cinéma français", subtitle: "FRN371" }],
  },
];

// Verbatim shape from a real Parallel LinkedIn result: the flat fields land,
// every enumerated section comes back empty.
const PARALLEL_LINKEDIN = {
  country: "United States",
  headline: "Localization QA Project Manager",
  about_snippet: "Process-oriented senior project manager",
  experience: [],
  education: [],
  languages: [],
  certifications: [],
};

function test1_brightDataSectionsAreRecovered() {
  const s = mergeProfileSections({ rawScrapeData: BRIGHTDATA_LINKEDIN, parallelData: PARALLEL_LINKEDIN });
  assert.strictEqual(s.languages.length, 4, "4 languages were in the payload and must survive");
  assert.strictEqual(s.certifications.length, 2);
  assert.strictEqual(s.courses.length, 1);
  // educations_details is the only education signal when `education` is null.
  assert.strictEqual(s.education.length, 1);
  assert.strictEqual(s.education[0].institution, "Middlebury Institute of International Studies at Monterey");
}

function test2_languageProficiencySurvives() {
  // The qualifying field on a linguist platform -- a bare language name with
  // the proficiency dropped would be a silent downgrade.
  const s = mergeProfileSections({ rawScrapeData: BRIGHTDATA_LINKEDIN, parallelData: null });
  const spanish = s.languages.find((l) => l.language === "Spanish");
  assert.ok(spanish, "Spanish must be present");
  assert.strictEqual(spanish!.proficiency, "Native or bilingual proficiency");
}

function test3_everyEntryCarriesItsSource() {
  const s = mergeProfileSections({ rawScrapeData: BRIGHTDATA_LINKEDIN, parallelData: PARALLEL_LINKEDIN });
  assert.ok(s.languages.every((l) => l.source === "brightdata"));
}

function test4_parallelOnlyLeadStillWorks() {
  // ProZ/Bodalgo: Parallel IS the deep tier there, and already emits the
  // target shape. Recovering Bright Data must not regress that path.
  const s = mergeProfileSections({
    rawScrapeData: null,
    parallelData: {
      education: [{ institution: "Université de Haute-Alsace France", degree: "Master's degree" }],
      languages: [{ language: "French", proficiency: "Native in French" }],
      certifications: ["French (France-UNIV MULHOUSE, verified)"],
    },
  });
  assert.strictEqual(s.education.length, 1);
  assert.strictEqual(s.languages[0].language, "French");
  assert.strictEqual(s.certifications[0].title, "French (France-UNIV MULHOUSE, verified)");
  assert.strictEqual(s.languages[0].source, "parallel");
}

function test5_bothSourcesUnionAndDeduplicate() {
  // Real case (Ananthram G.): certifications came from both providers, some
  // naming the same credential. A union shows everything; dedup stops the
  // same credential appearing twice.
  const s = mergeProfileSections({
    rawScrapeData: [{ certifications: [{ title: "Japanese N5 Certification" }, { title: "ML with R" }] }],
    parallelData: { certifications: ["japanese n5 certification", "Deep Learning"] },
  });
  const titles = s.certifications.map((c) => String(c.title));
  assert.strictEqual(titles.length, 3, `expected 3 unique, got ${JSON.stringify(titles)}`);
  assert.ok(titles.includes("Deep Learning"), "Parallel's extra entry must be kept");
}

function test6_emptyShellsAndPlaceholdersAreDropped() {
  // `[{}]` was the old schema bug's signature; "-" and "." are Bright Data's
  // placeholders on sparse profiles. Neither is data, and both would render
  // as blank rows.
  const s = mergeProfileSections({
    rawScrapeData: [{ experience: [{ company: ".", duration: "2024 - 2028", subtitle: "-" }] }],
    parallelData: { education: [{}, {}], languages: [{}] },
  });
  assert.strictEqual(s.education.length, 0, "empty objects are not entries");
  assert.strictEqual(s.languages.length, 0);
  // The experience row keeps only its real value (the duration), not "." / "-".
  assert.strictEqual(s.experience.length, 1);
  assert.strictEqual(s.experience[0].company, undefined);
  assert.strictEqual(s.experience[0].title, undefined);
}

function test7_htmlEntitiesAreDecoded() {
  // Drafting quotes these strings back to the candidate in an outreach email,
  // so "&amp;" is a visible defect in a message to a real person.
  assert.strictEqual(decodeEntities("Classical Greek &amp; Latin graduate"), "Classical Greek & Latin graduate");
  assert.strictEqual(decodeEntities("-&gt; driven by curiosity"), "-> driven by curiosity");
  assert.strictEqual(decodeEntities("it&#39;s"), "it's");
  const s = mergeProfileSections({ rawScrapeData: [{ certifications: [{ title: "R &amp; Big Data" }] }] });
  assert.strictEqual(s.certifications[0].title, "R & Big Data");
}

function test8_noDataAnywhereIsEmptyNotCrash() {
  for (const lead of [{}, { rawScrapeData: null, parallelData: null }, { rawScrapeData: [] }, { parallelData: {} }]) {
    const s = mergeProfileSections(lead as any);
    assert.deepStrictEqual(
      [s.experience, s.education, s.languages, s.certifications, s.courses].map((x) => x.length),
      [0, 0, 0, 0, 0]
    );
  }
}

const tests = [
  test1_brightDataSectionsAreRecovered,
  test2_languageProficiencySurvives,
  test3_everyEntryCarriesItsSource,
  test4_parallelOnlyLeadStillWorks,
  test5_bothSourcesUnionAndDeduplicate,
  test6_emptyShellsAndPlaceholdersAreDropped,
  test7_htmlEntitiesAreDecoded,
  test8_noDataAnywhereIsEmptyNotCrash,
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
