import { escalations, recruiterById } from "@/lib/g3-mock";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const priorityRank = { P1: 0, P2: 1, P3: 2 } as const;
const sortedEscalations = [...escalations].sort(
  (a, b) => priorityRank[a.priority] - priorityRank[b.priority] || b.age_days - a.age_days,
);

function priorityStyle(p: "P1" | "P2" | "P3") {
  return p === "P1"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : p === "P2"
    ? "border-warning/40 bg-warning/10 text-warning"
    : "border-accent/40 bg-accent/10 text-accent";
}

export function EscalationsBell() {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = sortedEscalations.find((e) => e.id === openId) ?? null;
  const p1Count = sortedEscalations.filter((e) => e.priority === "P1").length;

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
            {sortedEscalations.map((e) => {
              const rec = e.recruiter_id ? recruiterById(e.recruiter_id) : undefined;
              return (
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
                    <span className="shrink-0 text-[11px] text-muted-foreground">{e.age_days}d</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.detail}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">
                      Owner: <span className="text-foreground">{e.owner}</span>
                      {rec ? ` · ${rec.name}` : ""}
                    </span>
                    <span className="text-muted-foreground">{e.status}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={!!active} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-xl">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${priorityStyle(active.priority)}`}>
                    {active.priority}
                  </span>
                  {active.title}
                  <Badge variant="outline" className="text-[10px]">{active.status}</Badge>
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
                  <div className="font-medium">{active.owner}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Age</div>
                  <div className="font-medium">{active.age_days} days</div>
                </div>
                {active.sla_hours_remaining !== undefined && (
                  <div>
                    <div className="text-xs text-muted-foreground">SLA</div>
                    <div className={`font-medium ${active.sla_hours_remaining < 0 ? "text-destructive" : "text-foreground"}`}>
                      {active.sla_hours_remaining < 0
                        ? `${Math.abs(active.sla_hours_remaining)}h breached`
                        : `${active.sla_hours_remaining}h remaining`}
                    </div>
                  </div>
                )}
                {active.recruiter_id && (
                  <div>
                    <div className="text-xs text-muted-foreground">Recruiter</div>
                    <div className="font-medium">{recruiterById(active.recruiter_id)?.name}</div>
                  </div>
                )}
                {active.lead_id && (
                  <div>
                    <div className="text-xs text-muted-foreground">Lead</div>
                    <div className="font-medium">{active.lead_id.toUpperCase()}</div>
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
                  <div className="font-medium">{active.recommended_action}</div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>
                <Button className="bg-accent text-accent-foreground hover:bg-accent/90">Assign to me</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
