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

export type EnrichmentStatusKind = "on_hold" | "enriched" | "enriching" | "pending";

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
const OUTLIER_CAP = 96;

/** Elapsed-time estimate of enrichment progress, 0-96, or `null` if the lead
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
  // recruiter's own deliberate one.
  const canRetry = kind === "on_hold" && lead.onHoldReason !== "MANUAL";
  // Server-side truth, not local click state -- so the button is still
  // disabled after a reload or a trip to another page mid-run.
  const reenriching = lead.reenrichment?.status === "RUNNING";
  const missingContact = !lead.email && !lead.contactNumber;

  // Ticks this row every few seconds while it's genuinely in flight, purely
  // to move `now` forward so estimateEnrichmentProgress recomputes -- the
  // underlying data (enrichmentStartedAt) never changes, only the clock does.
  // Scoped tightly (only runs for a lead with a real startedAt) so a table of
  // 200 mostly-idle rows isn't running 200 live timers.
  const genuinelyRunning = kind === "enriching" && !!lead.enrichmentStartedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!genuinelyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(id);
  }, [genuinelyRunning]);

  const progressPct = genuinelyRunning ? estimateEnrichmentProgress(lead.enrichmentStartedAt, now) : null;

  const tone: Record<EnrichmentStatusKind, string> = {
    on_hold: "text-warning",
    enriched: "text-emerald-400",
    enriching: "text-amber-400",
    pending: "text-muted-foreground",
  };
  const label: Record<EnrichmentStatusKind, string> = {
    on_hold: `On Hold (${fieldCount})`,
    enriched: `Enriched (${fieldCount})`,
    // A lead still PENDING (queued, not yet started -- no enrichmentStartedAt
    // yet) has no elapsed time to estimate from, so it keeps the plain
    // ellipsis rather than a fabricated "0%" that would just be another way
    // of looking halted. Once it genuinely starts, the percentage takes over.
    enriching: progressPct != null ? `Enriching (${progressPct}%)` : "Enriching…",
    pending: "Stalled",
  };
  const countsShown = kind === "on_hold" || kind === "enriched";
  const interactive = countsShown;

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
            `${fieldCount} of ${ENRICHMENT_FIELD_TOTAL} enrichment fields found` +
            (kind === "on_hold" ? " — open to review or resume" : "")
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
          title="Enrichment didn't conclude — click to retry"
        >
          · Retry
        </button>
      )}
      <button
        onClick={() => onReenrich(lead)}
        disabled={reenriching}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
        title={
          reenriching
            ? "An Autumn re-enrichment run is already in progress for this lead"
            : "Re-research this profile with Autumn (takes a few minutes)"
        }
      >
        <RefreshCw className={`h-3.5 w-3.5 ${reenriching ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
