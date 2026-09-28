// Keep in sync with enrichment_pipeline/parsers/vendor_aliases.py -- same
// deliberate-duplication convention as normalizeToolsSoftware.ts /
// normalizeServices.ts.
export const STANDARD_VENDORS = ["Deluxe", "SDI", "Pixel Logic", "Zoo Digital", "VSI", "Plint", "BTI", "DeepDub", "Ooona"];

// Real variant spellings a plain case-insensitive match against
// STANDARD_VENDORS wouldn't catch.
const SYNONYMS: Record<string, string> = {
  "deluxe media": "Deluxe",
  "deluxe entertainment": "Deluxe",
  "sdi media": "SDI",
  pixelogic: "Pixel Logic",
  "zoo digital group": "Zoo Digital",
  zoodigital: "Zoo Digital",
  "voice & script international": "VSI",
  "voice and script international": "VSI",
  "plint ab": "Plint",
  "bti studios": "BTI",
  "deep dub": "DeepDub",
};

const CANONICAL_BY_LOWER = new Map(STANDARD_VENDORS.map((s) => [s.toLowerCase(), s]));

// Employment-status words, not companies -- keep in sync with
// enrichment_pipeline/parsers/vendor_aliases.py's
// NON_COMPANY_EMPLOYMENT_LABELS. Confirmed live: a lead's Vendor Experience
// held only "Freelancer" (what BrightData put in `current_company` for
// someone describing how they work) while their Experience section named 9
// real employers -- dropped here so a value already sitting in the DB from
// before this fix existed gets cleaned out the next time this runs, not
// just left alongside whatever real companies get added.
const NON_COMPANY_EMPLOYMENT_LABELS = new Set([
  "freelancer", "freelance", "freelancing",
  "self-employed", "self employed", "independent", "independent contractor",
  "various clients", "confidential", "n/a", "none",
]);

/**
 * Splits a raw vendor-experience string/array into canonical
 * STANDARD_VENDORS values wherever possible. A token that's genuinely not a
 * known vendor or synonym is kept as-is (trimmed) rather than dropped --
 * normalizes what it recognizes without ever discarding real company data.
 * A generic employment-status word (not a real company) IS dropped.
 */
export function normalizeVendorExperience(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => s.split(/[,;/|]+/))
    .map((s) => s.trim())
    .filter((s) => s && !NON_COMPANY_EMPLOYMENT_LABELS.has(s.toLowerCase()));

  const normalized = tokens.map((token) => {
    const lower = token.toLowerCase();
    return CANONICAL_BY_LOWER.get(lower) ?? SYNONYMS[lower] ?? token;
  });

  return Array.from(new Set(normalized));
}
