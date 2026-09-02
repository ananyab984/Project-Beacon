import { describe, it, expect } from "vitest";
import { RateCardService, DEFAULT_RATE_CARD } from "@server/drafting/rateCard";

describe("RateCardService", () => {
  it("uses DEFAULT_RATE_CARD when constructed with no argument", () => {
    const svc = new RateCardService();
    const [row] = svc.lookupRate("English", "German", "Translation");
    expect(row).toEqual(DEFAULT_RATE_CARD[0]);
  });

  it("uses DEFAULT_RATE_CARD when given an empty array", () => {
    const svc = new RateCardService([]);
    const [row] = svc.lookupRate("English", "German", "Translation");
    expect(row?.rate).toBe(0.12);
  });

  it("uses a custom rate card when provided", () => {
    const custom = [{ source_language: "German", target_language: "English", service: "Voiceover", rate: 0.5, unit: "per word", currency: "EUR" }];
    const svc = new RateCardService(custom);
    const [row] = svc.lookupRate("German", "English", "Voiceover");
    expect(row).toEqual(custom[0]);
  });

  it("matches case-insensitively and trims whitespace", () => {
    const svc = new RateCardService();
    const [row] = svc.lookupRate("  ENGLISH  ", "german", "Translation");
    expect(row?.rate).toBe(0.12);
  });

  it("returns NO_RATE_MATCH when neither language is provided", () => {
    const svc = new RateCardService();
    const [row, error] = svc.lookupRate(null, null, "Translation");
    expect(row).toBeNull();
    expect(error).toBe("NO_RATE_MATCH");
  });

  it("returns NO_RATE_MATCH when no row matches the given languages", () => {
    const svc = new RateCardService();
    const [row, error] = svc.lookupRate("Klingon", "Elvish", "Translation");
    expect(row).toBeNull();
    expect(error).toBe("NO_RATE_MATCH");
  });

  it("matches on source language alone when target is not provided", () => {
    const svc = new RateCardService();
    const [row] = svc.lookupRate("English", null, "Translation");
    expect(row).not.toBeNull();
    expect(row?.source_language).toBe("English");
  });
});
