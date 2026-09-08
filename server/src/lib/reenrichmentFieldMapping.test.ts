/**
 * Unit tests for the Autumn -> Lead mapping used by recruiter-triggered
 * re-enrichment. Exists for one rule above all: a value the recruiter typed
 * by hand must survive a re-enrichment run that returns something different
 * for the same field.
 *
 * Run: cd server && npx ts-node src/lib/reenrichmentFieldMapping.test.ts
 */

import assert from "node:assert";
import { mapAutumnOutputToLeadFields, applyConflictChoices } from "./reenrichmentFieldMapping";

/** A complete Autumn output row, as flattened from GET /task/{id}/output. */
const AUTUMN_ROW = {
  entity_url: "https://www.proz.com/profile/860375",
  name: "Eric Paul",
  headline: "EN>FR Subtitler",
  current_title: "Freelance Translator",
  current_company: "Self-employed",
  location: "France",
  about: "Twelve years subtitling feature film and episodic television.",
  experience: ["Subtitler at Netflix (2019-2024): episodic QC"],
  qualifications: ["MA Translation Studies", "ATA Certified"],
  platform_badges: ["ProZ Certified PRO"],
  languages: ["English (native)", "French (native)"],
};

function test0_apopulatedFieldIsNeverOverwritten() {
  // The regression the 2026-09-08 live pass caught: Autumn's thinner reading
  // of a LinkedIn profile replaced a richer existing headline
  // ("Student at Université Rennes 2 Translation EN—>FR..." became just
  // "Traductrice EN—>FR et ES—>FR") and truncated a job title. Matches
  // orchestrator.py's shared merge rule: fill gaps, never overwrite.
  const existing = {
    headline: "Student at Université Rennes 2 Translation EN—>FR and ES—>FR",
    currentTitle: "Translator EN—>FR and ES—>FR",
    country: "France",
    displayName: "Maud Eliat",
    aboutSnippet: null, // the one real gap
  };
  const result = mapAutumnOutputToLeadFields(
    { headline: "Traductrice EN—>FR et ES—>FR", current_title: "Traductrice", location: "Le Rheu, Brittany, France", name: "Maud Eliat", about: "Some bio text" },
    null,
    existing
  );

  assert.ok(!("headline" in result.updates), "a populated headline must not be replaced by a thinner one");
  assert.ok(!("currentTitle" in result.updates), "a populated title must not be truncated");
  assert.ok(!("country" in result.updates), "a populated country must not be touched");
  assert.strictEqual(result.updates.aboutSnippet, "Some bio text", "the genuinely empty field IS filled — that's the point of re-enrichment");
  assert.ok(result.skippedPopulated.includes("headline"));
}

function test1_manualFieldIsNeverOverwritten() {
  const result = mapAutumnOutputToLeadFields(AUTUMN_ROW, {
    Full_Name: "manual",
    Headline: "brightdata",
  });

  assert.ok(!("displayName" in result.updates), "a manually-entered name must not be written at all");
  assert.deepStrictEqual(result.skippedManual, ["displayName"]);
  assert.strictEqual(result.fieldSources.Full_Name, "manual", "the manual tag itself must survive, or the NEXT run would clobber the value");
  assert.strictEqual(result.updates.headline, "EN>FR Subtitler", "a non-manual field is still fair game");
}

function test2_writtenFieldsAreTaggedAutumn() {
  const result = mapAutumnOutputToLeadFields(AUTUMN_ROW, null);

  assert.strictEqual(result.updates.displayName, "Eric Paul");
  assert.strictEqual(result.updates.currentTitle, "Freelance Translator");
  assert.strictEqual(result.updates.aboutSnippet, AUTUMN_ROW.about);
  assert.strictEqual(result.updates.country, "France");
  assert.deepStrictEqual(result.updates.certifications, ["MA Translation Studies", "ATA Certified"]);
  assert.strictEqual(result.fieldSources.Full_Name, "autumn");
  assert.strictEqual(result.fieldSources.About_Snippet, "autumn");
  assert.strictEqual(result.writtenFields.length, 6, "all six mapped fields were present in this row");
}

function test3_unmappedAutumnFieldsNeverLandInAColumn() {
  const result = mapAutumnOutputToLeadFields(AUTUMN_ROW, null);
  const written = Object.keys(result.updates);

  // languages/experience/platform_badges/current_company have no
  // shape-compatible column -- they belong in autumnData only.
  for (const leaked of ["sourceLanguage", "targetLanguage", "secondaryLanguages", "vendorExperience", "toolsSoftware"]) {
    assert.ok(!written.includes(leaked), `${leaked} has no confident Autumn source and must not be written`);
  }
}

function test4_emptyValuesLeavePriorDataUntouched() {
  const result = mapAutumnOutputToLeadFields(
    { ...AUTUMN_ROW, headline: "   ", about: "", qualifications: [], location: null },
    null
  );

  for (const absent of ["headline", "aboutSnippet", "certifications", "country"]) {
    assert.ok(!(absent in result.updates), `${absent} came back empty -- the lead's existing value must stand, not be nulled`);
  }
  assert.strictEqual(result.updates.displayName, "Eric Paul", "the fields that DID resolve still get written");
}

function test5_existingNonManualSourcesArePreserved() {
  const result = mapAutumnOutputToLeadFields(
    { name: "Eric Paul" },
    { Email_Address: "brightdata", Contact_Number: "parallel" }
  );

  assert.strictEqual(result.fieldSources.Email_Address, "brightdata", "a field this run didn't touch keeps its provenance");
  assert.strictEqual(result.fieldSources.Contact_Number, "parallel");
  assert.strictEqual(result.fieldSources.Full_Name, "autumn");
}

function test6_locationIsNarrowedToACountry() {
  // Real values from the 2026-09-08 live pass: Autumn's `location` is a
  // locality, but the column is `country` and the dashboard facets on it.
  for (const [location, expected] of [
    ["Le Rheu, Brittany, France", "France"],
    ["Lisbon, Lisboa, Portugal", "Portugal"],
    ["France", "France"],
    ["  Berlin , Germany ", "Germany"],
  ] as const) {
    const result = mapAutumnOutputToLeadFields({ location }, null);
    assert.strictEqual(result.updates.country, expected, `"${location}" should narrow to "${expected}"`);
  }
}

function test7_aNameIsNeverFlattenedToItsUnaccentedForm() {
  // A live ProZ lead's "Nádia Morais" came back from Autumn as
  // "Nadia Morais" and overwrote the correct name. The gap-fill rule covers
  // this without any accent-specific logic: the name was already there.
  const stripped = mapAutumnOutputToLeadFields({ name: "Nadia Morais" }, null, { displayName: "Nádia Morais" });
  assert.ok(!("displayName" in stripped.updates), "an accent-stripped name must not overwrite the accented one");

  // A lead with no name yet still gets one -- gap-filling is the whole point.
  const filled = mapAutumnOutputToLeadFields({ name: "Nádia Morais" }, null, { displayName: null });
  assert.strictEqual(filled.updates.displayName, "Nádia Morais");
}

function test8_differingPopulatedFieldsBecomeConflicts() {
  const result = mapAutumnOutputToLeadFields(
    { headline: "Traductrice EN—>FR et ES—>FR", current_title: "Translator EN—>FR and ES—>FR", name: "Maud Eliat" },
    null,
    { headline: "Student at Université Rennes 2 Translation EN—>FR and ES—>FR", currentTitle: "Translator EN—>FR and ES—>FR", displayName: "Maud Eliat" }
  );

  // Differs -> the recruiter gets to decide.
  const headline = result.conflicts.find((c) => c.field === "headline");
  assert.ok(headline, "a differing populated field must become a conflict");
  assert.strictEqual(headline!.proposed, "Traductrice EN—>FR et ES—>FR");
  assert.ok(String(headline!.current).includes("Université Rennes 2"));

  // Identical -> nothing to decide, no noise.
  assert.ok(!result.conflicts.some((c) => c.field === "currentTitle"), "an identical value is not a conflict");
  assert.ok(!result.conflicts.some((c) => c.field === "displayName"));
  // Nothing is applied either way without an explicit choice.
  assert.deepStrictEqual(result.updates, {});
}

function test9_manualFieldsAreNeverOfferedAsConflicts() {
  const result = mapAutumnOutputToLeadFields(
    { headline: "Autumn's version" },
    { Headline: "manual" },
    { headline: "What the recruiter typed" }
  );
  assert.deepStrictEqual(result.conflicts, [], "a manual field is protected outright, not put to a vote");
  assert.deepStrictEqual(result.skippedManual, ["headline"]);
}

function test10_onlyChosenConflictsAreApplied() {
  const conflicts = [
    { field: "headline", current: "old headline", proposed: "new headline" },
    { field: "currentTitle", current: "old title", proposed: "new title" },
  ];

  const result = applyConflictChoices(conflicts, ["headline"], null);
  assert.strictEqual(result.updates.headline, "new headline");
  assert.ok(!("currentTitle" in result.updates), "an unchosen conflict keeps the lead's current value");
  assert.strictEqual(result.fieldSources.Headline, "autumn");

  // The run may have sat unresolved while the recruiter edited by hand --
  // re-checked against live fieldSources, so their edit still wins.
  const raced = applyConflictChoices(conflicts, ["headline"], { Headline: "manual" });
  assert.deepStrictEqual(raced.updates, {}, "a field that became manual since the run must not be overwritten by an old choice");
}

function main() {
  const tests = [
    test0_apopulatedFieldIsNeverOverwritten,
    test1_manualFieldIsNeverOverwritten,
    test2_writtenFieldsAreTaggedAutumn,
    test3_unmappedAutumnFieldsNeverLandInAColumn,
    test4_emptyValuesLeavePriorDataUntouched,
    test5_existingNonManualSourcesArePreserved,
    test6_locationIsNarrowedToACountry,
    test7_aNameIsNeverFlattenedToItsUnaccentedForm,
    test8_differingPopulatedFieldsBecomeConflicts,
    test9_manualFieldsAreNeverOfferedAsConflicts,
    test10_onlyChosenConflictsAreApplied,
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
