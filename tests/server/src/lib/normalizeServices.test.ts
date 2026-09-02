import { describe, it, expect } from "vitest";
import { normalizeServices } from "@server/lib/normalizeServices";

describe("normalizeServices", () => {
  it("returns an empty array for null/undefined/empty input", () => {
    expect(normalizeServices(null)).toEqual([]);
    expect(normalizeServices(undefined)).toEqual([]);
    expect(normalizeServices("")).toEqual([]);
  });

  it("splits a colon-delimited raw value and normalizes each token", () => {
    expect(normalizeServices("Sub:Dubbing:Audio Description")).toEqual(["Subtitling", "Dubbing", "Audio Description"]);
  });

  it("splits on comma, semicolon, slash, and pipe too", () => {
    expect(normalizeServices("Dubbing, Subtitling; Translation/Voice Over|CC")).toEqual([
      "Dubbing",
      "Subtitling",
      "Translation",
      "Voice Over",
      "CC",
    ]);
  });

  it("case-insensitively matches an already-canonical value regardless of casing", () => {
    expect(normalizeServices("subtitling")).toEqual(["Subtitling"]);
    expect(normalizeServices("VOICE OVER")).toEqual(["Voice Over"]);
  });

  it("maps known synonyms onto their canonical form", () => {
    expect(normalizeServices("Voiceover")).toEqual(["Voice Over"]);
    expect(normalizeServices("voice-over")).toEqual(["Voice Over"]);
    expect(normalizeServices("interpreting")).toEqual(["Interpretation"]);
    expect(normalizeServices("Sub")).toEqual(["Subtitling"]);
    expect(normalizeServices("qc")).toEqual(["Quality Control"]);
    expect(normalizeServices("QC editor")).toEqual(["Quality Control"]);
    expect(normalizeServices("Closed Captioning")).toEqual(["CC"]);
  });

  it("passes through an unrecognized token unchanged rather than dropping it", () => {
    expect(normalizeServices("proofreading")).toEqual(["proofreading"]);
  });

  it("deduplicates repeated canonical values after normalization", () => {
    expect(normalizeServices(["Voice Over", "Voiceover", "voice over"])).toEqual(["Voice Over"]);
  });

  it("accepts an array input directly, applying the same split+normalize per element", () => {
    expect(normalizeServices(["Sub:Dubbing", "Voiceover"])).toEqual(["Subtitling", "Dubbing", "Voice Over"]);
  });

  it("trims whitespace around tokens", () => {
    expect(normalizeServices("  Dubbing ,  Subtitling  ")).toEqual(["Dubbing", "Subtitling"]);
  });

  it("filters out empty tokens produced by consecutive separators", () => {
    expect(normalizeServices("Dubbing,,Subtitling")).toEqual(["Dubbing", "Subtitling"]);
  });
});
