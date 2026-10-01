import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDaysUntilPurge } from "@/lib/recycleBin";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

/** Global Leads recycle bin -- lists leads soft-deleted via the bulk Delete
 *  action, each with its own Restore button (standing in for the notify bell
 *  a live leads row would show) and its own 30-day countdown (Windows
 *  Recycle Bin semantics: no single bin-wide expiry, every item ages out on
 *  its own clock -- see server/src/lib/recycleBin.ts). Rendered full-page by
 *  both the owner and recruiter recycle-bin routes; contractors never see
 *  this at all (GET /api/leads/bin is owner/recruiter only, and delete lives
 *  only in the Global Leads page to begin with). */
export function RecycleBinList() {
  const queryClient = useQueryClient();

  const binQuery = useQuery({
    queryKey: ["leads-bin"],
    queryFn: () => api.getBinLeads(),
  });
  const binLeads = binQuery.data?.leads ?? [];

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.restoreLead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads-bin"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead restored");
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to restore lead"),
  });

  return (
    <div className="space-y-2">
      {binQuery.isLoading && (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      )}
      {binQuery.isError && (
        <div className="py-12 text-center text-sm text-destructive">Failed to load recycle bin.</div>
      )}
      {!binQuery.isLoading && !binQuery.isError && binLeads.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">Recycle bin is empty.</div>
      )}
      {binLeads.map((lead) => (
        <div
          key={lead.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Deleted {new Date(lead.deletedAt!).toLocaleDateString()} · {formatDaysUntilPurge(lead.daysUntilPurge)}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-xs"
            disabled={restoreMutation.isPending}
            onClick={() => restoreMutation.mutate(lead.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </Button>
        </div>
      ))}
    </div>
  );
}
