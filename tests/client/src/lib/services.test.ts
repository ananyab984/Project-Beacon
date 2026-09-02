import { describe, it, expect } from "vitest";
import { STANDARD_SERVICES } from "@/lib/services";

describe("STANDARD_SERVICES", () => {
  it("is a non-empty array of unique strings", () => {
    expect(STANDARD_SERVICES.length).toBeGreaterThan(0);
    expect(new Set(STANDARD_SERVICES).size).toBe(STANDARD_SERVICES.length);
  });
  it("includes Translation", () => {
    expect(STANDARD_SERVICES).toContain("Translation");
  });
});
