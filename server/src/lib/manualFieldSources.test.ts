/**
 * Unit tests for resolveManualFieldSources -- the rule that decides which
 * fields a PATCH /leads/:id may tag "manual". Gets its own check because it
 * feeds countPopulatedFields: over-tagging silently promotes imported values
 * into the "Enriched (n)" count.
 *
 * Run: cd server && npx ts-node src/lib/manualFieldSources.test.ts
 */

import assert from "node:assert";
import { resolveManualFieldSources } from "./manualFieldSources";

/** A lead imported with languages/services already on the row. */
const IMPORTED_LEAD = {
  email: null,
  contactNumber: null,
  country: null,
  sourceLanguage: "English",
  targetLanguage: "German",
  services: ["Subtitling", "Dubbing"],
  headline: null,
  currentTitle: null,
  aboutSnippet: null,
  displayName: "Jane Doe",
  yearsOfExperience: null,
  vendorExperience: null,
  toolsSoftware: [],
  certifications: [],
  fieldSources: {
    Source_Language: "existing",
    Target_Language: "existing",
    Services: "existing",
    Full_Name: "existing",
  },
};

/** What the details dialog actually posts: every field it renders, whether
 *  or not the recruiter touched it. */
function dialogBody(overrides: Record<string, unknown> = {}) {
  return {
    email: null,
    contactNumber: null,
    country: null,
    sourceLanguage: "English",
    targetLanguage: "German",
    services: ["Subtitling", "Dubbing"],
    headline: null,
    currentTitle: null,
    aboutSnippet: null,
    yearsOfExperience: null,
    vendorExperience: null,
    toolsSoftware: [],
    certifications: [],
    ...overrides,
  };
}

function test1_savingWithNoEditsPreservesEveryExistingSource() {
  // THE regression this guards: opening the dialog and hitting Save used to
  // rewrite every populated field's source to "manual", which flipped 3
  // imported fields into the enriched count.
  const body = dialogBody();
  const next = resolveManualFieldSources(IMPORTED_LEAD, body, body);
  assert.deepStrictEqual(next, IMPORTED_LEAD.fieldSources);
}

function test2_onlyTheEditedFieldIsTaggedManual() {
  const body = dialogBody({ email: "jane@example.com" });
  const next = resolveManualFieldSources(IMPORTED_LEAD, body, body);
  assert.strictEqual(next.Email_Address, "manual");
  assert.strictEqual(next.Source_Language, "existing", "an untouched field keeps its real source");
  assert.strictEqual(next.Services, "existing");
}

function test3_editingAnArrayFieldIsDetected() {
  const body = dialogBody({ services: ["Subtitling", "Dubbing", "Transcreation"] });
  const next = resolveManualFieldSources(IMPORTED_LEAD, body, body);
  assert.strictEqual(next.Services, "manual");
}

function test4_reorderingAnArrayCountsAsAnEdit_notSilentlyIgnored() {
  // Order is meaningful in the dialog's comma-separated input, so a reorder
  // is a real edit -- documenting the chosen semantics, not an accident.
  const body = dialogBody({ services: ["Dubbing", "Subtitling"] });
  const next = resolveManualFieldSources(IMPORTED_LEAD, body, body);
  assert.strictEqual(next.Services, "manual");
}

function test5_clearingAFieldDropsItsSourceEntirely() {
  const lead = { ...IMPORTED_LEAD, email: "old@example.com", fieldSources: { ...IMPORTED_LEAD.fieldSources, Email_Address: "manual" } };
  const body = dialogBody({ email: null });
  const next = resolveManualFieldSources(lead, body, body);
  assert.ok(!("Email_Address" in next), "a cleared field is fair game for auto-enrichment again");
  assert.strictEqual(next.Source_Language, "existing");
}

function test6_omittedKeysAreNeverTouched() {
  // A partial PATCH (e.g. just `stage`) must leave provenance alone.
  const body = { stage: "CONTACTED" };
  const next = resolveManualFieldSources(IMPORTED_LEAD, body, body);
  assert.deepStrictEqual(next, IMPORTED_LEAD.fieldSources);
}

function test7_leadWithNoFieldSourcesYetStillTagsRealEdits() {
  const lead = { ...IMPORTED_LEAD, fieldSources: null };
  const body = dialogBody({ headline: "Senior Translator" });
  const next = resolveManualFieldSources(lead, body, body);
  assert.deepStrictEqual(next, { Headline: "manual" });
}

function test8_numberFieldComparesAcrossDecimalAndNumber() {
  // yearsOfExperience comes back from Prisma as a Decimal-ish object but is
  // posted as a plain number -- an unchanged value must not read as an edit.
  const lead = { ...IMPORTED_LEAD, yearsOfExperience: { toString: () => "5" } as any };
  const body = dialogBody({ yearsOfExperience: 5 });
  const next = resolveManualFieldSources(lead, body, body);
  assert.ok(!("Years_of_Exp" in next), "an unchanged numeric value must not be tagged manual");
}

function main() {
  const tests = [
    test1_savingWithNoEditsPreservesEveryExistingSource,
    test2_onlyTheEditedFieldIsTaggedManual,
    test3_editingAnArrayFieldIsDetected,
    test4_reorderingAnArrayCountsAsAnEdit_notSilentlyIgnored,
    test5_clearingAFieldDropsItsSourceEntirely,
    test6_omittedKeysAreNeverTouched,
    test7_leadWithNoFieldSourcesYetStillTagsRealEdits,
    test8_numberFieldComparesAcrossDecimalAndNumber,
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
