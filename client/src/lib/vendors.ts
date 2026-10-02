/**
 * Single canonical Vendor Experience list -- the multi-select options a
 * recruiter can pick, and the closed set enrichment's Vendor_Experience
 * extraction matches against (see enrichment_pipeline/parsers/
 * vendor_aliases.py and server/src/lib/normalizeVendorExperience.ts). Mirrors
 * services.ts's role for the Services field.
 */
export const STANDARD_VENDORS = ["BTI", "Deluxe", "DeepDub", "Ooona", "Pixel Logic", "Plint", "SDI", "VSI", "Zoo Digital"];
