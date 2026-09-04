import type { Lead } from "@prisma/client";

/**
 * How many of the 11 genuinely enrichment-findable fields are currently
 * non-empty on this lead -- computed fresh on every read, never stored, so a
 * manual edit (or a re-enrichment run) is reflected immediately with no
 * separate recompute step.
 *
 * Deliberately narrower than "every field on the lead": `profileLink`,
 * `sourceLanguage`, `targetLanguage`, and `services` are excluded -- these
 * are set at lead CREATION (recruiter input, or a CSV/sheet import, which
 * even defaults sourceLanguage/targetLanguage to "English" when no value is
 * found -- see mapSheetRowsToLeads in lead.routes.ts), not discovered BY
 * enrichment. Including them made "Enriched (n)" show 6-8 for a lead the
 * waterfall found *nothing* for, since those 4 fields (plus fullName, always
 * required at creation) are populated on nearly every lead regardless of
 * enrichment outcome -- the number looked like enrichment succeeded when it
 * had completely failed. `fullName` still counts (it's the one creation-time
 * field explicitly called out as always-in-scope), but the count is now
 * dominated by fields enrichment (or manual entry standing in for it)
 * actually has to find: email/contactNumber/country/yearsOfExperience/
 * vendorExperience/headline/currentTitle/aboutSnippet/toolsSoftware/
 * certifications. A total-failure lead now shows "Enriched (1)", not (6-8).
 */
export function countPopulatedFields(lead: Pick<Lead,
  | "fullName" | "email" | "contactNumber" | "country"
  | "yearsOfExperience" | "vendorExperience" | "headline" | "currentTitle"
  | "aboutSnippet" | "toolsSoftware" | "certifications"
>): number {
  const isNonEmpty = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true; // numbers (yearsOfExperience/Decimal), etc.
  };

  const fields: unknown[] = [
    lead.fullName,
    lead.email,
    lead.contactNumber,
    lead.country,
    lead.yearsOfExperience,
    lead.vendorExperience,
    lead.headline,
    lead.currentTitle,
    lead.aboutSnippet,
    lead.toolsSoftware,
    lead.certifications,
  ];

  return fields.filter(isNonEmpty).length;
}

/** Convenience wrapper for a single API response site: spreads the lead and
 *  adds `enrichedFieldCount`, computed fresh from whatever was just read. */
export function withEnrichedFieldCount<T extends Parameters<typeof countPopulatedFields>[0]>(
  lead: T
): T & { enrichedFieldCount: number } {
  return { ...lead, enrichedFieldCount: countPopulatedFields(lead) };
}
