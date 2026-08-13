import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiEscalation, EscalationPriority, EscalationStatus } from "@/lib/api-types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function priorityStyle(p: EscalationPriority) {
  return p === "P1"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : p === "P2"
    ? "border-warning/40 bg-warning/10 text-warning"
    : "border-accent/40 bg-accent/10 text-accent";
}

function statusLabel(s: EscalationStatus) {
  switch (s) {
    case "OPEN":
      return "Open";
    case "ACKNOWLEDGED":
      return "Acknowledged";
    case "IN_PROGRESS":
      return "In Progress";
    default:
      return s;
  }
}

function ageDays(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
}

const priorityRank: Record<EscalationPriority, number> = { P1: 0, P2: 1, P3: 2 };

export function EscalationsBell() {
  const [openId, setOpenId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["escalations"],
    queryFn: api.getEscalations,
  });

  const sortedEscalations = useMemo(() => {
    const list = data?.escalations ?? [];
    return [...list].sort(
      (a, b) => priorityRank[a.priority] - priorityRank[b.priority] || ageDays(a.createdAt) - ageDays(b.createdAt)
    );
  }, [data]);

  const active: ApiEscalation | null = sortedEscalations.find((e) => e.id === openId) ?? null;
  const p1Count = sortedEscalations.filter((e) => e.priority === "P1").length;

  const closeDialog = () => setOpenId(null);

  const assignToMeMutation = useMutation({
    mutationFn: (id: string) => api.updateEscalation(id, { assignToMe: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      closeDialog();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.updateEscalation(id, { status: "ACKNOWLEDGED" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      closeDialog();
    },
  });

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label="Escalated items"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground/70 transition-colors hover:text-foreground hover:border-accent/40"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
              {sortedEscalations.length}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[26rem] p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-semibold">Escalated items</div>
            <div className="text-xs text-muted-foreground">
              {p1Count} P1 · {sortedEscalations.length} open · owner-only view
            </div>
          </div>
          <div className="max-h-[26rem] divide-y divide-border overflow-auto">
            {isPending && (
              <div className="p-6 text-center text-xs text-muted-foreground">Loading escalations…</div>
            )}
            {isError && (
              <div className="p-6 text-center text-xs text-destructive">Couldn't load escalations.</div>
            )}
            {!isPending && !isError && sortedEscalations.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No escalations right now.
              </div>
            )}
            {sortedEscalations.map((e) => (
              <button
                key={e.id}
                onClick={() => setOpenId(e.id)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${priorityStyle(e.priority)}`}>
                        {e.priority}
                      </span>
                      <div className="truncate text-sm font-medium text-foreground">{e.title}</div>
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{e.category}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{ageDays(e.createdAt)}d</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.detail}</div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Owner: <span className="text-foreground">{e.ownerUserId ? "Assigned" : "Unassigned"}</span>
                  </span>
                  <span className="text-muted-foreground">{statusLabel(e.status)}</span>
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={!!active} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-xl">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${priorityStyle(active.priority)}`}>
                    {active.priority}
                  </span>
                  {active.title}
                  <Badge variant="outline" className="text-[10px]">{statusLabel(active.status)}</Badge>
                </DialogTitle>
                <DialogDescription>{active.detail}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Category</div>
                  <div className="font-medium">{active.category}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Owner</div>
                  <div className="font-medium">{active.ownerUserId ? "Assigned" : "Unassigned"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Age</div>
                  <div className="font-medium">{ageDays(active.createdAt)} days</div>
                </div>
                {active.slaHoursRemaining !== null && (
                  <div>
                    <div className="text-xs text-muted-foreground">SLA</div>
                    <div className={`font-medium ${active.slaHoursRemaining < 0 ? "text-destructive" : "text-foreground"}`}>
                      {active.slaHoursRemaining < 0
                        ? `${Math.abs(active.slaHoursRemaining)}h breached`
                        : `${active.slaHoursRemaining}h remaining`}
                    </div>
                  </div>
                )}
                {active.recruiterId && (
                  <div>
                    <div className="text-xs text-muted-foreground">Recruiter</div>
                    <div className="font-medium">{active.recruiterId}</div>
                  </div>
                )}
                {active.leadId && (
                  <div>
                    <div className="text-xs text-muted-foreground">Lead</div>
                    <div className="font-medium">{active.leadId}</div>
                  </div>
                )}
                {active.impact && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Business impact</div>
                    <div className="font-medium">{active.impact}</div>
                  </div>
                )}
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Recommended action</div>
                  <div className="font-medium">{active.recommendedAction}</div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => dismissMutation.mutate(active.id)} disabled={dismissMutation.isPending}>
                  Dismiss
                </Button>
                <Button
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={() => assignToMeMutation.mutate(active.id)}
                  disabled={assignToMeMutation.isPending}
                >
                  Assign to me
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
