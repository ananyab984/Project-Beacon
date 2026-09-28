/**
 * Unit tests for normalizeToolsSoftware / normalizeVendorExperience --
 * the Tools_Software / Vendor_Experience analogues of normalizeServices,
 * added when Vendor Experience became a real multi-value array (mirrors
 * Services/Tools_Software) and Tools_Software's canonical list was expanded
 * to match the recruiter-facing Software Proficiency dropdown.
 *
 * Run: cd server && npx ts-node src/lib/normalizeToolsVendors.test.ts
 */

import assert from "node:assert";
import { normalizeToolsSoftware } from "./normalizeToolsSoftware";
import { normalizeVendorExperience } from "./normalizeVendorExperience";

function test1_toolsCasingAndSpacingVariantsNormalize() {
  assert.deepStrictEqual(
    normalizeToolsSoftware("protools, premiere, davinci resolve"),
    ["Pro Tools", "Adobe Premiere Pro", "DaVinci Resolve"]
  );
}

function test2_toolsUnknownTokenIsKeptNotDropped() {
  assert.deepStrictEqual(normalizeToolsSoftware("SDL Trados"), ["SDL Trados"]);
}

function test3_toolsEmptyOrNullReturnsEmptyArray() {
  assert.deepStrictEqual(normalizeToolsSoftware(null), []);
  assert.deepStrictEqual(normalizeToolsSoftware(undefined), []);
  assert.deepStrictEqual(normalizeToolsSoftware(""), []);
}

function test4_vendorCasingAndSynonymVariantsNormalize() {
  assert.deepStrictEqual(
    normalizeVendorExperience("SDI Media, pixelogic, zoo digital group"),
    ["SDI", "Pixel Logic", "Zoo Digital"]
  );
}

function test5_vendorUnknownTokenIsKeptNotDropped() {
  assert.deepStrictEqual(normalizeVendorExperience("Some Unrelated Freelance Client"), ["Some Unrelated Freelance Client"]);
}

function test6_vendorArrayInputDedupesCaseInsensitively() {
  assert.deepStrictEqual(normalizeVendorExperience(["SDI", "sdi", "BTI"]), ["SDI", "BTI"]);
}

function main() {
  const tests = [
    test1_toolsCasingAndSpacingVariantsNormalize,
    test2_toolsUnknownTokenIsKeptNotDropped,
    test3_toolsEmptyOrNullReturnsEmptyArray,
    test4_vendorCasingAndSynonymVariantsNormalize,
    test5_vendorUnknownTokenIsKeptNotDropped,
    test6_vendorArrayInputDedupesCaseInsensitively,
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
