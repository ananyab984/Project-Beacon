import { useEffect, useState } from "react";
import type { ApiLead } from "@/lib/api-types";
import { ENRICHMENT_FIELD_TOTAL } from "@/lib/api-types";
import { RefreshCw } from "lucide-react";

/**
 * The enrichment-status cell for the leads table.
 *
 * One component because owner.leads.tsx and recruiter.leads.tsx each carried
 * their own copy of this block and had already drifted apart. It also fixes
 * the raggedness that copy produced in the column:
 *
 *  - The red "no contact info" dot rendered only for SOME rows, so it widened
 *    those cells and pushed "Enriched (7)" onto a second line while
 *    neighbouring rows stayed on one. The dot slot is now always present and
 *    just invisible when it doesn't apply, so every row has identical metrics.
 *  - Each state used a different shape: a coloured link for two of them, bare
 *    text for the others, no shared alignment. They now share one row layout,
 *    one type scale, and one label format -- `<State> (n)` wherever a count
 *    is meaningful.
 *  - `whitespace-nowrap` because the label plus count is short by design and
 *    wrapping it was never the right answer at this width.
 */

export type EnrichmentStatusKind = "on_hold" | "enriched" | "enriching" | "pending" | "needs_review";

/** Real, measured Parallel `core` durations this session, against the live
 *  API, no mocks: 233s / 247s / 256s / 263s / 486s (one outlier). There is no
 *  real per-stage progress feed to show -- the whole call is one blocking
 *  HTTP round-trip, and Python has no channel back to the client mid-call --
 *  so this is deliberately an ESTIMATE from elapsed time, not a true
 *  completion percentage. Its only job is to keep the row from reading as
 *  halted during a genuinely-normal ~4 minute wait.
 *
 *  Two segments, both capped well short of 100%: 0->TYPICAL_MS climbs to
 *  TYPICAL_CAP (covers the typical case, ~230-265s measured), then
 *  TYPICAL_MS->OUTLIER_MS climbs the rest of the way to OUTLIER_CAP (covers
 *  the measured outlier up to 486s). Past OUTLIER_MS it holds at
 *  OUTLIER_CAP indefinitely -- it must NEVER reach 100% on its own; only the
 *  server flipping enrichmentStatus to COMPLETE does that. A bar stuck at
 *  99% while genuinely still running is the exact "looks halted" failure
 *  this exists to avoid, just moved to a different number. */
const TYPICAL_MS = 4 * 60_000;
const TYPICAL_CAP = 85;
const OUTLIER_MS = 8 * 60_000;
const OUTLIER_CAP = 95;

/** Elapsed-time estimate of enrichment progress, 0-95, or `null` if the lead
 *  hasn't actually started yet (still queued -- `startedAt` is stamped only
 *  once enrichLeadById's call begins, never for a merely-PENDING lead). Pure
 *  and pass `now` in explicitly so a re-render is the only thing that makes
 *  the number move -- no internal clock to fake out in a test. */
export function estimateEnrichmentProgress(startedAt: string | null | undefined, now: number): number | null {
  if (!startedAt) return null;
  const elapsed = now - new Date(startedAt).getTime();
  if (elapsed <= 0) return 0;
  if (elapsed <= TYPICAL_MS) return Math.round((elapsed / TYPICAL_MS) * TYPICAL_CAP);
  if (elapsed <= OUTLIER_MS) {
    const intoSecondLeg = (elapsed - TYPICAL_MS) / (OUTLIER_MS - TYPICAL_MS);
    return Math.round(TYPICAL_CAP + intoSecondLeg * (OUTLIER_CAP - TYPICAL_CAP));
  }
  return OUTLIER_CAP;
}

export function enrichmentStatusKindOf(lead: ApiLead): EnrichmentStatusKind {
  // On Hold is an overlay independent of completion, so it's checked first
  // and is NOT gated on !isEnriched -- a lead can be both.
  if ((lead.flags ?? []).includes("ON_HOLD")) return "on_hold";
  if (lead.enrichmentStatus === "COMPLETE") return "enriched";
  if (lead.enrichmentStatus === "STALLED") return "pending";
  // The run finished, but the person the scrapers resolved did not match the
  // one submitted (see Lead.linkedinMatchConfidence, the "Danny M" case).
  // Without its own kind this fell through to "enriching", so a lead that had
  // actually concluded sat on the recruiter's screen claiming to be in
  // progress forever -- the one outcome that most needs a human was the one
  // that looked like it needed nothing.
  if (lead.enrichmentStatus === "FLAGGED_REVIEW") return "needs_review";
  return "enriching";
}

interface Props {
  lead: ApiLead;
  /** Opens the enrichment-details dialog. */
  onOpenDetails: (lead: ApiLead) => void;
  /** Re-runs the waterfall for a lead whose run didn't conclude. */
  onRetry: (id: string) => void;
  retryPending?: boolean;
  /** Dispatches an Autumn re-enrichment run. Unlike Retry, this is available
   *  for any lead at any time -- it's the recruiter deciding the data is
   *  stale, not the system reporting a run that didn't conclude. */
  onReenrich: (lead: ApiLead) => void;
}

export function EnrichmentStatusCell({ lead, onOpenDetails, onRetry, retryPending, onReenrich }: Props) {
  const kind = enrichmentStatusKindOf(lead);
  const fieldCount = lead.enrichedFieldCount ?? 0;
  // A retry only makes sense for a hold the system placed, never a
  const [now, setNow] = useState(() => Date.now());
  const elapsed = lead.enrichmentStartedAt ? now - new Date(lead.enrichmentStartedAt).getTime() : 0;
  const isPastOutlier = kind === "enriching" && elapsed > OUTLIER_MS;
  const isStalledOrSystemError =
    kind === "pending" ||
    lead.enrichmentStatus === "STALLED" ||
    lead.onHoldReason === "SYSTEM_ERROR" ||
    lead.onHoldReason === "TIMEOUT";

  // A retry is available for stalled runs, system-placed holds, or if an in-flight run has exceeded the outlier window.
  // It always routes to the main pipeline to pick up from where it left off, never Autumn.
  const canRetry =
    isStalledOrSystemError ||
    (kind === "on_hold" && lead.onHoldReason !== "MANUAL") ||
    isPastOutlier;
  // Server-side truth, not local click state -- so the button is still
  // disabled after a reload or a trip to another page mid-run.
  const reenriching = lead.reenrichment?.status === "RUNNING";
  const missingContact = !lead.email && !lead.contactNumber;

  // Only ticks when genuinely in flight and not past outlier
  const genuinelyRunning = lead.enrichmentStatus === "IN_PROGRESS" && !!lead.enrichmentStartedAt;
  useEffect(() => {
    if (!genuinelyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(id);
  }, [genuinelyRunning]);

  const progressPct = genuinelyRunning && !isPastOutlier ? estimateEnrichmentProgress(lead.enrichmentStartedAt, now) : null;

  const tone: Record<EnrichmentStatusKind, string> = {
    on_hold: "text-warning",
    enriched: "text-emerald-400",
    enriching: "text-amber-400",
    pending: "text-muted-foreground",
    needs_review: "text-warning",
  };
  const label: Record<EnrichmentStatusKind, string> = {
    on_hold: `On Hold (${fieldCount})`,
    enriched: `Enriched (${fieldCount})`,
    // If running, show percentage; if past outlier window, indicate taking longer instead of freezing at 96%;
    // if pending/queued, show ellipsis
    enriching: isPastOutlier
      ? "Halted (taking longer)"
      : progressPct != null
      ? `Enriching (${progressPct}%)`
      : "Enriching…",
    pending: "Stalled",
    needs_review: `Check identity (${fieldCount})`,
  };
  // Opens the details dialog: these kinds are actionable by definition; for
  // "pending" (Stalled) the dialog shows the on-hold reason so the user is
  // never left clueless about why enrichment didn't proceed.
  const countsShown = kind === "on_hold" || kind === "enriched" || kind === "needs_review";
  const interactive = countsShown || kind === "pending";

  const onHoldReasonLabel =
    !lead.profileLink || lead.profileLink.trim() === ""
      ? "Profile Link Needed"
      : lead.onHoldReason === "INCOMPLETE_PROFILE"
      ? "Incomplete Profile"
      : lead.onHoldReason === "SYSTEM_ERROR" || lead.enrichmentStatus === "STALLED"
      ? "System Error / Stalled"
      : lead.onHoldReason === "TIMEOUT"
      ? "Enrichment Timed Out"
      : lead.onHoldReason === "MANUAL"
      ? "Manual Hold"
      : "Pending Review";

  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {/* Always rendered, only sometimes visible -- see the note above on why
          a conditional dot made the column ragged. */}
      <span
        aria-hidden={!missingContact}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${missingContact ? "bg-destructive" : "bg-transparent"}`}
        title={missingContact ? "No email or contact number found" : undefined}
      />
      {interactive ? (
        <button
          onClick={() => onOpenDetails(lead)}
          className={`font-semibold text-xs hover:underline cursor-pointer ${tone[kind]}`}
          title={
            kind === "pending"
              ? `Enrichment stalled: ${onHoldReasonLabel} — click to view reason and retry`
              : kind === "on_hold"
              ? `On Hold: ${onHoldReasonLabel} (${fieldCount} of ${ENRICHMENT_FIELD_TOTAL} fields found) — click to review or resume`
              : kind === "needs_review"
              ? `Check identity (${fieldCount} of ${ENRICHMENT_FIELD_TOTAL} fields found) — the resolved profile may be a different person; open to check`
              : `${fieldCount} of ${ENRICHMENT_FIELD_TOTAL} enrichment fields found`
          }
        >
          {label[kind]}
        </button>
      ) : (
        <span
          className={`font-semibold text-xs ${tone[kind]}`}
          title={
            kind !== "enriching"
              ? "Enrichment didn't conclude"
              : isPastOutlier
                ? "Enrichment is taking longer than usual — still in progress"
                : progressPct != null
                  ? "Estimated from elapsed time -- a typical run takes about 4 minutes"
                  : "Queued, not yet started"
          }
        >
          {label[kind]}
        </span>
      )}
      {canRetry && (
        <button
          onClick={() => onRetry(lead.id)}
          disabled={retryPending}
          className="text-xs text-destructive hover:underline cursor-pointer disabled:opacity-50"
          title="Retry enrichment pipeline (picks up from where it left off)"
        >
          · Retry
        </button>
      )}
      <button
        onClick={() => {
          if (isStalledOrSystemError) {
            onRetry(lead.id);
          } else {
            onReenrich(lead);
          }
        }}
        disabled={isStalledOrSystemError ? retryPending : reenriching}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
        title={
          isStalledOrSystemError
            ? "Retry enrichment pipeline (picks up from where it left off)"
            : reenriching
            ? "An Autumn re-enrichment run is already in progress for this lead"
            : "Re-research this profile with Autumn (takes a few minutes)"
        }
      >
        <RefreshCw className={`h-3.5 w-3.5 ${(isStalledOrSystemError ? retryPending : reenriching) ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
