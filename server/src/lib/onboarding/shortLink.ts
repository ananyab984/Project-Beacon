import { config } from "../../config";

/**
 * A "URL shortener" that needs no database table: the full apply URL is
 * entirely reconstructible from lead.id alone (buildApplyUrl(lead) is a
 * pure function of the lead's current data), so the "short code" is just a
 * compact, reversible encoding of that same UUID -- 22 base64url
 * characters instead of the 36-character hyphenated string, and it never
 * appears in a message alongside the candidate's own name/email the way
 * the full pre-filled apply link would.
 *
 * The redirect route (onboardingShortLink.routes.ts) decodes this back to
 * a lead id, re-fetches the lead fresh, and rebuilds the full apply URL on
 * the spot -- which also means the link a candidate actually clicks always
 * reflects the lead's CURRENT data, never a stale snapshot from whenever
 * the outreach message was drafted.
 *
 * Security model: lead.id is already a Prisma-generated UUIDv4 (122 bits
 * of randomness) -- a reversible compact encoding of it is exactly as hard
 * to guess as the id itself, and this endpoint is read-only (a redirect,
 * never a state change), so no additional signature is needed here (unlike
 * callbackToken.ts's per-lead HMAC, which protects a STATE-CHANGING
 * endpoint).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function encodeLeadIdToken(leadId: string): string {
  if (!UUID_PATTERN.test(leadId)) {
    throw new Error(`encodeLeadIdToken: "${leadId}" is not a UUID`);
  }
  const hex = leadId.replace(/-/g, "");
  return Buffer.from(hex, "hex").toString("base64url");
}

/** Never throws -- a malformed or tampered token just fails to decode. */
export function decodeShortLinkToken(token: string | null | undefined): string | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const buf = Buffer.from(token, "base64url");
  if (buf.length !== 16) return null;
  const hex = buf.toString("hex");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_PATTERN.test(uuid) ? uuid : null;
}

/** The short link to embed in an outreach message in place of the old
 * static, unpersonalized apply_url -- e.g. "{appBaseUrl}/g/{token}". */
export function buildShortApplyUrl(leadId: string): string {
  return `${config.appBaseUrl}/g/${encodeLeadIdToken(leadId)}`;
}
