/**
 * Unit tests for resolveServiceValue -- the Add a Lead / Contractor Add a
 * Lead "Others" escape hatch. Mirrors Global3's own candidate-onboarding
 * form, which splits an out-of-list service into two fields (Custom
 * Service, Custom Task) rather than one free-text box; this pins how those
 * two fields fold back into the single comma-joined string the dialogs
 * already split on "," to build the final services[] array.
 *
 * Run: cd client && npx tsx src/components/features/lead-form-fields.test.ts
 */
import assert from "node:assert";
import { resolveServiceValue, SERVICE_OTHERS_VALUE } from "./lead-form-fields";

function test1_realServicePassesThroughUnchanged() {
  assert.strictEqual(resolveServiceValue("Translation", "", ""), "Translation");
}

function test2_othersWithBothFieldsJoinsAsTwoEntries() {
  assert.strictEqual(
    resolveServiceValue(SERVICE_OTHERS_VALUE, "Game Localization", "Voice Direction"),
    "Game Localization, Voice Direction"
  );
}

function test3_othersWithOnlyCustomServiceOmitsTrailingComma() {
  assert.strictEqual(resolveServiceValue(SERVICE_OTHERS_VALUE, "Game Localization", ""), "Game Localization");
}

function test4_othersWithOnlyCustomTaskUsesJustTheTask() {
  assert.strictEqual(resolveServiceValue(SERVICE_OTHERS_VALUE, "", "Voice Direction"), "Voice Direction");
}

function test5_othersWithBothEmptyStaysGenuinelyEmpty() {
  // No fake fallback -- an unfilled Others pair must resolve to "", not a
  // guessed default the drafting prompt would later treat as a verified
  // fact about the candidate.
  assert.strictEqual(resolveServiceValue(SERVICE_OTHERS_VALUE, "", ""), "");
}

function test6_trimsWhitespaceFromCustomFields() {
  assert.strictEqual(resolveServiceValue(SERVICE_OTHERS_VALUE, "  Dialogue Editing  ", "  "), "Dialogue Editing");
}

function main() {
  const tests = [
    test1_realServicePassesThroughUnchanged,
    test2_othersWithBothFieldsJoinsAsTwoEntries,
    test3_othersWithOnlyCustomServiceOmitsTrailingComma,
    test4_othersWithOnlyCustomTaskUsesJustTheTask,
    test5_othersWithBothEmptyStaysGenuinelyEmpty,
    test6_trimsWhitespaceFromCustomFields,
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
