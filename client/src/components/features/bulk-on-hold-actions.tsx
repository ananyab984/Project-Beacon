import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ApiLead } from "@/lib/api-types";
import { invalidateLeadData } from "@/lib/invalidateLeadData";
import { enrichmentStatusKindOf } from "@/components/features/enrichment-status-cell";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/features/manual-enrichment-dialog";

function toLeadForEnrichment(l: ApiLead): LeadForEnrichment {
  return {
    id: l.id,
    name: l.displayName ?? l.fullName ?? l.maskedLabel ?? "",
    email: l.email,
    phone: l.contactNumber,
    country: l.country,
    profile_link: l.profileLink,
    language: l.targetLanguage ?? "",
    source_language: l.sourceLanguage,
    target_language: l.targetLanguage,
    services: l.services,
    years_experience: l.yearsOfExperience,
    vendor_experience: l.vendorExperience,
  };
}

interface Props {
  /** The currently selected leads. Only the On Hold / stalled ones are acted on. */
  selectedLeads: ApiLead[];
  /** The page's own save handler (maps the dialog's fields to a lead PATCH). */
  onMarkEnriched: (id: string, updated: Partial<LeadForEnrichment>) => Promise<unknown>;
  /** Clears the lead's On Hold flag once a recruiter has marked it Enriched by hand. */
  onClearHold: (id: string) => Promise<unknown>;
  onDone: () => void;
}

/** Bulk actions for selected On Hold leads: re-run enrichment for all of them, or step through
 *  them one card at a time to fill in the data by hand ("Mark as Enriched" swaps in the next one). */
export function BulkOnHoldActions({ selectedLeads, onMarkEnriched, onClearHold, onDone }: Props) {
  const queryClient = useQueryClient();
  const held = selectedLeads.filter((l) => {
    const kind = enrichmentStatusKindOf(l);
    return kind === "on_hold" || kind === "pending";
  });

  const reenrich = useMutation({
    mutationFn: () => api.retryLeadsEnrichment(held.map((l) => l.id)),
    onSuccess: ({ requeued, skipped }) => {
      invalidateLeadData(queryClient);
      toast.success(`Re-enriching ${requeued} lead${requeued === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped: already running or not yours)` : ""}`);
      onDone();
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to re-enrich leads"),
  });

  // The queue is a snapshot of ids taken when it opens, so leads leaving "On Hold" mid-way don't reshuffle it.
  const [queue, setQueue] = useState<ApiLead[] | null>(null);
  const [index, setIndex] = useState(0);
  // Set once the dialog's own save succeeded, so its follow-up onOpenChange(false) means "next card", not "closed".
  const advancing = useRef<"left" | "right" | null>(null);
  const [swipe, setSwipe] = useState<"left" | "right" | null>(null);

  const finish = () => {
    setQueue(null);
    setIndex(0);
    invalidateLeadData(queryClient);
    onDone();
  };

  // Fling the current card off in `dir`, then bring in the next one (or finish after the last).
  const swipeToNext = (dir: "left" | "right") => {
    if (swipe) return;
    setSwipe(dir);
    setTimeout(() => {
      setSwipe(null);
      if (queue && index + 1 < queue.length) setIndex(index + 1);
      else finish();
    }, 300);
  };

  if (held.length === 0) return null;
  const current = queue?.[index] ?? null;

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" disabled={reenrich.isPending} onClick={() => reenrich.mutate()}>
        <RefreshCw className={`h-3.5 w-3.5 ${reenrich.isPending ? "animate-spin" : ""}`} /> Re-enrich ({held.length})
      </Button>
      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setQueue(held); setIndex(0); }}>
        <PencilLine className="h-3.5 w-3.5" /> Add data manually ({held.length})
      </Button>

      <ManualEnrichmentDialog
        open={!!current}
        lead={current ? toLeadForEnrichment(current) : null}
        queue={queue ? { index, total: queue.length, onSkip: () => swipeToNext("left"), swipe } : undefined}
        onMarkEnriched={async (id, updated) => {
          await onMarkEnriched(id, updated);
          if (updated.enrichment_status === "complete") await onClearHold(id);
          advancing.current = updated.enrichment_status === "complete" ? "right" : "left";
        }}
        onOpenChange={(o) => {
          if (o) return;
          if (advancing.current) {
            const dir = advancing.current;
            advancing.current = null;
            swipeToNext(dir);
          } else {
            setQueue(null);
            setIndex(0);
            invalidateLeadData(queryClient);
          }
        }}
      />
    </>
  );
}
