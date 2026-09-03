import type { Lead } from "@prisma/client";

/**
 * How many of the 15 canonical enrichment fields are currently non-empty on
 * this lead -- computed fresh on every read, never stored, so a manual edit
 * (or a re-enrichment run) is reflected immediately with no separate
 * recompute step. Every field counts, no exclusions -- including `fullName`
 * (always set at creation, so every lead starts at n>=1; intentional, not a
 * bug) and `email`/`contactNumber` (a low count, including one from only
 * these two, is a normal "Enriched (n)" outcome now, not a failure signal).
 */
export function countPopulatedFields(lead: Pick<Lead,
  | "fullName" | "email" | "contactNumber" | "country" | "profileLink"
  | "sourceLanguage" | "targetLanguage" | "services" | "yearsOfExperience"
  | "vendorExperience" | "headline" | "currentTitle" | "aboutSnippet"
  | "toolsSoftware" | "certifications"
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
    lead.profileLink,
    lead.sourceLanguage,
    lead.targetLanguage,
    lead.services,
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
