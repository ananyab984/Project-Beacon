import { describe, it, expect } from "vitest";
import { countryToIso2, COUNTRY_NAME_TO_ISO2 } from "./countryToIso2";

describe("countryToIso2", () => {
  it("maps every entry in the table to itself when normalized (sanity check on the table)", () => {
    for (const [name, iso2] of Object.entries(COUNTRY_NAME_TO_ISO2)) {
      expect(countryToIso2(name)).toBe(iso2);
      expect(iso2).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(countryToIso2("Germany")).toBe("DE");
    expect(countryToIso2("GERMANY")).toBe("DE");
    expect(countryToIso2("  germany  ")).toBe("DE");
  });

  it("handles common real-data variants seen in this repo's own country field", () => {
    expect(countryToIso2("India")).toBe("IN");
    expect(countryToIso2("United States")).toBe("US");
    expect(countryToIso2("USA")).toBe("US");
    expect(countryToIso2("UK")).toBe("GB");
    expect(countryToIso2("United Kingdom")).toBe("GB");
  });

  it("omits (returns undefined) for null, undefined, empty, and unrecognized values -- never guesses", () => {
    expect(countryToIso2(null)).toBeUndefined();
    expect(countryToIso2(undefined)).toBeUndefined();
    expect(countryToIso2("")).toBeUndefined();
    expect(countryToIso2("   ")).toBeUndefined();
    expect(countryToIso2("Narnia")).toBeUndefined();
    expect(countryToIso2("Atlantis")).toBeUndefined();
  });
});
