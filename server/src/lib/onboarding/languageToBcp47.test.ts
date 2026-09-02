import { describe, it, expect } from "vitest";
import { languageToBcp47, LANGUAGE_LABEL_TO_BCP47 } from "./languageToBcp47";

// Mirrors client/src/lib/languages.ts's STANDARD_LANGUAGES verbatim (kept
// as a literal copy rather than a cross-package import, since client/ and
// server/ are separate npm packages) -- if that list ever changes, update
// both this fixture and languageToBcp47.ts's mapping table together.
const STANDARD_LANGUAGES = [
  "Arabic", "Bengali", "Bulgarian", "Cantonese", "Castilian Spanish", "Catalan",
  "Chinese (Simplified)", "Chinese (Traditional)", "Croatian", "Czech", "Danish",
  "Dutch", "English", "English (AUS)", "English (Canada)", "English (UK)",
  "Finnish", "French", "French (Canadian)", "French (Parisian)", "German",
  "Greek", "Gujarati", "Hebrew", "Hindi", "Hungarian", "Icelandic", "Indonesian",
  "Italian", "Japanese", "Kannada", "Kazakh", "Korean", "Malay", "Malayalam",
  "Marathi", "Norwegian", "Odia", "Polish", "Portuguese (Brazilian)",
  "Portuguese (Portugal)", "Punjabi", "Romanian", "Russian", "Slovak",
  "Slovenian", "Spanish (LatAm)", "Spanish (Latin America)", "Swedish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
];

const BCP47_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

describe("languageToBcp47", () => {
  it("maps every language label our data actually contains, not just the happy-path examples from the contract", () => {
    for (const label of STANDARD_LANGUAGES) {
      const tag = languageToBcp47(label);
      expect(tag, `expected a mapping for "${label}"`).toBeDefined();
      expect(tag).toMatch(BCP47_PATTERN);
    }
  });

  it("matches the confirmed contract's own examples exactly", () => {
    expect(languageToBcp47("English")).toBe("en-US");
    expect(languageToBcp47("Portuguese (Brazilian)")).toBe("pt-BR");
  });

  it("maps both Spanish (LatAm) duplicate entries to the same region-neutral tag", () => {
    expect(languageToBcp47("Spanish (LatAm)")).toBe("es-419");
    expect(languageToBcp47("Spanish (Latin America)")).toBe("es-419");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(languageToBcp47("german")).toBe("de-DE");
    expect(languageToBcp47("  German  ")).toBe("de-DE");
  });

  it("omits (returns undefined) for null, undefined, empty, and unrecognized labels", () => {
    expect(languageToBcp47(null)).toBeUndefined();
    expect(languageToBcp47(undefined)).toBeUndefined();
    expect(languageToBcp47("")).toBeUndefined();
    expect(languageToBcp47("Klingon")).toBeUndefined();
  });

  it("has no duplicate keys shadowing each other in the source table (sanity check on the literal)", () => {
    const keys = Object.keys(LANGUAGE_LABEL_TO_BCP47);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
