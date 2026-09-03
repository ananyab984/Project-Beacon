/**
 * Maps a Node/Prisma camelCase Lead field name to its canonical
 * (Python-pipeline-style) key in `fieldSources` -- must match
 * enrichLeadById's own key names exactly, since that's the source of truth
 * for which fields a re-enrichment run is allowed to overwrite.
 *
 * Shared by every path that can write a manually-editable field so a value
 * tagged fieldSources[key] = "manual" is protected consistently everywhere,
 * not just in the one write path it was first noticed in -- PATCH /:id
 * (the two enrichment dialogs) and Clay's async webhook (clay.service.ts)
 * both touch overlapping fields.
 */
export const MANUAL_FIELD_SOURCE_KEYS: Record<string, string> = {
  displayName: "Full_Name",
  email: "Email_Address",
  contactNumber: "Contact_Number",
  country: "Country_of_Residence",
  sourceLanguage: "Source_Language",
  targetLanguage: "Target_Language",
  services: "Services",
  yearsOfExperience: "Years_of_Exp",
  vendorExperience: "Vendor_Experience",
  headline: "Headline",
  currentTitle: "Current_Title",
  aboutSnippet: "About_Snippet",
  toolsSoftware: "Tools_Software",
  certifications: "Certifications",
};

export function isFieldManuallySet(fieldSources: Record<string, string> | null | undefined, nodeKey: string): boolean {
  const canonicalKey = MANUAL_FIELD_SOURCE_KEYS[nodeKey];
  if (!canonicalKey || !fieldSources) return false;
  return fieldSources[canonicalKey] === "manual";
}
