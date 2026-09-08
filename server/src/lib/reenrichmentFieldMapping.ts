import { MANUAL_FIELD_SOURCE_KEYS, isFieldManuallySet } from "./manualFieldSources";

/**
 * The Autumn.ai <-> Lead field mapping for recruiter-triggered re-enrichment,
 * kept pure (no network, no Prisma) so the rule that actually matters -- a
 * manually-entered value is never overwritten -- is testable on its own.
 *
 * Only fields with a confident 1:1 correspondence are mapped onto Lead
 * columns. Autumn's schema is flat by design (str/list[str], no nested
 * objects), so `current_company`, `experience`, `platform_badges`,
 * `languages` and `profile_sections_detected` have no column whose SHAPE
 * they match -- `languages` in particular comes back as one-liners like
 * "German (native)", not the single-value sourceLanguage/targetLanguage this
 * schema uses. Those are preserved verbatim in Lead.autumnData instead of
 * being force-fit into the wrong column.
 */
export const AUTUMN_TO_LEAD_FIELDS: Record<string, string> = {
  name: "displayName",
  headline: "headline",
  current_title: "currentTitle",
  about: "aboutSnippet",
  qualifications: "certifications",
  location: "country",
};

/** Node keys above whose Lead column is String[] rather than String. */
const LIST_LEAD_FIELDS = new Set(["certifications"]);

/** The flat output schema requested from Autumn (`kind: "research"`).
 *  `entity_url` is asked for explicitly as a pass-through so a returned row
 *  can be matched back to the lead it was requested for -- Autumn's docs
 *  don't confirm input columns are echoed onto output rows. */
export const AUTUMN_OUTPUT_SCHEMA: Record<string, { type: string }> = {
  entity_url: { type: "url" },
  name: { type: "str" },
  headline: { type: "str" },
  current_title: { type: "str" },
  current_company: { type: "str" },
  location: { type: "str" },
  about: { type: "str" },
  experience: { type: "list[str]" },
  qualifications: { type: "list[str]" },
  platform_badges: { type: "list[str]" },
  languages: { type: "list[str]" },
};

/** A populated field where Autumn disagrees with what the lead already has.
 *  Never applied automatically -- the recruiter picks a side. */
export interface FieldConflict {
  field: string;
  current: string | string[];
  proposed: string | string[];
}

export interface AutumnMappingResult {
  /** Prisma-shaped partial update -- only fields Autumn actually resolved. */
  updates: Record<string, unknown>;
  /** fieldSources to persist, with every written key tagged "autumn". */
  fieldSources: Record<string, string>;
  /** Lead fields this run wrote, for the "Updated N fields" success state. */
  writtenFields: string[];
  /** Fields left alone because the lead already had a value (the gap-fill
   *  rule). Autumn's reading of them is still in autumnData. */
  skippedPopulated: string[];
  /** The subset of skippedPopulated where Autumn's value actually differs,
   *  offered to the recruiter to accept or reject. */
  conflicts: FieldConflict[];
  /** Fields Autumn returned a value for that were left alone because the
   *  recruiter had entered them by hand. Surfaced so the run is auditable
   *  rather than silently dropping data. */
  skippedManual: string[];
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Autumn's `location` is a full locality ("Le Rheu, Brittany, France"), but
 * the column it feeds is `country` and the leads dashboard facets on it --
 * writing the locality verbatim put a bucket of one next to the real
 * "France" (seen live 2026-09-08 on two of three test leads). The country is
 * the last comma-separated segment.
 */
function countryFromLocation(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  return cleanString(raw.split(",").pop());
}


/** Matches is_empty_value in orchestrator.py: null/undefined, blank string,
 *  or empty list all mean "this field is still a gap". */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function cleanStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(cleanString).filter((v): v is string => v !== null);
  return items.length ? items : null;
}

/**
 * Turns one flattened Autumn output row into a Lead update.
 *
 * Two guarantees this exists to hold:
 *  - a field tagged fieldSources[key] = "manual" is never written, whatever
 *    Autumn returned for it (checked via the shared isFieldManuallySet, the
 *    same rule PATCH /leads/:id and the waterfall both honour);
 *  - a field Autumn found nothing for is never written either -- an empty
 *    string or empty list leaves the lead's prior value untouched rather
 *    than nulling it out.
 *
 * No re-assertion pass over existing "manual" tags is needed here (unlike
 * enrichLeadById, which merges a fieldSources map the Python pipeline built
 * without any notion of "manual"): this starts from the lead's own existing
 * map and only ever writes keys for fields it just wrote, which by the first
 * guarantee above are never the manual ones.
 */
export function mapAutumnOutputToLeadFields(
  output: Record<string, unknown>,
  existingFieldSources: Record<string, string> | null | undefined,
  /** The lead's current values, for the degradation guards below. */
  existingValues: Record<string, unknown> = {}
): AutumnMappingResult {
  const fieldSources: Record<string, string> = { ...(existingFieldSources ?? {}) };
  const updates: Record<string, unknown> = {};
  const writtenFields: string[] = [];
  const skippedManual: string[] = [];
  const skippedPopulated: string[] = [];
  const conflicts: FieldConflict[] = [];

  for (const [autumnKey, nodeKey] of Object.entries(AUTUMN_TO_LEAD_FIELDS)) {
    const value = LIST_LEAD_FIELDS.has(nodeKey)
      ? cleanStringList(output[autumnKey])
      : nodeKey === "country"
      ? countryFromLocation(output[autumnKey])
      : cleanString(output[autumnKey]);
    if (value === null) continue;

    if (isFieldManuallySet(existingFieldSources, nodeKey)) {
      skippedManual.push(nodeKey);
      continue;
    }

    // The house rule, matching orchestrator.py's _apply_parsed_fields: a
    // stage that resolves canonical fields FILLS GAPS, it does not overwrite
    // what's already there. This path was the only thing in the system
    // ignoring it, and the 2026-09-08 live pass showed exactly what that
    // costs -- Autumn's thinner reading of a LinkedIn profile replaced a
    // richer existing headline, truncated a job title, and flattened an
    // accented name.
    //
    // Gap-filling alone would leave a genuinely STALE value stuck, though
    // (a title that really did change never refreshes), so a populated field
    // whose value actually differs becomes a conflict for the recruiter to
    // decide -- nothing is overwritten without them picking it.
    if (!isEmptyValue(existingValues[nodeKey])) {
      skippedPopulated.push(nodeKey);
      const current = existingValues[nodeKey];
      if (JSON.stringify(current ?? null) !== JSON.stringify(value)) {
        conflicts.push({ field: nodeKey, current: current as string | string[], proposed: value });
      }
      continue;
    }


    updates[nodeKey] = value;
    writtenFields.push(nodeKey);
    fieldSources[MANUAL_FIELD_SOURCE_KEYS[nodeKey]] = "autumn";
  }

  return { updates, fieldSources, writtenFields, skippedManual, skippedPopulated, conflicts };
}

/**
 * Applies the recruiter's conflict decisions. Re-checks manual protection
 * against the lead's CURRENT fieldSources rather than trusting the choice
 * list, because the run may have been sitting unresolved while the recruiter
 * edited the same field by hand.
 */
export function applyConflictChoices(
  conflicts: FieldConflict[],
  chosenFields: string[],
  existingFieldSources: Record<string, string> | null | undefined
): { updates: Record<string, unknown>; fieldSources: Record<string, string>; writtenFields: string[] } {
  const fieldSources: Record<string, string> = { ...(existingFieldSources ?? {}) };
  const updates: Record<string, unknown> = {};
  const writtenFields: string[] = [];

  for (const conflict of conflicts) {
    if (!chosenFields.includes(conflict.field)) continue;
    if (!(conflict.field in MANUAL_FIELD_SOURCE_KEYS)) continue; // not a field we map
    if (isFieldManuallySet(existingFieldSources, conflict.field)) continue;
    updates[conflict.field] = conflict.proposed;
    writtenFields.push(conflict.field);
    fieldSources[MANUAL_FIELD_SOURCE_KEYS[conflict.field]] = "autumn";
  }

  return { updates, fieldSources, writtenFields };
}
