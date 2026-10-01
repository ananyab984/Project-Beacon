import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiLead, ReenrichmentConflict } from "@/lib/api-types";

/**
 * Progress popup for a recruiter-triggered Autumn re-enrichment.
 *
 * Autumn is agent-based, so a run takes minutes rather than the seconds a
 * scrape takes -- the point of this dialog is to say so up front, then keep
 * showing progress for whoever wants to wait. Closing it never cancels the
 * run: the work is server-side, and the leads table shows the same
 * in-progress state when the recruiter comes back.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  leadName: string;
  /** Id of the run this dialog is following, once the POST that created it
   *  has returned. Until then (and if the returned run doesn't match it) the
   *  dialog stays in its running state rather than reporting the outcome of
   *  some earlier run on the same lead. */
  runId: string | null;
  /** Set when the POST itself was refused -- a rate-limit or already-running
   *  rejection is a real outcome the recruiter needs to read, not a toast to
   *  miss while watching this dialog. */
  startError: string | null;
  /** Refresh the leads table once a run concludes, so "Enriched (n)" and the
   *  button's disabled state pick up the result. */
  onConcluded: () => void;
}

/** Field labels the recruiter recognises, matching the enrichment dialog. */
const FIELD_LABELS: Record<string, string> = {
  displayName: "Name",
  headline: "Headline",
  currentTitle: "Current title",
  aboutSnippet: "About",
  country: "Country",
  certifications: "Certifications",
};

const showValue = (v: string | string[]) => (Array.isArray(v) ? v.join(", ") : v);

/**
 * The side-by-side picker for fields where Autumn disagreed with what the
 * lead already has. Re-enrichment never overwrites on its own -- without
 * this, a genuinely stale value (a title that really did change) could only
 * be refreshed by clearing the field by hand first.
 */
function ConflictPicker({
  conflicts,
  accepted,
  onToggle,
}: {
  conflicts: ReenrichmentConflict[];
  accepted: string[];
  onToggle: (field: string, take: boolean) => void;
}) {
  return (
    <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
      {conflicts.map((c) => {
        const take = accepted.includes(c.field);
        return (
          <div key={c.field} className="rounded-md border border-border p-2.5">
            <div className="mb-1.5 text-xs font-semibold">{FIELD_LABELS[c.field] ?? c.field}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {([
                ["current", "Keep current", c.current, !take],
                ["proposed", "Use Autumn's", c.proposed, take],
              ] as const).map(([key, label, value, selected]) => (
                <button
                  key={key}
                  onClick={() => onToggle(c.field, key === "proposed")}
                  className={`rounded border p-2 text-left text-xs transition-colors ${
                    selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="mb-0.5 font-medium text-[11px] text-muted-foreground">{label}</div>
                  <div className="break-words">{showValue(value) || <span className="italic opacity-60">(empty)</span>}</div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReenrichmentModal({ open, onOpenChange, leadId, leadName, runId, startError, onConcluded }: Props) {
  const [accepted, setAccepted] = useState<string[]>([]);
  const [resolved, setResolved] = useState(false);
  const statusQuery = useQuery({
    queryKey: ["reenrichment-status", leadId, runId],
    queryFn: () => api.getReenrichmentStatus(leadId!),
    enabled: open && !!leadId && !!runId,
    // Only polls while this dialog is open and a run is actually going --
    // there's no app-wide polling loop to piggyback on, and adding one for
    // this would keep every leads page refetching forever.
    refetchInterval: (query) => (query.state.data?.run?.status === "RUNNING" ? 4000 : false),
  });

  const returned = statusQuery.data?.run ?? null;
  const run = returned && returned.id === runId ? returned : null;
  const status = startError ? "START_REFUSED" : run?.status ?? "RUNNING";
  const done = status !== "RUNNING";

  useEffect(() => {
    if (open && done) onConcluded();
    // onConcluded is a stable invalidate callback; re-running on every status
    // change is the point.
  }, [open, done, status]);

  // Each new run starts with nothing accepted -- taking Autumn's value is
  // always a deliberate click, never the default.
  useEffect(() => {
    setAccepted([]);
    setResolved(false);
  }, [runId]);

  const conflicts = (!resolved && run?.status === "COMPLETED" && !run.resolvedAt ? run.conflicts : null) ?? [];

  const resolveMutation = useMutation({
    mutationFn: () => api.resolveReenrichment(leadId!, runId!, accepted),
    onSuccess: () => {
      setResolved(true);
      onConcluded();
    },
  });

  const body = {
    RUNNING: {
      icon: <Loader2 className="h-4 w-4 animate-spin text-amber-400" />,
      title: "Re-enrichment in progress",
      text: "Autumn researches the profile with an agent rather than a quick scrape, so this usually takes a few minutes. You can close this and keep working — the run continues in the background, and the lead stays marked as re-enriching until it finishes.",
    },
    COMPLETED: {
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
      title: conflicts.length
        ? `Re-enrichment complete — ${conflicts.length} field${conflicts.length === 1 ? "" : "s"} to review`
        : `Re-enrichment complete — ${run?.fieldsWritten ?? 0} field${run?.fieldsWritten === 1 ? "" : "s"} updated`,
      text: conflicts.length
        ? "Empty fields were filled automatically. These already had a value, so nothing was changed — pick which to keep."
        : run?.message ?? "The lead's enrichment details have been updated.",
    },
    TIMED_OUT: {
      icon: <Clock className="h-4 w-4 text-warning" />,
      title: "Re-enrichment timed out",
      text: run?.message ?? "Autumn didn't finish in time. The lead has been put On Hold and its existing data is unchanged.",
    },
    FAILED: {
      icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
      title: "Re-enrichment failed",
      text: run?.message ?? "Something went wrong. The lead's existing data is unchanged.",
    },
    START_REFUSED: {
      icon: <AlertTriangle className="h-4 w-4 text-warning" />,
      title: "Re-enrichment not started",
      text: startError ?? "",
    },
  }[status];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {body.icon}
            {body.title}
          </DialogTitle>
          <DialogDescription className="pt-1">{leadName}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{body.text}</p>

        {conflicts.length > 0 && (
          <ConflictPicker
            conflicts={conflicts}
            accepted={accepted}
            onToggle={(field, take) =>
              setAccepted((prev) => (take ? [...prev, field] : prev.filter((f) => f !== field)))
            }
          />
        )}

        {run?.creditsUsed != null && (
          <p className="text-xs text-muted-foreground">Autumn credits used: {run.creditsUsed}</p>
        )}
        {resolveMutation.isError && (
          <p className="text-xs text-destructive">
            {(resolveMutation.error as any)?.message ?? "Could not apply those changes."}
          </p>
        )}

        <DialogFooter>
          {conflicts.length > 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Decide later
              </Button>
              <Button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}>
                {resolveMutation.isPending
                  ? "Applying…"
                  : accepted.length === 0
                  ? "Keep all current values"
                  : `Apply ${accepted.length} change${accepted.length === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <Button variant={done ? "default" : "outline"} onClick={() => onOpenChange(false)}>
              {done ? "Close" : "Keep working"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The whole per-table wiring for the Re-enrich button: dispatches the run,
 * opens the dialog on click (before the request even lands, since the
 * recruiter needs to be told it's slow immediately), and feeds the dialog.
 *
 * A hook rather than 25 lines copied into recruiter.leads.tsx and
 * owner.leads.tsx -- those two are near-duplicates that have already drifted
 * apart once, which is exactly why EnrichmentStatusCell was extracted.
 */
export function useReenrichment(onConcluded: () => void) {
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (id: string) => api.reenrichLead(id),
    onSuccess: (data) => {
      setRunId(data.run.id);
      // Refresh so the row's own Re-enrich button picks up RUNNING and stays
      // disabled even if the recruiter closes this dialog immediately.
      onConcluded();
    },
    // 409 (already running) and 429 (cooldown/daily cap) both arrive here and
    // both are things the recruiter needs to read, so they're shown in the
    // dialog they're already looking at rather than a toast behind it.
    onError: (err: any) => setStartError(err?.message ?? "Could not start re-enrichment."),
  });

  function start(lead: ApiLead) {
    setTarget({ id: lead.id, name: lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? "This lead" });
    setRunId(null);
    setStartError(null);
    setOpen(true);
    mutation.mutate(lead.id);
  }

  return {
    start,
    modalProps: {
      open,
      onOpenChange: setOpen,
      leadId: target?.id ?? null,
      leadName: target?.name ?? "",
      runId,
      startError,
      onConcluded,
    },
  };
}
