export type OnHoldReason = "MANUAL" | "TIMEOUT" | "SYSTEM_ERROR";

export interface OnHoldTransitionInput {
  currentFlags: string[];
  currentOnHoldReason: OnHoldReason | null;
  /** Still legitimately in-flight (Clay's async webhook still pending) --
   *  leaves flags/onHoldReason completely untouched. Not a conclusion at
   *  all, distinct from every other case below. */
  stillInFlight?: boolean;
  /** What this pass concluded as. Required unless stillInFlight is true.
   *  "concluded_normally" covers both short_circuit_success and
   *  exhausted_no_match -- both are a normal, concluded run that must never
   *  set On Hold based on field count/data quality. */
  outcome?: "concluded_normally" | "timed_out" | "system_error";
}

export interface OnHoldTransitionResult {
  flags: string[];
  onHoldReason: OnHoldReason | null;
}

/**
 * Single source of truth for how every enrichment-conclusion call site
 * (enrichLeadById's success + catch paths, ClayService's two webhook
 * branches, stallOverdueEnrichments) transitions ON_HOLD/onHoldReason.
 *
 * A MANUAL hold is never auto-cleared or auto-downgraded by any of these --
 * only the recruiter's own explicit toggle (POST/DELETE /:id/flags) can.
 * On Hold is never set based on field count/data quality -- only a genuine
 * timeout, a system error, or the manual toggle (handled separately, in the
 * flags route itself) ever produce it.
 */
export function computeOnHoldTransition(input: OnHoldTransitionInput): OnHoldTransitionResult {
  const { currentFlags, currentOnHoldReason, stillInFlight, outcome } = input;

  if (stillInFlight) {
    return { flags: currentFlags, onHoldReason: currentOnHoldReason };
  }

  const wasManualHold = currentOnHoldReason === "MANUAL";
  if (wasManualHold) {
    // A background run -- successful, timed out, or errored -- must never
    // silently take a manually-held lead off hold, or downgrade why it's
    // held. Only the recruiter's own toggle does that.
    return { flags: currentFlags, onHoldReason: "MANUAL" };
  }

  if (outcome === "timed_out") {
    return { flags: Array.from(new Set([...currentFlags, "ON_HOLD"])), onHoldReason: "TIMEOUT" };
  }
  if (outcome === "system_error") {
    return { flags: Array.from(new Set([...currentFlags, "ON_HOLD"])), onHoldReason: "SYSTEM_ERROR" };
  }
  // concluded_normally: auto-clears a prior TIMEOUT/SYSTEM_ERROR hold (this
  // run completing cleanly is exactly how those two reasons recover).
  return { flags: currentFlags.filter((f) => f !== "ON_HOLD"), onHoldReason: null };
}
