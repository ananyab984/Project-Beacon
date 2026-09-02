import { describe, it, expect } from "vitest";
import { vendorExperienceToPresetList, VENDOR_PRESETS } from "./vendorExperienceToPresets";

describe("vendorExperienceToPresetList", () => {
  it("normalizes casing/spacing for a value that matches a preset", () => {
    expect(vendorExperienceToPresetList("deluxe")).toEqual(["Deluxe"]);
    expect(vendorExperienceToPresetList("ZOO DIGITAL")).toEqual(["Zoo Digital"]);
    expect(vendorExperienceToPresetList("  Pixel   Logic  ")).toEqual(["Pixel Logic"]);
  });

  it("splits a comma-delimited list, matching the same convention already used in draftGenerator.ts", () => {
    expect(vendorExperienceToPresetList("Deluxe,SDI")).toEqual(["Deluxe", "SDI"]);
    expect(vendorExperienceToPresetList("Deluxe, SDI, Pixel Logic")).toEqual(["Deluxe", "SDI", "Pixel Logic"]);
  });

  it("passes through an unmapped token verbatim (their 'other' slot) instead of dropping it", () => {
    expect(vendorExperienceToPresetList("Some Indie Client")).toEqual(["Some Indie Client"]);
    expect(vendorExperienceToPresetList("Deluxe, Some Indie Client")).toEqual(["Deluxe", "Some Indie Client"]);
  });

  it("covers every preset value from the confirmed contract", () => {
    for (const preset of VENDOR_PRESETS) {
      expect(vendorExperienceToPresetList(preset)).toEqual([preset]);
    }
  });

  it("drops empty tokens from stray/doubled commas but keeps real ones", () => {
    expect(vendorExperienceToPresetList("Deluxe,,SDI")).toEqual(["Deluxe", "SDI"]);
    expect(vendorExperienceToPresetList("Deluxe, ,SDI")).toEqual(["Deluxe", "SDI"]);
  });

  it("returns an empty list for null, undefined, and empty/whitespace-only values", () => {
    expect(vendorExperienceToPresetList(null)).toEqual([]);
    expect(vendorExperienceToPresetList(undefined)).toEqual([]);
    expect(vendorExperienceToPresetList("")).toEqual([]);
    expect(vendorExperienceToPresetList("   ")).toEqual([]);
  });
});
