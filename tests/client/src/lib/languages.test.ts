import { describe, it, expect } from "vitest";
import { STANDARD_LANGUAGES } from "@/lib/languages";

describe("STANDARD_LANGUAGES", () => {
  it("is a non-empty array of unique strings", () => {
    expect(STANDARD_LANGUAGES.length).toBeGreaterThan(0);
    expect(new Set(STANDARD_LANGUAGES).size).toBe(STANDARD_LANGUAGES.length);
  });
  it("is alphabetically sorted", () => {
    const sorted = [...STANDARD_LANGUAGES].sort((a, b) => a.localeCompare(b));
    expect(STANDARD_LANGUAGES).toEqual(sorted);
  });
  it("includes English", () => {
    expect(STANDARD_LANGUAGES).toContain("English");
  });
});
