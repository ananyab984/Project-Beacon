/**
 * Maps Lead.vendorExperience into the exact preset strings G3's apply form
 * expects for `vendor_experience`.
 *
 * Per the confirmed contract, anything outside the preset list still goes
 * into their "other" slot rather than being dropped -- so this never
 * discards a token, it only normalizes casing/spacing for the ones that
 * match a known preset and passes everything else through as-is.
 *
 * Takes String[] because that is what the column is (schema.prisma:
 * `vendorExperience String[]`, canonical vendor names, same multi-value
 * shape as services/toolsSoftware). A single comma-delimited string is also
 * accepted and split, because older rows and free-text imports still carry
 * that shape; in that one case a vendor name legitimately containing a
 * comma ("Smith, Inc.") is indistinguishable from two entries, an ambiguity
 * inherent to the raw value rather than something this function can resolve.
 * Array input has no such problem -- each element is already one vendor.
 *
 * Either way, once this has produced its list, buildApplyUrl encodes each
 * token individually before joining them, so no token's own content (a "&",
 * a space, a comma) can corrupt the outer query string or be mistaken for
 * the "," list separator on the way back out.
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
export function vendorExperienceToPresetList(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  const tokens = Array.isArray(raw) ? raw : raw.split(",");
  return tokens
    .map((token) => (token ?? "").trim())
    .filter(Boolean)
    .map((token) => PRESET_BY_NORMALIZED_KEY.get(normalize(token)) ?? token);
}
