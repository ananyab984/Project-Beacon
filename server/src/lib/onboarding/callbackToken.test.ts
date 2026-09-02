import { describe, it, expect } from "vitest";
import { signLeadId, verifyLeadSignature } from "./callbackToken";

describe("signLeadId / verifyLeadSignature", () => {
  it("produces a signature that verifies against the same lead_id", () => {
    const leadId = "11111111-1111-1111-1111-111111111111";
    const sig = signLeadId(leadId);
    expect(verifyLeadSignature(leadId, sig)).toBe(true);
  });

  it("is deterministic -- signing the same lead_id twice gives the same signature", () => {
    const leadId = "22222222-2222-2222-2222-222222222222";
    expect(signLeadId(leadId)).toBe(signLeadId(leadId));
  });

  it("rejects a signature generated for a different lead_id -- prevents replaying one lead's callback URL against another", () => {
    const leadA = "11111111-1111-1111-1111-111111111111";
    const leadB = "22222222-2222-2222-2222-222222222222";
    const sigForA = signLeadId(leadA);
    expect(verifyLeadSignature(leadB, sigForA)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const leadId = "33333333-3333-3333-3333-333333333333";
    const sig = signLeadId(leadId);
    const tampered = sig.slice(0, -1) + (sig.at(-1) === "0" ? "1" : "0");
    expect(verifyLeadSignature(leadId, tampered)).toBe(false);
  });

  it("rejects missing, empty, or malformed (non-hex) signatures without throwing", () => {
    const leadId = "44444444-4444-4444-4444-444444444444";
    expect(verifyLeadSignature(leadId, undefined)).toBe(false);
    expect(verifyLeadSignature(leadId, null)).toBe(false);
    expect(verifyLeadSignature(leadId, "")).toBe(false);
    expect(() => verifyLeadSignature(leadId, "not-hex-!!!")).not.toThrow();
    expect(verifyLeadSignature(leadId, "not-hex-!!!")).toBe(false);
  });

  it("round-trips correctly through a lead_id containing no unusual characters, including via a URL-encode/decode cycle", () => {
    const leadId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const sig = signLeadId(leadId);
    const roundTrippedLeadId = decodeURIComponent(encodeURIComponent(leadId));
    const roundTrippedSig = decodeURIComponent(encodeURIComponent(sig));
    expect(roundTrippedLeadId).toBe(leadId);
    expect(verifyLeadSignature(roundTrippedLeadId, roundTrippedSig)).toBe(true);
  });
});
