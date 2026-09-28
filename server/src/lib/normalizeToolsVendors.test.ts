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
import { normalizeVendorExperience, canonicalizeVendorToken } from "./normalizeVendorExperience";

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

function test7_vendorEmploymentStatusLabelsAreDroppedNotKept() {
  // "Freelancer" is what BrightData puts in current_company for someone
  // describing how they work, not a real company -- must never surface as
  // if it were a vendor, unlike a genuine unrelated employer (test5).
  assert.deepStrictEqual(normalizeVendorExperience(["Freelancer", "Kinotitles Srls"]), ["Kinotitles Srls"]);
  assert.deepStrictEqual(normalizeVendorExperience("Self-employed"), []);
}

function test8_canonicalizeVendorTokenDoesNotSplitOnCommaWithinACompanyName() {
  // A real company name can legitimately contain a comma ("Brindauto
  // Comptoir, SA"). canonicalizeVendorToken processes one already-discrete
  // array element, unlike normalizeVendorExperience (which correctly splits
  // a genuinely delimited blob string, but would wrongly shred this).
  assert.strictEqual(canonicalizeVendorToken("Brindauto Comptoir, SA"), "Brindauto Comptoir, SA");
  assert.strictEqual(canonicalizeVendorToken("CristBet, Lda"), "CristBet, Lda");
  assert.strictEqual(canonicalizeVendorToken("  SDI Media  "), "SDI");
  assert.strictEqual(canonicalizeVendorToken("Freelancer"), null);
}

function main() {
  const tests = [
    test1_toolsCasingAndSpacingVariantsNormalize,
    test2_toolsUnknownTokenIsKeptNotDropped,
    test3_toolsEmptyOrNullReturnsEmptyArray,
    test4_vendorCasingAndSynonymVariantsNormalize,
    test5_vendorUnknownTokenIsKeptNotDropped,
    test6_vendorArrayInputDedupesCaseInsensitively,
    test7_vendorEmploymentStatusLabelsAreDroppedNotKept,
    test8_canonicalizeVendorTokenDoesNotSplitOnCommaWithinACompanyName,
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
