// Full recruiter evaluation dashboard — Project Beacon rubric.
// Styled strictly to match the Project Beacon Rubric layout specification.
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  METRIC_GROUPS, MONTHS, formatValue, getEvaluation,
  type Evaluation, type MetricGroup, type MetricSnapshot, type TrendDir,
} from "@/lib/evaluation";
import { ScoreRing } from "@/components/g3/kpi";

const GROUP_BLURB: Record<MetricGroup, string> = {
  "Activity & Effort": "Volume and persistence of recruiter-initiated work.",
  "Responsiveness": "How fast leads get a first and an urgent reply.",
  "Ownership & Follow-through": "Whether leads move forward and get properly closed.",
  "Outcome Metrics": "Watched, not weighted — these depend heavily on candidate decisions.",
  "Additional Business Metrics": "Nice-to-have manual effort tracked alongside the scored core.",
};

function statusChip(status: MetricSnapshot["status"]) {
  const map = {
    on_track: { c: "bg-accent/15 text-accent border border-accent/30", t: "On track" },
    watch: { c: "bg-warning/15 text-warning border border-warning/30", t: "Watch" },
    off_track: { c: "bg-destructive/15 text-destructive border border-destructive/30", t: "Off track" },
    signal: { c: "bg-muted text-muted-foreground border border-border", t: "Signal only" },
  }[status];
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${map.c}`}>{map.t}</span>;
}

function TrendBadge({ trend, changePct }: { trend: TrendDir; changePct: number | null }) {
  if (trend === "new") return <span className="text-[10px] text-muted-foreground">No baseline</span>;
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const tone = trend === "up" ? "text-accent" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>
      <Icon className="h-3 w-3" />
      {changePct === null ? "0%" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%`}
    </span>
  );
}

function Sparkline({ history, tone }: { history: number[]; tone: string }) {
  const data = history.map((v, i) => ({ i, v }));
  return (
    <div className="h-7 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area type="monotone" dataKey="v" stroke={tone} fill={tone} fillOpacity={0.12} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 11, color: "var(--foreground)",
};

export function EvaluationDashboard({
  subjectId, subjectName, roleLabel = "Recruiter",
}: { subjectId: string; subjectName: string; roleLabel?: string }) {
  const evalData = getEvaluation(subjectId, subjectName);
  return <EvaluationBody data={evalData} roleLabel={roleLabel} />;
}

function EvaluationBody({ data }: { data: Evaluation; roleLabel: string }) {
  const bandTone =
    data.band.tone === "positive" ? "bg-accent/15 text-accent border-accent/30" :
    data.band.tone === "warning" ? "bg-warning/15 text-warning border-warning/30" :
    data.band.tone === "critical" ? "bg-destructive/15 text-destructive border-destructive/30" :
    "bg-primary/15 text-primary border-primary/30";

  // Mock monthly trends for highlight cards
  const outreachTrend = [
    { month: "Feb", val: "58/46", pct: 100 },
    { month: "Mar", val: "56/46", pct: 96 },
    { month: "Apr", val: "57/46", pct: 98 },
    { month: "May", val: "56/46", pct: 96 },
    { month: "Jun", val: "60/46", pct: 100 },
    { month: "Jul", val: "58/46", pct: 100 },
  ];

  const sourcingTrend = [
    { month: "Mar", pct: 24 },
    { month: "Apr", pct: 26 },
    { month: "May", pct: 27 },
    { month: "Jun", pct: 29 },
    { month: "Jul", pct: 30 },
  ];

  return (
    <div className="space-y-5 text-foreground font-sans">
      {/* 1. Header Hero Card */}
      <section className="rounded-2xl border border-border/80 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <ScoreRing score={data.score} size={80} />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Overall Recruiter Score
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">{data.subjectName}</h2>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${bandTone}`}>
                  {data.band.label}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{data.band.meaning}</div>
            </div>
          </div>

        </div>
      </section>

      {/* 2. Highlight Cards (Outreach Volume & Proactive Sourcing) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Card 1: Outreach Volume */}
        <div className="rounded-2xl border border-border/80 bg-card p-5 flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">Outreach Volume</div>
            <h3 className="mt-0.5 text-base font-semibold">Outreach vs assigned target</h3>
            <p className="text-[11px] text-muted-foreground">One outreach per assigned resource is the monthly bar.</p>

            <div className="mt-4 grid grid-cols-4 gap-2 border-y border-border/60 py-3 text-left">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Outreach Volume</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.outreach.completed}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Assigned Resources</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.outreach.assigned}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Target Met</div>
                <div className={`mt-1 text-lg font-bold ${data.outreach.targetAchieved ? "text-accent" : "text-warning"}`}>
                  {data.outreach.targetAchieved ? "Yes" : "No"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">% Completed</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.outreach.achievedPct}%</div>
              </div>
            </div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, data.outreach.achievedPct)}%` }} />
            </div>
          </div>

          <div className="mt-4">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Monthly Trend</div>
            <div className="space-y-1.5">
              {outreachTrend.map((row) => (
                <div key={row.month} className="flex items-center text-[11px] tabular-nums">
                  <span className="w-8 text-muted-foreground">{row.month}</span>
                  <div className="flex-1 px-2">
                    <div className="h-1.5 rounded-full bg-accent/40" style={{ width: `${row.pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-muted-foreground">{row.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: Proactive Sourcing */}
        <div className="rounded-2xl border border-border/80 bg-card p-5 flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">Proactive Sourcing</div>
            <h3 className="mt-0.5 text-base font-semibold">Assigned vs self-sourced · {data.sourcing.ratioLabel}</h3>
            <p className="text-[11px] text-muted-foreground">Share of pipeline the recruiter created themselves.</p>

            <div className="mt-4 grid grid-cols-3 gap-2 border-y border-border/60 py-3 text-left">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Assigned Leads</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.sourcing.assigned}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Self-Sourced Leads</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.sourcing.selfSourced}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Sourcing Ratio</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-accent">{data.sourcing.ratioLabel}</div>
              </div>
            </div>

            <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full">
              <div className="h-full bg-warning" style={{ width: `${100 - data.sourcing.selfPct}%` }} />
              <div className="h-full bg-accent" style={{ width: `${data.sourcing.selfPct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
              <span>Assigned {100 - data.sourcing.selfPct}%</span>
              <span>Self-sourced {data.sourcing.selfPct}%</span>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Monthly Trend - Self-Sourced Share
            </div>
            <div className="space-y-1.5">
              {sourcingTrend.map((row) => (
                <div key={row.month} className="flex items-center text-[11px] tabular-nums">
                  <span className="w-8 text-muted-foreground">{row.month}</span>
                  <div className="flex-1 px-2">
                    <div className="h-1.5 rounded-full bg-accent/60" style={{ width: `${row.pct * 2.5}%` }} />
                  </div>
                  <span className="w-10 text-right text-muted-foreground">{row.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Grouped Metric Tables */}
      {METRIC_GROUPS.map((group) => {
        const items = data.metrics.filter((m) => m.def.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className="overflow-hidden rounded-2xl border border-border/80 bg-card p-5">
            <div className="mb-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-accent">{group}</h3>
              <p className="text-[11px] text-muted-foreground">{GROUP_BLURB[group]}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 px-3 font-medium">Metric</th>
                    <th className="py-2.5 px-3 font-medium">What it measures</th>
                    <th className="py-2.5 px-3 font-medium">Target</th>
                    <th className="py-2.5 px-3 font-medium text-right">Weight</th>
                    <th className="py-2.5 px-3 font-medium text-right">Value</th>
                    <th className="py-2.5 px-3 font-medium text-right">Trend</th>
                    <th className="py-2.5 px-3 font-medium text-center">6-Month</th>
                    <th className="py-2.5 px-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {items.map((m) => {
                    const tone = m.status === "on_track" ? "var(--accent)" : m.status === "watch" ? "var(--warning)" : m.status === "off_track" ? "var(--destructive)" : "var(--primary)";
                    return (
                      <tr key={m.def.id} className="transition-colors hover:bg-muted/20">
                        <td className="py-3 px-3 font-semibold text-foreground whitespace-nowrap">
                          {m.def.label}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground text-[11px] max-w-xs leading-normal">
                          {m.def.definition}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground text-[11px] whitespace-nowrap">
                          {m.def.target !== null ? formatValue(m.def.unit, m.def.target) : m.def.targetLabel}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-muted-foreground tabular-nums">
                          {m.def.scored ? `${m.def.weight}%` : "—"}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-foreground text-sm tabular-nums">
                          {formatValue(m.def.unit, m.current)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <TrendBadge trend={m.trend} changePct={m.changePct} />
                        </td>
                        <td className="py-3 px-3 align-middle">
                          <div className="flex justify-center">
                            <Sparkline history={m.history} tone={tone} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {statusChip(m.status)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}