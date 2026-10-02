import { config } from "../../config";

/**
 * The compact token in an outreach short link ({shortLinkBaseUrl}/g/{token}).
 *
 * No table backs this. buildApplyUrl(lead) is a pure function of the lead's
 * current row, so the whole pre-filled URL is reconstructible from the lead's
 * identity alone -- the token only has to IDENTIFY a lead, not carry anything.
 *
 * It is the first 6 bytes of the lead's UUID, base64url-encoded: 8 characters,
 * resolved by prefix match against Lead.id. 48 bits of a UUIDv4's randomness,
 * which at this project's scale makes a collision ~1e-11 (and ~0.2% even at a
 * million leads) -- and the route DETECTS a collision rather than guessing,
 * so the failure mode is a 404, never the wrong candidate's data.
 *
 * Encoding the whole 16-byte UUID would be exact, but it costs 22 characters
 * against a 200-character LinkedIn note where the host already takes 39.
 *
 * Security: 48 random bits is not guessable by brute force against a
 * rate-limited endpoint, and this route is read-only -- it redirects, never
 * changes state.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 8 = current short form (6-byte prefix). 22 = the original full-UUID form,
 *  still accepted so links already sitting in a candidate's inbox keep
 *  working -- those messages are already out and cannot be reissued. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8}$|^[A-Za-z0-9_-]{22}$/;

const PREFIX_BYTES = 6;

export function encodeLeadIdToken(leadId: string): string {
  if (!UUID_PATTERN.test(leadId)) {
    throw new Error(`encodeLeadIdToken: "${leadId}" is not a UUID`);
  }
  const hex = leadId.replace(/-/g, "").slice(0, PREFIX_BYTES * 2);
  return Buffer.from(hex, "hex").toString("base64url");
}

/** Formats raw UUID hex back into the dashed form Lead.id is stored as, so a
 *  partial decode is still a valid `startsWith` prefix. */
function hexToUuidPrefix(hex: string): string {
  const parts = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)];
  return parts.filter(Boolean).join("-");
}

/**
 * Decodes a token to a Lead.id PREFIX to match with `startsWith`. Never
 * throws -- a malformed or tampered token just fails to decode.
 *
 * A legacy 22-character token decodes to a complete UUID, which as a prefix
 * matches exactly that one lead, so both forms take the same lookup path.
 */
export function decodeShortLinkToken(token: string | null | undefined): string | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const buf = Buffer.from(token, "base64url");
  if (buf.length !== PREFIX_BYTES && buf.length !== 16) return null;

  const hex = buf.toString("hex");
  if (!/^[0-9a-f]+$/.test(hex)) return null;

  const prefix = hexToUuidPrefix(hex);
  // A full-length decode must be a well-formed UUID; a short one is a prefix
  // of one, so it only has to contain the characters a UUID is made of.
  if (buf.length === 16) return UUID_PATTERN.test(prefix) ? prefix : null;
  return /^[0-9a-f-]+$/.test(prefix) ? prefix : null;
}

/** The short link embedded in an outreach message. */
export function buildShortApplyUrl(leadId: string): string {
  return `${config.shortLinkBaseUrl}/g/${encodeLeadIdToken(leadId)}`;
}

/**
 * Every short link is the same length, so promptBuilder can budget a LinkedIn
 * note's characters without a specific lead in hand. Derived from a real
 * encode rather than a hardcoded constant, so it cannot drift from the
 * token's actual size.
 */
export function shortApplyUrlLength(): number {
  return `${config.shortLinkBaseUrl}/g/`.length + encodeLeadIdToken("00000000-0000-4000-8000-000000000000").length;
}
