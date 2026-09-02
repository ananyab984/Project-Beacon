import { describe, it, expect } from "vitest";
import { normalizeEmail, validateEmailFormat, normalizeName, validateNameLength } from "@server/lib/normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("strips zero-width/invisible characters", () => {
    expect(normalizeEmail("user​@example.com")).toBe("user@example.com");
  });

  it("NFC-normalizes accented characters", () => {
    // "é" as e + combining acute accent (NFD) should normalize to the same
    // result as the precomposed form.
    const decomposed = "josé@example.com";
    const precomposed = "josé@example.com";
    expect(normalizeEmail(decomposed)).toBe(normalizeEmail(precomposed));
  });
});

describe("validateEmailFormat", () => {
  it.each([
    ["user@example.com", true],
    ["a@b.co", true],
    ["not-an-email", false],
    ["@example.com", false],
    ["user@", false],
    ["", false],
    ["user @example.com", false],
  ])("%s -> %s", (email, expected) => {
    expect(validateEmailFormat(email)).toBe(expected);
  });

  it("rejects an email over the 254-character limit", () => {
    const long = "a".repeat(250) + "@b.co";
    expect(validateEmailFormat(long)).toBe(false);
  });
});

describe("normalizeName", () => {
  it("trims, collapses internal whitespace, and NFC-normalizes", () => {
    expect(normalizeName("  Jane   Doe  ")).toBe("Jane Doe");
  });

  it("caps length at 80 characters", () => {
    const long = "A".repeat(200);
    expect(normalizeName(long).length).toBe(80);
  });

  it("strips zero-width characters", () => {
    expect(normalizeName("Jane​Doe")).toBe("JaneDoe");
  });
});

describe("validateNameLength", () => {
  it("accepts a normal name", () => {
    expect(validateNameLength("Jane Doe")).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(validateNameLength("")).toBe(false);
  });

  it("rejects a name over 80 characters", () => {
    expect(validateNameLength("A".repeat(81))).toBe(false);
  });

  it("accepts a name at exactly 80 characters", () => {
    expect(validateNameLength("A".repeat(80))).toBe(true);
  });
});
