import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDaysUntilPurge } from "@/lib/recycleBin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trash2, RotateCcw } from "lucide-react";

/** Global Leads recycle bin -- lists leads soft-deleted via the bulk Delete
 *  action, each with its own Restore button and its own 30-day countdown
 *  (Windows Recycle Bin semantics: no single bin-wide expiry, every item ages
 *  out on its own clock -- see server/src/lib/recycleBin.ts). Shared by the
 *  owner and recruiter Global Leads pages; contractors never see this at all
 *  (GET /api/leads/bin is owner/recruiter only, and delete lives only in the
 *  Global Leads page to begin with). */
export function RecycleBinDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const binQuery = useQuery({
    queryKey: ["leads-bin"],
    queryFn: () => api.getBinLeads(),
    enabled: open,
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Trash2 className="h-3.5 w-3.5" /> Recycle Bin{binLeads.length > 0 ? ` (${binLeads.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-muted-foreground" /> Recycle Bin
          </DialogTitle>
          <DialogDescription>
            Deleted leads stay here for 30 days from their own deletion date, then are permanently removed. Restore any of them before then.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {binQuery.isLoading && <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>}
          {binQuery.isError && <div className="py-8 text-center text-xs text-destructive">Failed to load recycle bin.</div>}
          {!binQuery.isLoading && !binQuery.isError && binLeads.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">Recycle bin is empty.</div>
          )}
          {binLeads.map((lead) => (
            <div key={lead.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
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
      </DialogContent>
    </Dialog>
  );
}
