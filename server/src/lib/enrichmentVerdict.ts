/**
 * Turns one enrichment-pipeline response into the two SEPARATE verdicts the
 * rest of enrichLeadById acts on.
 *
 * These were a single `isComplete = conclusion !== "timed_out"` flag driving
 * every consequence at once, which meant any lead that did not time out was
 * stamped `identityResolved` + `promotedToGlobalAt` and pushed into the
 * global recruiter pool no matter how little the waterfall actually found.
 * Measured 2026-10-01: a real 20-lead batch concluded `exhausted_no_match` on
 * all 20 while the pipeline itself reported 17 of them `enrichment_partial`
 * (67-94% of fields, no contact details), and the live table read 139/139
 * COMPLETE. "COMPLETE" meant "did not time out", never "is enriched".
 *
 * Pure function over the response's two fields -- same shape and reasoning as
 * onHoldTransition.ts, and for the same reason: this decision is small,
 * load-bearing, and regressed silently once already, so it is worth being
 * testable without a database.
 */

export interface EnrichmentVerdictInput {
  /** `PipelineResult.conclusion` from orchestrator.py. */
  conclusion: string | null | undefined;
  /** `PipelineResult.enrichment_status` from orchestrator.py. */
  enrichmentStatus: string | null | undefined;
  /**
   * `PipelineResult.identity_match.verdict` from orchestrator.py -- whether
   * the person the scrapers returned is the person we went looking for.
   * Absent on a response from a service old enough not to send it, which is
   * treated as "no claim made" rather than as a problem.
   */
  identityVerdict?: string | null | undefined;
  /** Lead.source. Only LINKEDIN is held to the Parallel bar below. */
  source?: string | null | undefined;
  /**
   * `field_sources._parallel_fallback` as the pipeline returned it:
   * "complete", "failed_transient:<n>", "escalate_pro" (two core attempts made
   * no progress, one "pro" attempt owed), "failed_pro", "failed_permanent", or
   * absent (Parallel never ran -- no profile link, or PARALLEL_API_KEY unset).
   */
  parallelState?: string | null | undefined;
}

export interface EnrichmentVerdict {
  /**
   * The pipeline resolved every one of core/schema.py's CRITICAL_FIELDS
   * (Email_Address, Contact_Number, Years_of_Exp). Gates the recruiter-facing
   * consequences: the global pool, and the contractor's "fully filled in"
   * notification.
   */
  fullyEnriched: boolean;
  /**
   * True when `enrichmentStatus` was neither of the pipeline's two documented
   * values, so `fullyEnriched` was decided defensively rather than read. The
   * caller logs this; it is never silently swallowed.
   */
  unrecognizedStatus: boolean;
  /**
   * The resolved identity did not match the submitted one well enough to act
   * on unreviewed -- either an initial expanded ("Danny M" -> "Danny
   * Miller") or the names diverge outright. A human adjudicates; nothing is
   * auto-corrected, because both causes can be either right or wrong.
   */
  identityFlagged: boolean;
  /**
   * What to store in Lead.enrichmentStatus. FLAGGED_REVIEW is terminal like
   * COMPLETE -- pollPendingEnrichment claims only PENDING, so a flagged lead
   * is not re-run on a loop -- and the schema already reserves it for exactly
   * this ("ambiguous identities (Danny M)").
   */
  leadStatus: "COMPLETE" | "PENDING" | "FLAGGED_REVIEW";
  /**
   * A LinkedIn lead whose Parallel result never came back complete, with no
   * Parallel attempt left. The caller puts it On Hold (INCOMPLETE_PROFILE) so
   * it never shows as Enriched: for LinkedIn, Parallel is the source of the
   * profile, and a run that got only, say, Country from it is not enriched
   * however cleanly it concluded (the Christopher Boyce case).
   */
  incompleteProfile: boolean;
}

const COMPLETE = "enrichment_complete";
const PARTIAL = "enrichment_partial";
/** Mirrors orchestrator.py's MAX_PARALLEL_TRANSIENT_ATTEMPTS. */
const MAX_PARALLEL_ATTEMPTS = 2;
const TRANSIENT_PREFIX = "failed_transient:";
/** orchestrator.py's PARALLEL_STATE_ESCALATE_PRO: one "pro" attempt is owed. */
const ESCALATE_PRO = "escalate_pro";

export function computeEnrichmentVerdict(input: EnrichmentVerdictInput): EnrichmentVerdict {
  const { conclusion, enrichmentStatus, identityVerdict, source, parallelState } = input;

  const concluded = conclusion !== "timed_out";

  // An unreadable status resolves to NOT fully enriched, matching
  // enrichment.job.ts's CONCLUSION_MAP default (unknown -> SYSTEM_ERROR): a
  // response we cannot interpret is an anomaly, and the safe reading of an
  // anomaly is "do not promote this lead to every recruiter".
  const unrecognizedStatus = enrichmentStatus !== COMPLETE && enrichmentStatus !== PARTIAL;
  const fullyEnriched = enrichmentStatus === COMPLETE;

  // A timed-out run is never "fully enriched" regardless of what status rode
  // along with it -- orchestrator.py's own _timed_out_result() already
  // reports `enrichment_partial`, but this does not depend on that staying
  // true, since the two fields are produced independently.
  // "unknown" is NOT a flag: it means there was no name on one side to
  // compare, so no claim was made either way. Sending a human to adjudicate a
  // comparison that never happened is noise, and the lead's thinness is
  // already reported by enrichment_status. Likewise an absent verdict, from a
  // service predating this field.
  const identityFlagged = identityVerdict === "ambiguous" || identityVerdict === "divergent";

  // LinkedIn is not enriched until Parallel returned the complete profile.
  // While an attempt is left, the lead goes back to PENDING so
  // pollPendingEnrichment makes it -- the orchestrator has always recorded
  // "will retry on a later pass", but nothing ever re-claimed a COMPLETE lead,
  // so that retry never happened. An unparseable counter reads as exhausted
  // (NaN < 2 is false), matching orchestrator.py's _parallel_attempts.
  const parallelIncomplete = source === "LINKEDIN" && parallelState !== "complete";
  // "escalate_pro" is the one further attempt the orchestrator grants when two
  // core attempts ended at the same low enrichment count -- it needs the poll
  // job just like a transient retry does. "failed_pro" is settled.
  const retryParallel =
    concluded &&
    parallelIncomplete &&
    (parallelState === ESCALATE_PRO ||
      (!!parallelState?.startsWith(TRANSIENT_PREFIX) &&
        Number(parallelState.slice(TRANSIENT_PREFIX.length)) < MAX_PARALLEL_ATTEMPTS));

  const leadStatus: EnrichmentVerdict["leadStatus"] = !concluded || retryParallel
    ? "PENDING"
    : identityFlagged
      ? "FLAGGED_REVIEW"
      : "COMPLETE";

  return {
    // A flagged identity cannot be "fully enriched" however many fields came
    // back: the fields may well describe somebody else.
    fullyEnriched: fullyEnriched && concluded && !identityFlagged && !parallelIncomplete,
    unrecognizedStatus,
    identityFlagged,
    leadStatus,
    incompleteProfile: concluded && parallelIncomplete && !retryParallel,
  };
}

/**
 * The same "is this lead actually enriched?" bar as `fullyEnriched` above,
 * but applied to a MANUAL edit instead of a pipeline response -- i.e. "has a
 * recruiter now filled in everything that matters?".
 *
 * Exists because PATCH /api/leads/:id is the other way a lead can reach
 * `identityResolved`, and that path used to set it as a side effect of any
 * edit at all (its condition counted a bare profileLink, and an
 * enrichmentStatus of COMPLETE which now only means the waterfall concluded).
 *
 * The null/undefined distinction is the fiddly part and the reason this is
 * worth testing: in that route's patch schema an explicit `null` is a
 * deliberate "clear this field" and must NOT fall back to the stored value,
 * while an absent key means "leave it alone" and must.
 */
export function patchResolvesIdentity(
  patch: {
    email?: string | null;
    contactNumber?: string | null;
    yearsOfExperience?: number | null;
  },
  existing: {
    email?: string | null;
    contactNumber?: string | null;
    yearsOfExperience?: unknown;
  }
): boolean {
  const email = patch.email === null ? null : (patch.email ?? existing.email);
  const contactNumber = patch.contactNumber === null ? null : (patch.contactNumber ?? existing.contactNumber);
  const yearsOfExperience =
    patch.yearsOfExperience === null ? null : (patch.yearsOfExperience ?? existing.yearsOfExperience);
  return !!email && !!contactNumber && yearsOfExperience !== null && yearsOfExperience !== undefined;
}
