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
import { normalizeVendorExperience, canonicalizeVendorToken, matchVendorsInText } from "./normalizeVendorExperience";

function test1_toolsCasingAndSpacingVariantsNormalize() {
  assert.deepStrictEqual(
    normalizeToolsSoftware("protools, premiere, davinci resolve"),
    ["Pro Tools", "Adobe Premiere Pro", "DaVinci Resolve"]
  );
}

function test2_toolsUnknownTokenIsKeptNotDropped() {
  assert.deepStrictEqual(normalizeToolsSoftware("Matecat"), ["Matecat"]);
  // A newly-known tool is renamed to the pipeline's spelling.
  assert.deepStrictEqual(normalizeToolsSoftware("SDL Trados"), ["SDL Trados Studio"]);
}

function test9_toolNamesKeepTheirOwnSlashAndDuplicatesCollapseCaseInsensitively() {
  assert.deepStrictEqual(normalizeToolsSoftware("Final Cut Pro X/7, Reaper, REAPER"), ["Final Cut Pro X/7", "Reaper"]);
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

function test11_btiAliasDoesNotFalsePositiveOnSubtitle() {
  // Regression: a plain substring check matched bare "bti" embedded inside
  // "subtitle"/"subtitling"/"subtitler" -- a near-universal word on this
  // exact kind of profile -- reporting BTI as vendor experience on almost
  // every lead regardless of its actual content.
  assert.deepStrictEqual(matchVendorsInText("Experienced subtitler and subtitling QA specialist"), []);
  assert.deepStrictEqual(matchVendorsInText("Long-time freelancer for BTI on subtitling projects"), ["BTI"]);
}

function test10_matchVendorsInTextScansProseForKnownVendorsOnly() {
  assert.deepStrictEqual(matchVendorsInText("QC lead at SDI Media for 3 years"), ["SDI"]);
  assert.deepStrictEqual(matchVendorsInText("Worked at a small unrelated agency, not a known vendor"), []);
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
    test9_toolNamesKeepTheirOwnSlashAndDuplicatesCollapseCaseInsensitively,
    test10_matchVendorsInTextScansProseForKnownVendorsOnly,
    test11_btiAliasDoesNotFalsePositiveOnSubtitle,
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
