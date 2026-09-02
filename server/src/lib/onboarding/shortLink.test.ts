import { describe, it, expect } from "vitest";
import { encodeLeadIdToken, decodeShortLinkToken, buildShortApplyUrl } from "./shortLink";
import { config } from "../../config";

const LEAD_ID = "11111111-2222-3333-4444-555555555555";

describe("encodeLeadIdToken / decodeShortLinkToken", () => {
  it("round-trips a valid UUID exactly", () => {
    const token = encodeLeadIdToken(LEAD_ID);
    expect(decodeShortLinkToken(token)).toBe(LEAD_ID);
  });

  it("produces a compact, URL-safe, fixed-length token (shorter than the raw UUID)", () => {
    const token = encodeLeadIdToken(LEAD_ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(token.length).toBeLessThan(LEAD_ID.length);
  });

  it("is deterministic -- encoding the same id twice gives the same token", () => {
    expect(encodeLeadIdToken(LEAD_ID)).toBe(encodeLeadIdToken(LEAD_ID));
  });

  it("produces different tokens for different lead ids", () => {
    const other = "99999999-8888-7777-6666-555555555555";
    expect(encodeLeadIdToken(LEAD_ID)).not.toBe(encodeLeadIdToken(other));
  });

  it("rejects a non-UUID input to encode", () => {
    expect(() => encodeLeadIdToken("not-a-uuid")).toThrow();
    expect(() => encodeLeadIdToken("")).toThrow();
  });

  it("never throws on malformed/tampered decode input -- returns null instead", () => {
    expect(decodeShortLinkToken(null)).toBeNull();
    expect(decodeShortLinkToken(undefined)).toBeNull();
    expect(decodeShortLinkToken("")).toBeNull();
    expect(decodeShortLinkToken("short")).toBeNull();
    expect(decodeShortLinkToken("not-base64url-!!!!!!!!")).toBeNull();
    // Wrong length (21 chars, not 22) -- rejected by the token format check
    // before ever attempting a base64url decode.
    expect(decodeShortLinkToken("A".repeat(21))).toBeNull();
    expect(() => decodeShortLinkToken("' OR 1=1 --")).not.toThrow();
    expect(decodeShortLinkToken("' OR 1=1 --")).toBeNull();
  });

  it("rejects a tampered token that decodes to the wrong byte length", () => {
    const token = encodeLeadIdToken(LEAD_ID);
    const truncated = token.slice(0, -2);
    expect(decodeShortLinkToken(truncated)).toBeNull();
  });
});

describe("buildShortApplyUrl", () => {
  it("builds a short link under our own app base URL that decodes back to the same lead id", () => {
    const url = buildShortApplyUrl(LEAD_ID);
    expect(url.startsWith(`${config.appBaseUrl}/g/`)).toBe(true);
    const token = url.split("/g/")[1];
    expect(decodeShortLinkToken(token)).toBe(LEAD_ID);
  });

  it("is dramatically shorter than a full pre-filled apply URL", () => {
    const shortUrl = buildShortApplyUrl(LEAD_ID);
    // A real personalized apply URL easily runs 400-500+ chars with all
    // params; this must stay small regardless of how many fields a lead has.
    expect(shortUrl.length).toBeLessThan(120);
  });
});
