import { createFileRoute } from "@tanstack/react-router";
import { useRecruiters, deleteRecruiter, escalations, type Recruiter, type Escalation } from "@/lib/g3-mock";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { KpiTile, ScoreRing } from "@/components/g3/kpi";
import { getEvaluation, type MetricSnapshot } from "@/lib/evaluation";
import { EvaluationDashboard } from "@/components/g3/evaluation-dashboard";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle, AlertCircle, Clock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/recruiters")({
  head: () => ({
    meta: [
      { title: "Recruiters — Global3 Owner" },
      { name: "description", content: "Recruiter and contractor performance, Project Beacon evaluation rubric, SLA adherence, and activity metrics." },
    ],
  }),
  component: RecruitersPage,
});

const baseline = { reply: 0.28, read: 0.65 };

function RecruitersPage() {
  const recruiters = useRecruiters();
  const [openId, setOpenId] = useState<string | null>(null);
  const [escalatedRecruiterId, setEscalatedRecruiterId] = useState<string | null>(null);

  const active = recruiters.find((r) => r.id === openId) ?? null;
  const escalatedRecruiter = recruiters.find((r) => r.id === escalatedRecruiterId) ?? null;

  const full = [...recruiters.filter((r) => r.role === "full_access")].sort((a, b) => b.kpis.overall_score - a.kpis.overall_score);
  const contractors = [...recruiters.filter((r) => r.role === "contractor")].sort((a, b) => b.kpis.overall_score - a.kpis.overall_score);

  // Get escalated items for selected recruiter
  const recruiterEscalations = escalatedRecruiter
    ? escalations.filter(
        (e) =>
          e.recruiter_id === escalatedRecruiter.id ||
          e.owner.toLowerCase().includes(escalatedRecruiter.name.toLowerCase()) ||
          e.detail.toLowerCase().includes(escalatedRecruiter.name.toLowerCase()) ||
          (escalatedRecruiter.unresolved_5d > 0 && e.priority === "P1"),
      )
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* Full-access recruiters section */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-accent">Full-access recruiters ({full.length})</h2>
          <span className="text-xs text-muted-foreground">Ranked by overall recruiter score · Team baseline reply {Math.round(baseline.reply * 100)}%</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {full.map((r) => (
            <RecruiterCard
              key={r.id}
              r={r}
              onOpen={() => setOpenId(r.id)}
              onOpenEscalated={() => setEscalatedRecruiterId(r.id)}
            />
          ))}
        </div>
      </section>

      {/* Contractors section */}
      {contractors.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Contractors ({contractors.length})</h2>
            <span className="text-xs text-muted-foreground">Contractor evaluation &amp; SLA metrics</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contractors.map((r) => (
              <RecruiterCard
                key={r.id}
                r={r}
                onOpen={() => setOpenId(r.id)}
                onOpenEscalated={() => setEscalatedRecruiterId(r.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Slide-out sheet: entire evaluation rubric */}
      <Sheet open={!!active} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-4xl overflow-auto border-l border-border bg-background p-6">
          {active && (
            <div className="space-y-6">
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold text-white shrink-0"
                      style={{ background: `oklch(0.55 0.16 ${active.avatar_hue})` }}
                    >
                      {active.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-lg font-bold">
                        <span>{active.name}</span>
                        <StatusPill status={active.status} />
                      </div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {active.role === "contractor" ? "Contractor Evaluation" : "Full-Access Recruiter Evaluation"}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      if (confirm(`Are you sure you want to remove ${active.name} from the recruiter roster?`)) {
                        deleteRecruiter(active.id);
                        setOpenId(null);
                        toast.success(`Removed recruiter ${active.name}`);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete Recruiter
                  </Button>
                </SheetTitle>
              </SheetHeader>

              {/* Entire Project Beacon Evaluation Rubric */}
              <EvaluationDashboard
                subjectId={active.id}
                subjectName={active.name}
                roleLabel={active.role === "contractor" ? "Contractor" : "Recruiter"}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Escalated Items Modal */}
      <Dialog open={!!escalatedRecruiter} onOpenChange={(o) => !o && setEscalatedRecruiterId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-2 text-warning">
              <ShieldAlert className="h-5 w-5" />
              <DialogTitle className="text-base text-foreground">
                Escalated Items — {escalatedRecruiter?.name}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Review active SLA breaches, stalled follow-ups, and escalated alerts assigned to {escalatedRecruiter?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-3 max-h-96 overflow-y-auto pr-1">
            {recruiterEscalations.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
                No active P1/P2 escalations logged for {escalatedRecruiter?.name}.
              </div>
            ) : (
              recruiterEscalations.map((esc) => (
                <div key={esc.id} className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        esc.priority === "P1"
                          ? "bg-destructive/20 text-destructive"
                          : "bg-warning/20 text-warning"
                      }`}>
                        {esc.priority}
                      </span>
                      <span className="text-xs font-semibold text-foreground">{esc.category}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {esc.age_days}d aging
                    </span>
                  </div>

                  <h4 className="text-xs font-semibold text-foreground">{esc.title}</h4>
                  <p className="text-[11px] text-muted-foreground">{esc.detail}</p>

                  {esc.recommended_action && (
                    <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-primary">
                      <strong>Recommended Action:</strong> {esc.recommended_action}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecruiterCard({
  r,
  onOpen,
  onOpenEscalated,
}: {
  r: Recruiter;
  onOpen: () => void;
  onOpenEscalated: () => void;
}) {
  const ev = getEvaluation(r.id, r.name);
  const band = ev.band;
  const bandTone =
    band.tone === "positive" ? "bg-accent/15 text-accent" :
    band.tone === "warning" ? "bg-warning/15 text-warning" :
    band.tone === "critical" ? "bg-destructive/15 text-destructive" :
    "bg-primary/15 text-primary";

  const activityMetrics = ev.metrics.filter((m: MetricSnapshot) => m.def.group === "Activity & Effort");
  const responsivenessMetrics = ev.metrics.filter((m: MetricSnapshot) => m.def.group === "Responsiveness");

  const outreachVolume = activityMetrics.find((m: MetricSnapshot) => m.def.id === "outreach_volume");
  const followupPersistence = activityMetrics.find((m: MetricSnapshot) => m.def.id === "followup_persistence");
  const proactiveSourcing = activityMetrics.find((m: MetricSnapshot) => m.def.id === "proactive_sourcing");

  const timeToFirstTouch = responsivenessMetrics.find((m: MetricSnapshot) => m.def.id === "time_to_first_touch");
  const slaAdherence = responsivenessMetrics.find((m: MetricSnapshot) => m.def.id === "sla_adherence");
  const backlogAging = responsivenessMetrics.find((m: MetricSnapshot) => m.def.id === "backlog_aging");

  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-5 text-left transition-all hover:border-accent/50 hover:shadow-[0_1px_0_0_theme(colors.accent/10),0_12px_28px_-16px_theme(colors.accent/25)]">
      <div onClick={onOpen} className="cursor-pointer">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: `oklch(0.55 0.16 ${r.avatar_hue})` }}
            >
              {r.name.charAt(0)}
            </div>
            <div>
              <div className="font-semibold text-foreground flex items-center gap-2">
                {r.name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {r.role === "contractor" ? "Contractor" : "Full access"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <StatusPill status={r.status} />
            <button
              onClick={() => {
                if (confirm(`Delete recruiter ${r.name}?`)) {
                  deleteRecruiter(r.id);
                  toast.success(`Deleted ${r.name}`);
                }
              }}
              className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
              title={`Delete ${r.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Overall Score & Band */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3">
          <ScoreRing score={r.kpis.overall_score} size={72} label="Overall score" />
          <div className="text-right">
            <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${bandTone}`}>
              {band.label}
            </span>
            <div className="mt-1.5 text-[11px] text-muted-foreground">{band.meaning}</div>
          </div>
        </div>

        {/* Rubric metrics: Activity & Effort */}
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              Activity &amp; Effort
            </div>
            <div className="grid grid-cols-3 gap-2">
              <KpiTile label="Outreach Vol." value={outreachVolume?.current ?? r.kpis.outreach_volume} unit="score" />
              <KpiTile label="Follow-up" value={followupPersistence?.current ?? 2.4} unit="score" hint="avg attempts" />
              <KpiTile label="Proactive" value={proactiveSourcing?.current ?? 14} unit="score" hint="self-sourced" />
            </div>
          </div>

          {/* Rubric metrics: Responsiveness & SLA */}
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              Responsiveness &amp; SLA
            </div>
            <div className="grid grid-cols-3 gap-2">
              <KpiTile label="1st Touch" value={timeToFirstTouch?.current ?? 1.2} unit="days" hint="days to 1st msg" />
              <KpiTile label="SLA Adherence" value={slaAdherence?.current ?? r.kpis.sla_adherence} unit="pct" hint="urgent reply" />
              <KpiTile label="Backlog Aging" value={backlogAging?.current ?? 0} unit="pct" hint="3+ days idle" />
            </div>
          </div>
        </div>
      </div>

      {/* Escalated Items Banner — Clickable to open Escalation Inspection */}
      {r.unresolved_5d > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenEscalated();
          }}
          className="mt-4 flex w-full items-center justify-between rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning font-semibold hover:bg-warning/20 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-warning animate-pulse" />
            {r.unresolved_5d} escalated {r.unresolved_5d === 1 ? "item" : "items"} 5+ days unresolved
          </span>
          <span className="text-[10px] underline">Inspect →</span>
        </button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Recruiter["status"] }) {
  const map = {
    healthy: { c: "bg-[oklch(0.62_0.14_155)]/15 text-[oklch(0.42_0.14_155)]", label: "healthy" },
    attention: { c: "bg-warning/15 text-warning", label: "attention" },
    stalled: { c: "bg-destructive/15 text-destructive", label: "stalled" },
  }[status];
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${map.c}`}>{map.label}</span>;
}