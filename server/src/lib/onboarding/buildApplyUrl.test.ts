import { describe, it, expect, beforeAll } from "vitest";
import { buildApplyUrl, buildCallbackUrl, deriveLastName, extractLinkedInUrl } from "./buildApplyUrl";
import { verifyLeadSignature } from "./callbackToken";

// A fake Decimal matching the one method buildApplyUrl actually calls
// (.toNumber()) -- avoids pulling in Prisma's real Decimal just for a
// unit test of a pure function.
function fakeDecimal(n: number) {
  return { toNumber: () => n } as any;
}

function baseLead(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    firstName: "Ana",
    fullName: "Ana Silva",
    email: "ana@example.com",
    country: "Brazil",
    sourceLanguage: "English",
    targetLanguage: "Portuguese (Brazilian)",
    services: ["Subtitling"],
    yearsOfExperience: fakeDecimal(5),
    vendorExperience: "Deluxe,SDI",
    profileLink: "https://linkedin.com/in/ana-silva",
    ...overrides,
  };
}

function parseQuery(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("buildApplyUrl", () => {
  it("builds the confirmed contract's own worked example correctly", () => {
    const lead = baseLead();
    const url = buildApplyUrl(lead as any);
    const q = parseQuery(url);

    expect(q.get("first_name")).toBe("Ana");
    expect(q.get("last_name")).toBe("Silva");
    expect(q.get("email")).toBe("ana@example.com");
    expect(q.get("address_country")).toBe("BR");
    expect(q.get("source_language")).toBe("en-US");
    expect(q.get("target_language")).toBe("pt-BR");
    expect(q.get("service")).toBe("sub");
    expect(q.get("years_of_experience")).toBe("5");
    expect(q.get("vendor_experience")).toBe("Deluxe,SDI");
    expect(q.get("linkedin")).toBe("https://linkedin.com/in/ana-silva");
  });

  it("omits every param whose underlying field is null/unknown -- never an empty string or placeholder", () => {
    const lead = baseLead({
      firstName: null,
      fullName: null,
      email: null,
      country: null,
      sourceLanguage: null,
      targetLanguage: null,
      services: [],
      yearsOfExperience: null,
      vendorExperience: null,
      profileLink: null,
    });
    const url = buildApplyUrl(lead as any);
    const q = parseQuery(url);

    for (const key of [
      "first_name", "last_name", "email", "address_country", "source_language",
      "target_language", "service", "years_of_experience", "vendor_experience", "linkedin",
    ]) {
      expect(q.has(key), `expected "${key}" to be omitted`).toBe(false);
    }
    // callback_url is always present -- it's how G3 tells us the submission happened at all.
    expect(q.has("callback_url")).toBe(true);
  });

  it("omits address_country/source_language/target_language when the value doesn't map, rather than guessing", () => {
    const lead = baseLead({ country: "Narnia", sourceLanguage: "Klingon", targetLanguage: "Elvish" });
    const q = parseQuery(buildApplyUrl(lead as any));
    expect(q.has("address_country")).toBe(false);
    expect(q.has("source_language")).toBe(false);
    expect(q.has("target_language")).toBe(false);
  });

  it("never omits service when a value is present, even an unmapped one -- falls into 'others'", () => {
    const lead = baseLead({ services: ["Some Brand New Service"] });
    const q = parseQuery(buildApplyUrl(lead as any));
    expect(q.get("service")).toBe("others");
  });

  it("uses only this lead's single service/language-pair (services[0]) -- the form accepts exactly one", () => {
    const lead = baseLead({ services: ["Subtitling", "Dubbing", "SDH"] });
    const q = parseQuery(buildApplyUrl(lead as any));
    expect(q.get("service")).toBe("sub");
  });

  it("only includes linkedin when profileLink is actually a LinkedIn URL", () => {
    const withProz = baseLead({ profileLink: "https://www.proz.com/profile/12345" });
    expect(parseQuery(buildApplyUrl(withProz as any)).has("linkedin")).toBe(false);

    const withNothing = baseLead({ profileLink: null });
    expect(parseQuery(buildApplyUrl(withNothing as any)).has("linkedin")).toBe(false);

    const withLinkedIn = baseLead({ profileLink: "https://linkedin.com/in/someone" });
    expect(parseQuery(buildApplyUrl(withLinkedIn as any)).get("linkedin")).toBe("https://linkedin.com/in/someone");
  });

  describe("years_of_experience edge cases", () => {
    it("omits when null", () => {
      expect(parseQuery(buildApplyUrl(baseLead({ yearsOfExperience: null }) as any)).has("years_of_experience")).toBe(false);
    });

    it("sends zero as a real value, not treating it as empty", () => {
      expect(parseQuery(buildApplyUrl(baseLead({ yearsOfExperience: fakeDecimal(0) }) as any)).get("years_of_experience")).toBe("0");
    });

    it("rounds a non-integer to the nearest whole year rather than sending garbage", () => {
      expect(parseQuery(buildApplyUrl(baseLead({ yearsOfExperience: fakeDecimal(5.5) }) as any)).get("years_of_experience")).toBe("6");
      expect(parseQuery(buildApplyUrl(baseLead({ yearsOfExperience: fakeDecimal(5.4) }) as any)).get("years_of_experience")).toBe("5");
    });

    it("omits a negative or non-finite value rather than sending garbage", () => {
      expect(parseQuery(buildApplyUrl(baseLead({ yearsOfExperience: fakeDecimal(-1) }) as any)).has("years_of_experience")).toBe(false);
      expect(parseQuery(buildApplyUrl(baseLead({ yearsOfExperience: fakeDecimal(NaN) }) as any)).has("years_of_experience")).toBe(false);
    });
  });

  describe("vendor_experience delimiter/encoding", () => {
    it("omits the param entirely when there's nothing on file", () => {
      expect(parseQuery(buildApplyUrl(baseLead({ vendorExperience: null }) as any)).has("vendor_experience")).toBe(false);
    });

    it("keeps a reserved character inside one vendor's own name from corrupting the query string or being mistaken for the list separator", () => {
      // "&" would corrupt query-string parsing entirely if left unencoded
      // -- this exercises the same "encode each value before joining, not
      // after" requirement the delimiter-collision warning is about,
      // using a character that (unlike a literal comma) can actually
      // survive vendorExperienceToPresetList's own comma-based split and
      // reach this encoding step intact.
      const lead = baseLead({ vendorExperience: "Deluxe,Smith & Co" });
      const url = buildApplyUrl(lead as any);

      const rawValue = url.split("vendor_experience=")[1].split("&")[0];
      const tokens = rawValue.split(",");
      expect(tokens.length).toBe(2);
      expect(decodeURIComponent(tokens[0])).toBe("Deluxe");
      expect(decodeURIComponent(tokens[1])).toBe("Smith & Co");

      // The embedded "&" must not have split into a bogus extra param --
      // every other param on the URL must still parse correctly.
      const q = parseQuery(url);
      expect(q.get("email")).toBe(lead.email);
    });

    it("acknowledges the one collision this can't fully solve: an embedded comma in the RAW vendorExperience field is indistinguishable from a real separator before it ever reaches this function (same limitation as the existing comma-split in drafting/draftGenerator.ts)", () => {
      const lead = baseLead({ vendorExperience: "Deluxe, Smith, Inc." });
      const url = buildApplyUrl(lead as any);
      const rawValue = url.split("vendor_experience=")[1].split("&")[0];
      // "Smith, Inc." was already split into two tokens upstream, by our
      // own field's storage format, before buildApplyUrl ever sees it --
      // this documents that reality rather than silently pretending it's
      // solved. Both halves still round-trip cleanly, they're just two
      // list entries instead of one.
      expect(rawValue.split(",").map(decodeURIComponent)).toEqual(["Deluxe", "Smith", "Inc."]);
    });
  });

  describe("last_name derivation (no dedicated lastName field on Lead)", () => {
    it("uses the whole fullName when there's no firstName on file", () => {
      expect(deriveLastName({ firstName: null, fullName: "Chen" })).toBe("Chen");
    });

    it("strips a matching firstName prefix off fullName", () => {
      expect(deriveLastName({ firstName: "Alex", fullName: "Alex Chen" })).toBe("Chen");
    });

    it("omits when fullName is exactly firstName -- no last-name portion exists", () => {
      expect(deriveLastName({ firstName: "Alex", fullName: "Alex" })).toBeUndefined();
    });

    it("falls back to the last whitespace-separated token for legacy/mismatched data", () => {
      expect(deriveLastName({ firstName: "Bob", fullName: "Alex Chen" })).toBe("Chen");
    });

    it("omits when there's no name at all", () => {
      expect(deriveLastName({ firstName: null, fullName: null })).toBeUndefined();
    });
  });

  it("warns (does not throw) if the built URL exceeds the safety length threshold", () => {
    const longVendorList = Array.from({ length: 40 }, (_, i) => `Some Very Long Vendor Name Number ${i}`).join(",");
    const lead = baseLead({ vendorExperience: longVendorList });
    expect(() => buildApplyUrl(lead as any)).not.toThrow();
  });
});

describe("buildCallbackUrl", () => {
  beforeAll(() => {
    // Sanity: config's required onboarding env vars must be set for this
    // suite to even import successfully -- see server/.env / .env.example.
  });

  it("embeds lead_id and a verifiable per-lead signature as its own query params", () => {
    const leadId = "99999999-9999-9999-9999-999999999999";
    const callbackUrl = buildCallbackUrl(leadId);
    const q = new URL(callbackUrl).searchParams;
    expect(q.get("lead_id")).toBe(leadId);
    expect(verifyLeadSignature(leadId, q.get("sig"))).toBe(true);
  });

  it("is embedded in the outer apply URL fully encoded, and decodes back to the exact same callback_url", () => {
    const lead = baseLead();
    const url = buildApplyUrl(lead as any);
    const q = parseQuery(url);
    const encodedCallback = url.split("callback_url=")[1];
    const decodedOnce = decodeURIComponent(encodedCallback);
    // What URLSearchParams itself decodes to should match what we get from
    // manually decoding the raw segment -- confirms no double-encoding drift.
    expect(q.get("callback_url")).toBe(decodedOnce);

    const inner = new URL(decodedOnce);
    expect(inner.searchParams.get("lead_id")).toBe(lead.id);
    expect(verifyLeadSignature(lead.id, inner.searchParams.get("sig"))).toBe(true);
  });
});
