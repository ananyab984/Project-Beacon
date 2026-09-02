import crypto from "crypto";
import { config } from "../../config";

/**
 * Per-lead signature for the onboarding webhook callback. G3's apply form
 * calls callback_url exactly as we hand it to them -- no custom headers, no
 * signing on their side -- so unlike Unipile/Clay's header-based shared
 * secret, the entire verification signal has to live in the URL itself.
 * Signing over the specific lead_id (rather than reusing one static shared
 * secret for every lead) means a leaked or observed callback URL for one
 * lead can never be replayed against a different lead_id.
 */
export function signLeadId(leadId: string): string {
  return crypto.createHmac("sha256", config.onboardingWebhookSecret).update(leadId).digest("hex");
}

export function verifyLeadSignature(leadId: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = signLeadId(leadId);
  const expectedBuf = Buffer.from(expected, "hex");
  let givenBuf: Buffer;
  try {
    givenBuf = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  // Constant-time comparison -- a plain `===` (the existing Unipile/Clay
  // webhook precedent) is fine for comparing a whole static secret, but a
  // per-lead HMAC is exactly the kind of secret-derived value a timing
  // side-channel could matter for, so use crypto.timingSafeEqual here.
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}
