/**
 * Unit tests for the COUNTRIES list backing the Add a Lead / Contractor Add
 * a Lead "Country of Residence" dropdown. Pins the two properties that
 * actually matter for the bug this replaced (a free-text field silently
 * defaulting to "Germany" for every new lead): every entry is unique, and
 * the list is genuinely alphabetical so a recruiter can scan-find a country
 * rather than hunt through an arbitrary order.
 *
 * Run: cd client && npx tsx src/lib/countries.test.ts
 */
import assert from "node:assert";
import { COUNTRIES } from "./countries";

function test1_isAlphabeticallySorted() {
  const sorted = [...COUNTRIES].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(COUNTRIES, sorted);
}

function test2_hasNoDuplicates() {
  assert.strictEqual(new Set(COUNTRIES).size, COUNTRIES.length);
}

function test3_coversAReasonableNumberOfCountries() {
  // Loosely bounds the list (not an exact ISO count) -- just guards against
  // an accidental near-empty list slipping through.
  assert.ok(COUNTRIES.length > 150, `expected 150+ countries, got ${COUNTRIES.length}`);
}

function test4_doesNotSecretlyDefaultToGermanyOrAnyoneElse() {
  // The list itself carries no notion of a "default" -- Germany appears
  // once, in alphabetical position, same as every other country.
  assert.strictEqual(COUNTRIES.filter((c) => c === "Germany").length, 1);
}

function main() {
  const tests = [
    test1_isAlphabeticallySorted,
    test2_hasNoDuplicates,
    test3_coversAReasonableNumberOfCountries,
    test4_doesNotSecretlyDefaultToGermanyOrAnyoneElse,
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
