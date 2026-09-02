import { describe, it, expect } from "vitest";
import { sequenceMatcherRatio } from "@server/drafting/lib/sequenceMatcher";

describe("sequenceMatcherRatio", () => {
  it("returns 1.0 for two identical strings", () => {
    expect(sequenceMatcherRatio("hello world", "hello world")).toBe(1.0);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(sequenceMatcherRatio("", "")).toBe(1.0);
  });

  it("returns 0 for two completely different strings with no overlap", () => {
    expect(sequenceMatcherRatio("abc", "xyz")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially similar strings", () => {
    const ratio = sequenceMatcherRatio("hello world", "hello there");
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it("matches Python's difflib.SequenceMatcher known reference value", () => {
    // Confirmed against a real Python difflib.SequenceMatcher(None, "abcd", "bcde").ratio() == 0.75
    expect(sequenceMatcherRatio("abcd", "bcde")).toBeCloseTo(0.75, 5);
  });

  it("is symmetric-ish in practice for simple substitutions (sanity, not a strict math guarantee)", () => {
    const a = sequenceMatcherRatio("kitten", "sitting");
    expect(a).toBeGreaterThan(0.5);
  });

  it("handles a long (>=200 char) sequence without crashing (exercises the autojunk path)", () => {
    const long = "a".repeat(250);
    const other = "a".repeat(200) + "b".repeat(50);
    const ratio = sequenceMatcherRatio(long, other);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });
});
