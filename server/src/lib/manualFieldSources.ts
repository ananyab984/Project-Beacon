/**
 * Maps a Node/Prisma camelCase Lead field name to its canonical
 * (Python-pipeline-style) key in `fieldSources` -- must match
 * enrichLeadById's own key names exactly, since that's the source of truth
 * for which fields a re-enrichment run is allowed to overwrite.
 *
 * Shared by every path that can write a manually-editable field so a value
 * tagged fieldSources[key] = "manual" is protected consistently everywhere,
 * not just in the one write path it was first noticed in -- PATCH /:id
 * (the two enrichment dialogs) and enrichLeadById's Parallel-derived fields
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

/**
 * Recomputes `fieldSources` for a PATCH /leads/:id, tagging as "manual" only
 * the fields the caller actually CHANGED.
 *
 * Both enrichment dialogs POST every field they render, changed or not, so
 * "present in the request body" alone can't mean "the recruiter typed this".
 * Tagging an untouched value "manual" rewrote its real provenance -- usually
 * "existing", i.e. it arrived on the import row -- which flipped it into the
 * set countPopulatedFields() counts, inflating "Enriched (n)" on the first
 * save of a lead nobody had actually edited.
 *
 * @param body      the raw request body -- key PRESENCE is the "don't touch
 *                  omitted fields" signal, which the parsed patch can't carry
 *                  (JSON.stringify drops `undefined` keys entirely).
 */
export function resolveManualFieldSources(
  existing: Record<string, unknown> & { fieldSources?: unknown },
  body: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, string> {
  const next = { ...((existing.fieldSources as Record<string, string> | null) ?? {}) };

  const sameValue = (a: unknown, b: unknown): boolean =>
    Array.isArray(a) || Array.isArray(b)
      ? JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
      : String(a ?? "") === String(b ?? "");

  for (const [patchKey, canonicalKey] of Object.entries(MANUAL_FIELD_SOURCE_KEYS)) {
    if (!(patchKey in body)) continue; // key wasn't part of this request at all
    const val = patch[patchKey];
    if (sameValue(val, existing[patchKey])) continue; // untouched -- keep its real source
    if (val == null || (Array.isArray(val) && val.length === 0)) {
      // Recruiter explicitly cleared their own manual entry -- the field is
      // fair game for auto-enrichment again, not still "protected".
      delete next[canonicalKey];
    } else {
      next[canonicalKey] = "manual";
    }
  }

  return next;
}
