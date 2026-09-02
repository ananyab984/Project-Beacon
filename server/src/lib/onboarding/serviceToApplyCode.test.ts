import { describe, it, expect } from "vitest";
import { serviceToApplyCode } from "./serviceToApplyCode";

// Mirrors client/src/lib/services.ts's STANDARD_SERVICES verbatim (literal
// copy, not a cross-package import -- see languageToBcp47.test.ts for why).
const STANDARD_SERVICES = [
  "AI Post-editing", "Audio Description", "CC", "Conform", "Dubbing",
  "Interpretation", "Localization QA", "Prelude", "Quality Control", "SDH",
  "Scripting", "Subtitling", "Transcreation", "Transcription", "Translation",
  "Voice Over",
];

const VALID_CODES = new Set(["scr", "sub", "sdh", "cc", "dub", "ad", "others"]);

describe("serviceToApplyCode", () => {
  it("maps every service label our data actually contains to a valid enum code", () => {
    for (const label of STANDARD_SERVICES) {
      const code = serviceToApplyCode(label);
      expect(code, `expected a code for "${label}"`).toBeDefined();
      expect(VALID_CODES.has(code as string)).toBe(true);
    }
  });

  it("maps the services with a dedicated slot in G3's enum correctly", () => {
    expect(serviceToApplyCode("Subtitling")).toBe("sub");
    expect(serviceToApplyCode("SDH")).toBe("sdh");
    expect(serviceToApplyCode("CC")).toBe("cc");
    expect(serviceToApplyCode("Dubbing")).toBe("dub");
    expect(serviceToApplyCode("Audio Description")).toBe("ad");
    expect(serviceToApplyCode("Scripting")).toBe("scr");
  });

  it("never invents a code outside the confirmed enum for an unmapped-but-present value -- falls into 'others'", () => {
    expect(serviceToApplyCode("Translation")).toBe("others");
    expect(serviceToApplyCode("Voice Over")).toBe("others");
    expect(serviceToApplyCode("Some Brand New Service Nobody Has Seen")).toBe("others");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(serviceToApplyCode("dubbing")).toBe("dub");
    expect(serviceToApplyCode("  Dubbing  ")).toBe("dub");
  });

  it("omits (returns undefined) only when there is truly no service value at all", () => {
    expect(serviceToApplyCode(null)).toBeUndefined();
    expect(serviceToApplyCode(undefined)).toBeUndefined();
    expect(serviceToApplyCode("")).toBeUndefined();
    expect(serviceToApplyCode("   ")).toBeUndefined();
  });
});
