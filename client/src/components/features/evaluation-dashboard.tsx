import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ApiKpiConfig, ApiRecruiterMetricSnapshot } from "@/lib/api-types";
import { ScoreRing } from "@/components/features/kpi";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const GROUP_BLURB: Record<string, string> = {
  "Activity & Effort": "Volume, persistence, and promptness of recruiter-initiated work.",
  "Ownership & Follow-through": "Whether leads move forward and get properly logged.",
  "Outcome Metrics": "Watched, not weighted — candidate conversions and business outputs.",
};

function formatMetricValue(unit: string | null | undefined, val: any): string {
  if (val === null || val === undefined || val === "") return "—";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(num)) return String(val);
  const u = (unit ?? "").toLowerCase();
  if (u.includes("pct") || u === "%") return `${Math.round(num)}%`;
  if (u.includes("day")) return Number.isInteger(num) ? `${num}d` : `${num.toFixed(1)}d`;
  if (u.includes("attempt")) return `${num}x`;
  return Number.isInteger(num) ? `${num}` : `${num.toFixed(1)}`;
}

function statusChip(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  let cls = "bg-muted text-muted-foreground border border-border";
  let label = "Signal only";
  if (s.includes("off")) {
    cls = "bg-destructive/15 text-destructive border border-destructive/30";
    label = "Off track";
  } else if (s.includes("watch")) {
    cls = "bg-warning/15 text-warning border border-warning/30";
    label = "Watch";
  } else if (s.includes("on_track") || s.includes("ontrack") || s === "good" || s === "strong" || s === "solid") {
    cls = "bg-accent/15 text-accent border border-accent/30";
    label = s === "strong" ? "Strong" : "On track";
  }
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>;
}

function toneForScore(score: number) {
  if (score >= 85) return { cls: "bg-accent/15 text-accent border-accent/30", meaning: "Minimal oversight needed" };
  if (score >= 70) return { cls: "bg-primary/15 text-primary border-primary/30", meaning: "Meeting expectations" };
  if (score >= 50) return { cls: "bg-warning/15 text-warning border-warning/30", meaning: "Needs a coaching conversation, with a named area" };
  if (score > 0) return { cls: "bg-destructive/15 text-destructive border-destructive/30", meaning: "Requires review this week, not next cycle" };
  return { cls: "bg-muted text-muted-foreground border-border", meaning: "No activity recorded yet" };
}

export function EvaluationDashboard({
  subjectId,
  subjectName,
  roleLabel = "Recruiter",
  isExpandable = false,
}: {
  subjectId: string;
  subjectName: string;
  roleLabel?: string;
  isExpandable?: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: scoreData, isLoading: scoreLoading, isError: scoreError, isRefetching } = useQuery({
    queryKey: ["recruiter-score", subjectId],
    queryFn: () => api.getRecruiterScore(subjectId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { data: summaryData } = useQuery({
    queryKey: ["recruiter-kpi-summary", subjectId],
    queryFn: () => api.getRecruiterKpiSummary(subjectId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { data: kpiConfigData } = useQuery({
    queryKey: ["kpi-config"],
    queryFn: () => api.getKpiConfig(),
    staleTime: 60_000,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => api.recomputeRecruiterScore(subjectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recruiter-score", subjectId] });
      queryClient.invalidateQueries({ queryKey: ["recruiter-kpi-summary", subjectId] });
      toast.success("Recruiter score recomputed from live pipeline data");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to recompute score"),
  });

  if (scoreLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Loading evaluation…
      </div>
    );
  }
  if (scoreError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-destructive">
        Failed to load evaluation data.
      </div>
    );
  }

  const snapshot = scoreData?.snapshot ?? null;
  const metricSnapshots = scoreData?.metricSnapshots ?? [];
  const summary = summaryData?.summary ?? null;
  const kpiConfig = kpiConfigData?.kpiConfig ?? [];

  const configByKey = new Map<string, ApiKpiConfig>(kpiConfig.map((c) => [c.metricKey, c]));
  const groupOrder: string[] = [];
  for (const c of kpiConfig) {
    if (!groupOrder.includes(c.group)) groupOrder.push(c.group);
  }

  const score = snapshot?.overallScore ?? 0;
  const tone = toneForScore(score);
  const bandLabel = snapshot?.bandLabel ?? "No Data";

  return (
    <div className="space-y-5 text-foreground font-sans">
      {/* 1. Overall Score Hero Card */}
      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <ScoreRing score={score} size={80} />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Overall {roleLabel} Score
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">{subjectName}</h2>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone.cls}`}>
                  {bandLabel}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {snapshot
                  ? (snapshot.summary ?? tone.meaning)
                  : "No score computed yet — the first snapshot runs at the start of next month."}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => recomputeMutation.mutate()}
              disabled={recomputeMutation.isPending || isRefetching}
              className="text-xs gap-1.5 h-8 border-border bg-background hover:bg-muted/40 font-medium"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-primary ${recomputeMutation.isPending || isRefetching ? "animate-spin" : ""}`} />
              {recomputeMutation.isPending ? "Calculating…" : "Recalculate Score"}
            </Button>
          </div>
        </div>
      </section>

      {!snapshot && (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6 text-center text-xs text-muted-foreground">
          No monthly evaluation snapshot has been computed for {subjectName} yet. Scores are computed by a monthly
          job — check back after the next run.
        </div>
      )}

      {/* 2. KPI summary tiles (real ApiRecruiterKpiSummary fields — replaces the old mock's fabricated
           outreach/self-sourcing breakdown cards, which had no backend equivalent) */}
      {summary ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryTile label="Outreach effectiveness" value={summary.outreachEffectiveness} unit="pct" />
          <SummaryTile label="Response rate" value={summary.responseRate} unit="pct" />
          <SummaryTile label="SLA adherence" value={summary.slaAdherence} unit="pct" />
          <SummaryTile label="Outreach volume" value={summary.outreachVolume} unit="count" />
          <SummaryTile label="DNC %" value={summary.dncPct} unit="pct" />
          <SummaryTile label="Interview → offer" value={summary.interviewToOffer} unit="pct" />
          <SummaryTile label="Offer acceptance" value={summary.offerAcceptance} unit="pct" />
          <SummaryTile label="Profile quality" value={summary.profileQuality} unit="pct" />
          <SummaryTile label="Client satisfaction" value={summary.clientSatisfaction} unit="pct" />
          <SummaryTile label="AI adoption" value={summary.aiAdoption} unit="pct" />
          <SummaryTile label="Pipeline health" value={summary.pipelineHealth} unit="pct" />
          <SummaryTile label="Email open rate" value={summary.emailOpenRate} unit="pct" />
          <SummaryTile label="Avg. turnaround" value={summary.avgTurnaroundDays} unit="days" />
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6 text-center text-xs text-muted-foreground">
          No KPI summary computed yet for {subjectName}.
        </div>
      )}

      {/* 3. Grouped metric tables — groups are derived dynamically from kpi-config, not a fixed enum,
           since the real config is owner-editable. */}
      {groupOrder.map((group) => {
        const items = metricSnapshots.filter((m) => configByKey.get(m.metricKey)?.group === group);
        if (!items.length) return null;
        return (
          <GroupMetricSection
            key={group}
            group={group}
            items={items}
            configByKey={configByKey}
            isExpandable={isExpandable}
          />
        );
      })}
    </div>
  );
}

function SummaryTile({ label, value, unit }: { label: string; value: any; unit: "pct" | "count" | "days" }) {
  const num = typeof value === "number" ? value : parseFloat(String(value)) || 0;
  const display =
    unit === "pct" ? `${Math.round(num)}%` :
    unit === "days" ? (Number.isInteger(num) ? `${num}d` : `${num.toFixed(1)}d`) :
    `${num}`;
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-lg font-bold tabular-nums text-foreground">{display}</div>
    </div>
  );
}

function GroupMetricSection({
  group,
  items,
  configByKey,
  isExpandable,
}: {
  group: string;
  items: ApiRecruiterMetricSnapshot[];
  configByKey: Map<string, ApiKpiConfig>;
  isExpandable?: boolean;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all">
      <div
        className={`flex items-center justify-between ${
          isExpandable ? "cursor-pointer select-none" : ""
        }`}
        onClick={() => {
          if (isExpandable) setOpen((prev) => !prev);
        }}
      >
        <div className="flex items-center gap-2">
          {isExpandable && (
            <span className="text-accent">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          )}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-accent">{group}</h3>
            <p className="text-[11px] text-muted-foreground">{GROUP_BLURB[group] ?? "Tracked metrics for this category."}</p>
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">{items.length} metrics</span>
      </div>

      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse table-fixed">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 px-3 font-medium w-[40%] text-left">Metric</th>
                <th className="py-2.5 px-3 font-medium w-[30%] text-center">Target</th>
                <th className="py-2.5 px-3 font-medium w-[15%] text-right">Value</th>
                <th className="py-2.5 px-3 font-medium w-[15%] text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map((m) => {
                const cfg = configByKey.get(m.metricKey);
                return (
                  <tr key={m.metricKey} className="transition-colors hover:bg-muted/20">
                    <td className="py-3 px-3 font-semibold text-foreground truncate w-[40%] text-left">
                      <div className="flex items-center gap-1.5">
                        <span>{cfg?.label ?? m.metricKey}</span>
                        {cfg && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-muted-foreground hover:text-accent p-0.5 rounded transition-colors shrink-0">
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-3 text-xs space-y-1">
                              <div className="font-semibold text-foreground">{cfg.label}</div>
                              {cfg.notes && <div className="text-muted-foreground leading-normal">{cfg.notes}</div>}
                              {cfg.scored && cfg.weight !== null && (
                                <div className="text-[10px] text-accent font-medium pt-1">
                                  Weight in Rubric: {cfg.weight}%
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-muted-foreground text-[11px] w-[30%] text-center truncate">
                      {cfg?.target !== null && cfg?.target !== undefined
                        ? formatMetricValue(cfg.unit, cfg.target)
                        : cfg?.goodBand !== null && cfg?.goodBand !== undefined
                        ? `Good: ${formatMetricValue(cfg.unit, cfg.goodBand)}`
                        : "Signal only"}
                    </td>

                    <td className="py-3 px-3 text-right font-bold text-foreground text-sm tabular-nums w-[15%]">
                      {formatMetricValue(cfg?.unit, m.currentValue)}
                    </td>

                    <td className="py-3 px-3 text-right w-[15%]">
                      {statusChip(m.metricStatus)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
