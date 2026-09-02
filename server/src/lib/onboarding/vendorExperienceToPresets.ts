/**
 * Maps Lead.vendorExperience (a single free-text field, e.g.
 * "Deluxe, SDI, some indie clients" -- confirmed comma-delimited, matching
 * the same convention already used to parse this field in
 * drafting/draftGenerator.ts) into the exact preset strings G3's form
 * expects for `vendor_experience`.
 *
 * Per the confirmed contract, anything outside the preset list still goes
 * into their "other" slot rather than being dropped -- so this never
 * discards a token, it only normalizes casing/spacing for the ones that
 * match a known preset and passes everything else through as-is.
 *
 * KNOWN LIMITATION: because the source field is unescaped, comma-delimited
 * free text, a vendor name that itself legitimately contains a comma
 * (e.g. "Smith, Inc.") is indistinguishable from two separate entries --
 * that ambiguity already exists in the raw data before it ever reaches
 * this function (same limitation as the existing comma-split in
 * drafting/draftGenerator.ts). What this function DOES guarantee is that
 * once it has produced its list of tokens, buildApplyUrl encodes each one
 * individually before joining them for output, so no token's own content
 * (a "&", a space, etc.) can corrupt the outer query string or be
 * mistaken for the "," list separator on the way back out.
 */
export const VENDOR_PRESETS = [
  "Deluxe",
  "SDI",
  "Pixel Logic",
  "Zoo Digital",
  "VSI",
  "Plint",
  "BTI",
  "DeepDub",
  "Ooona",
] as const;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const PRESET_BY_NORMALIZED_KEY = new Map<string, string>(VENDOR_PRESETS.map((preset) => [normalize(preset), preset]));

/**
 * Returns the list of vendor/client-experience values to send, each either
 * the exact preset string (case/spacing corrected) or the original token
 * verbatim when it isn't a known preset. Returns [] when there's nothing on
 * file -- callers must omit the `vendor_experience` param entirely in that
 * case, not send an empty value.
 */
export function vendorExperienceToPresetList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => PRESET_BY_NORMALIZED_KEY.get(normalize(token)) ?? token);
}
