import type { Lead } from "@prisma/client";
import { mergeProfileSections, type ProfileSections } from "./profileSections";

/**
 * The 10 fields the enrichment-details dialog shows, each paired with its
 * canonical `fieldSources` key (the Python-pipeline naming -- must match
 * MANUAL_FIELD_SOURCE_KEYS and orchestrator.py exactly).
 *
 * This list IS the denominator of the "Enriched (n)" counter: the recruiter
 * sees these 10 rows in the dialog, so the number next to the status has to
 * be counted from the same 10 and nothing else.
 */
export const ENRICHMENT_COUNT_FIELDS = [
  ["email", "Email_Address"],
  ["contactNumber", "Contact_Number"],
  ["country", "Country_of_Residence"],
  ["profileLink", "Profile_Link"],
  ["sourceLanguage", "Source_Language"],
  ["targetLanguage", "Target_Language"],
  ["services", "Services"],
  ["headline", "Headline"],
  ["currentTitle", "Current_Title"],
  ["aboutSnippet", "About_Snippet"],
] as const satisfies ReadonlyArray<readonly [keyof Lead, string]>;

export const ENRICHMENT_COUNT_TOTAL = ENRICHMENT_COUNT_FIELDS.length; // 10

/** Sources that mean "this value was NOT produced by enrichment" -- i.e. the
 *  field arrived already populated on the input row (orchestrator.py tags
 *  every pre-populated field "existing" before any provider runs). A field
 *  with no `fieldSources` entry at all is in the same boat: nothing ever
 *  claimed to have found it, so it came in with the lead. */
const NOT_ENRICHED_SOURCES = new Set(["existing"]);

type CountableLead = Pick<Lead,
  | "email" | "contactNumber" | "country" | "profileLink"
  | "sourceLanguage" | "targetLanguage" | "services"
  | "headline" | "currentTitle" | "aboutSnippet" | "fieldSources"
>;

/**
 * How many of the 10 dialog fields enrichment (or a recruiter's manual
 * stand-in for it) actually FOUND for this lead -- computed fresh on every
 * read, never stored, so a manual edit or a re-enrichment run is reflected
 * immediately with no separate recompute step.
 *
 * Two things are deliberately excluded:
 *  - fields outside the dialog's 10 (yearsOfExperience, vendorExperience,
 *    toolsSoftware, certifications, fullName) -- the recruiter can't see
 *    them in the dialog, so counting them makes the number unverifiable;
 *  - anything the lead was IMPORTED with. profileLink/sourceLanguage/
 *    targetLanguage/services are set at lead creation on nearly every row
 *    (a CSV/sheet import even defaults the two languages to "English" --
 *    see mapSheetRowsToLeads), so counting them showed "Enriched (6-8)" for
 *    a lead the waterfall found *nothing* for. Provenance, not mere
 *    non-emptiness, is what makes a field count.
 */
export function countPopulatedFields(lead: CountableLead): number {
  const sources = (lead.fieldSources as Record<string, string> | null) ?? {};

  const isNonEmpty = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true; // numbers (Decimal), etc.
  };

  return ENRICHMENT_COUNT_FIELDS.filter(([field, sourceKey]) => {
    if (!isNonEmpty((lead as any)[field])) return false;
    const source = sources[sourceKey];
    return !!source && !NOT_ENRICHED_SOURCES.has(source);
  }).length;
}

/** Convenience wrapper for a single API response site: spreads the lead and
 *  adds `enrichedFieldCount`, computed fresh from whatever was just read.
 *
 *  Also attaches `profileSections` (see lib/profileSections.ts). Both live
 *  here because this function is the ONE chokepoint every lead response goes
 *  through -- 11 call sites across lead.routes.ts -- so a derived field added
 *  here reaches the whole API at once, and cannot be forgotten on a route.
 *  Deriving rather than storing is deliberate for the same reason the count
 *  is derived: no migration, and a re-enrichment shows up immediately. */
export function withEnrichedFieldCount<T extends CountableLead & { rawScrapeData?: unknown; parallelData?: unknown }>(
  lead: T
): T & { enrichedFieldCount: number; profileSections: ProfileSections } {
  return {
    ...lead,
    enrichedFieldCount: countPopulatedFields(lead),
    profileSections: mergeProfileSections(lead),
  };
}
