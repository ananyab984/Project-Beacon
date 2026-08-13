// Single source of truth for input normalization used across the auth flow.
// Deliberately narrow in scope -- see the audit plan for why Gmail dot/plus
// canonicalization and phone normalization are NOT here: Gmail aliasing only
// ever covers one provider and duplicates a job the identity-resolution
// pipeline already does more generally; phone isn't collected at signup today.

// Zero-width space, zero-width non-joiner/joiner, BOM/zero-width no-break space,
// and non-breaking space -- written as explicit escapes, not literal invisible
// characters, so this is actually reviewable.
const ZERO_WIDTH_AND_INVISIBLE = /[​-‍﻿ ]/g;

/** NFC-normalize, strip invisible/zero-width characters, trim, lowercase. */
export function normalizeEmail(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(ZERO_WIDTH_AND_INVISIBLE, "")
    .trim()
    .toLowerCase();
}

const EMAIL_MAX_LENGTH = 254;
// Pragmatic check, not a "complete" RFC-5322 pattern -- those tend to carry
// their own bugs. Good enough to reject obvious garbage.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmailFormat(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_SHAPE.test(email);
}

const NAME_MAX_LENGTH = 80;

/** NFC-normalize, strip invisible characters, trim, collapse internal whitespace, cap length. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(ZERO_WIDTH_AND_INVISIBLE, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, NAME_MAX_LENGTH);
}

export function validateNameLength(name: string): boolean {
  return name.length > 0 && name.length <= NAME_MAX_LENGTH;
}
