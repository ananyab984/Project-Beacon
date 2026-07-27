// Full recruiter evaluation dashboard — Project Beacon rubric.
// Shared by the recruiter self-view, the contractor view and the owner view.
import { Fragment } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowRight, Minus, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import {
  METRIC_GROUPS, MONTHS, formatValue, getEvaluation,
  type Evaluation, type MetricGroup, type MetricSnapshot, type TrendDir,
} from "@/lib/evaluation";
import { ScoreRing } from "@/components/g3/kpi";
import { useAiFeature } from "@/lib/feature-flags";

const GROUP_BLURB: Record<MetricGroup, string> = {
  "Activity & Effort": "Volume and persistence of recruiter-initiated work.",
  "Responsiveness": "How fast leads get a first and an urgent reply.",
  "Ownership & Follow-through": "Whether leads move forward and get properly closed.",
  "Outcome Metrics": "Watched, not weighted — these depend heavily on candidate decisions.",
  "Additional Business Metrics": "Nice-to-have manual effort tracked alongside the scored core.",
};

function statusChip(status: MetricSnapshot["status"]) {
  const map = {
    on_track: { c: "bg-accent/15 text-accent", t: "On track" },
    watch: { c: "bg-warning/15 text-warning", t: "Watch" },
    off_track: { c: "bg-destructive/15 text-destructive", t: "Off track" },
    signal: { c: "bg-muted text-muted-foreground", t: "Signal only" },
  }[status];
  return <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${map.c}`}>{map.t}</span>;
}

function TrendBadge({ trend, changePct }: { trend: TrendDir; changePct: number | null }) {
  if (trend === "new") return <span className="text-[10px] text-muted-foreground">No baseline yet</span>;
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const tone = trend === "up" ? "text-accent" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium tabular-nums ${tone}`}>
      <Icon className="h-3 w-3" />
      {changePct === null ? "—" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(0)}%`}
    </span>
  );
}

function Sparkline({ history, tone }: { history: number[]; tone: string }) {
  const data = history.map((v, i) => ({ i, v }));
  return (
    <div className="h-9 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area type="monotone" dataKey="v" stroke={tone} fill={tone} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProgressBar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: tone }} />
    </div>
  );
}

const tooltipStyle = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: 10, fontSize: 12, color: "var(--foreground)",
};

export function EvaluationDashboard({
  subjectId, subjectName, roleLabel = "Recruiter",
}: { subjectId: string; subjectName: string; roleLabel?: string }) {
  const evalData = getEvaluation(subjectId, subjectName);
  return <EvaluationBody data={evalData} roleLabel={roleLabel} />;
}

function EvaluationBody({ data, roleLabel }: { data: Evaluation; roleLabel: string }) {
  const [ai] = useAiFeature();
  const delta = data.score - data.previousScore;
  const bandTone =
    data.band.tone === "positive" ? "bg-accent/15 text-accent" :
    data.band.tone === "warning" ? "bg-warning/15 text-warning" :
    data.band.tone === "critical" ? "bg-destructive/15 text-destructive" :
    "bg-primary/15 text-primary";

  const scored = data.metrics.filter((m) => m.def.scored);
  const targetVsActual = scored
    .filter((m) => m.def.target !== null)
    .map((m) => ({ name: m.def.label.split(" (")[0], actual: m.current, target: m.def.target as number, status: m.status }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-accent/5 via-primary/5 to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-widest text-accent">
              {roleLabel} performance evaluation
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{data.subjectName}</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Project Beacon rubric · 9 scored metrics, 2 watched outcomes, plus additional business metrics.
              Evaluation period: {MONTHS[MONTHS.length - 1]} (rolling monthly).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${bandTone}`}>
                {data.band.label} band · {data.band.meaning}
              </span>
              <span className="rounded-md bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground tabular-nums">
                {delta === 0 ? "Flat" : delta > 0 ? `+${delta}` : delta} vs previous month ({data.previousScore})
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <ScoreRing score={data.score} size={96} label="Overall performance score" />
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Outreach vs assigned */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Outreach vs assigned target</div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{data.outreach.completed}</span>
            <span className="text-sm text-muted-foreground">/ {data.outreach.assigned} assigned resources</span>
          </div>
          <div className="mt-3"><ProgressBar pct={data.outreach.achievedPct} tone={data.outreach.achievedPct >= 90 ? "var(--accent)" : "var(--warning)"} /></div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-[11px]">
            <dt className="text-muted-foreground">Outreach volume</dt>
            <dd className="text-right font-semibold tabular-nums">{data.outreach.completed}</dd>
            <dt className="text-muted-foreground">Assigned resources</dt>
            <dd className="text-right font-semibold tabular-nums">{data.outreach.assigned}</dd>
            <dt className="text-muted-foreground">Percentage completed</dt>
            <dd className="text-right font-semibold tabular-nums">{data.outreach.achievedPct}%</dd>
            <dt className="text-muted-foreground">Target achieved</dt>
            <dd className={`text-right font-semibold ${data.outreach.targetAchieved ? "text-accent" : "text-warning"}`}>
              {data.outreach.targetAchieved ? "Yes" : "No"}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-right font-semibold">{data.outreach.statusLabel}</dd>
          </dl>
          <div className="mt-3 h-20">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.outreach.history} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="assigned" name="Assigned" fill="color-mix(in oklab, var(--primary) 25%, var(--muted))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="completed" name="Outreach" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Proactive sourcing ratio */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Proactive sourcing ratio</div>
            <TrendBadge trend={data.sourcing.trend} changePct={null} />
          </div>
          <div className="mt-3 text-3xl font-semibold tabular-nums">{data.sourcing.ratioLabel}</div>
          <div className="text-[11px] text-muted-foreground">assigned : self-sourced</div>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full">
            <div className="h-full" style={{ width: `${100 - data.sourcing.selfPct}%`, background: "color-mix(in oklab, var(--primary) 35%, var(--muted))" }} />
            <div className="h-full" style={{ width: `${data.sourcing.selfPct}%`, background: "var(--accent)" }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-[11px]">
            <dt className="text-muted-foreground">Assigned leads</dt>
            <dd className="text-right font-semibold tabular-nums">{data.sourcing.assigned}</dd>
            <dt className="text-muted-foreground">Self-sourced leads</dt>
            <dd className="text-right font-semibold tabular-nums">{data.sourcing.selfSourced}</dd>
            <dt className="text-muted-foreground">Self-sourced share</dt>
            <dd className="text-right font-semibold tabular-nums">{data.sourcing.selfPct}%</dd>
          </dl>
          <div className="mt-3 h-20">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.sourcing.history} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, "Self-sourced share"]} />
                <Line type="monotone" dataKey="ratio" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Goal progress */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Goal progress</div>
          <div className="mt-4 space-y-3">
            {scored.filter((m) => m.def.target !== null).map((m) => {
              const pct = m.def.direction === "higher"
                ? (m.current / (m.def.target as number)) * 100
                : ((m.def.target as number) + 1) / (m.current + 1) * 100;
              const tone = m.status === "on_track" ? "var(--accent)" : m.status === "watch" ? "var(--warning)" : "var(--destructive)";
              return (
                <div key={m.def.id}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="truncate pr-2">{m.def.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatValue(m.def.unit, m.current)} / {formatValue(m.def.unit, m.def.target as number)}
                    </span>
                  </div>
                  <div className="mt-1"><ProgressBar pct={pct} tone={tone} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Monthly trend + target vs actual */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-[11px] uppercase tracking-widest text-primary">Monthly trend</div>
          <h3 className="mt-1 text-lg font-semibold">Overall score — last 6 months</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.scoreHistory} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={{ stroke: "var(--border)" }} stroke="var(--muted-foreground)" />
                <YAxis domain={[(min: number) => Math.max(0, Math.floor(min - 6)), (max: number) => Math.min(100, Math.ceil(max + 6))]} width={32} fontSize={12} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="score" name="Score" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Trend rule: baseline = average of the previous 3 months. Above +15% is Up, below −15% is Down.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-[11px] uppercase tracking-widest text-primary">Target vs actual</div>
          <h3 className="mt-1 text-lg font-semibold">This month against rubric targets</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={targetVsActual} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="26%">
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" fontSize={10} tickLine={false} interval={0} angle={-18} textAnchor="end" height={58} stroke="var(--muted-foreground)" />
                <YAxis width={32} fontSize={12} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Bar dataKey="target" name="Target" fill="color-mix(in oklab, var(--primary) 22%, var(--muted))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]}>
                  {targetVsActual.map((d, i) => (
                    <Cell key={i} fill={d.status === "on_track" ? "var(--accent)" : d.status === "watch" ? "var(--warning)" : "var(--destructive)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Strengths / attention */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
          <h3 className="text-sm font-semibold text-accent">Best performing metrics</h3>
          <ul className="mt-3 space-y-2">
            {data.strengths.map((m) => (
              <li key={m.def.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m.def.label}</div>
                  <div className="text-[11px] text-muted-foreground">{m.def.targetLabel}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{formatValue(m.def.unit, m.current)}</div>
                  <TrendBadge trend={m.trend} changePct={m.changePct} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <h3 className="text-sm font-semibold text-warning">Needs attention</h3>
          {data.attention.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">Every scored metric is at or above target this month.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.attention.map((m) => (
                <li key={m.def.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{m.def.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Target {m.def.target !== null ? formatValue(m.def.unit, m.def.target) : m.def.targetLabel}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{formatValue(m.def.unit, m.current)}</div>
                    <TrendBadge trend={m.trend} changePct={m.changePct} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* AI summary placeholder */}
      {ai && (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" /> AI performance summary
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{data.summary}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Placeholder narrative generated from rubric values — not yet model-generated.</p>
        </section>
      )}

      {/* Grouped metric sections */}
      {METRIC_GROUPS.map((group) => {
        const items = data.metrics.filter((m) => m.def.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">{group}</h3>
              <p className="text-[11px] text-muted-foreground">{GROUP_BLURB[group]}</p>
            </div>
            <div className="mt-4 space-y-3">
              {items.map((m) => {
                const tone = m.status === "on_track" ? "var(--accent)" : m.status === "watch" ? "var(--warning)" : m.status === "off_track" ? "var(--destructive)" : "var(--primary)";
                return (
                  <div key={m.def.id} className="rounded-xl border border-border/70 bg-background/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[220px] flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{m.def.label}</span>
                          {statusChip(m.status)}
                          {m.def.scored && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">weight {m.def.weight}%</span>}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{m.def.definition}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/80">{m.def.calculation}</p>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current</div>
                          <div className="text-xl font-semibold tabular-nums" style={{ color: tone }}>{formatValue(m.def.unit, m.current)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Target</div>
                          <div className="text-xs font-medium">{m.def.target !== null ? formatValue(m.def.unit, m.def.target) : "—"}</div>
                          <div className="text-[10px] text-muted-foreground">{m.def.targetLabel}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Trend</div>
                          <TrendBadge trend={m.trend} changePct={m.changePct} />
                        </div>
                        <Sparkline history={m.history} tone={tone} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <ProgressBar pct={m.normalized} tone={tone} />
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{m.normalized}/100</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="uppercase tracking-widest">History</span>
                      {m.history.map((v, i) => (
                        <Fragment key={i}>
                          <span className="tabular-nums">
                            {MONTHS[i]} <span className="font-semibold text-foreground">{formatValue(m.def.unit, v)}</span>
                          </span>
                          {i < m.history.length - 1 && <ArrowRight className="h-2.5 w-2.5" />}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Monthly history table */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Monthly history</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Metric</th>
                {MONTHS.map((m) => <th key={m} className="px-2 py-2 text-right font-medium">{m}</th>)}
                <th className="pl-3 py-2 text-right font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60 bg-muted/20">
                <td className="py-2 pr-3 font-semibold">Overall score</td>
                {data.scoreHistory.map((s) => <td key={s.month} className="px-2 py-2 text-right font-semibold tabular-nums">{s.score}</td>)}
                <td className="pl-3 py-2 text-right">—</td>
              </tr>
              {data.metrics.map((m) => (
                <tr key={m.def.id} className="border-b border-border/40 last:border-0">
                  <td className="py-2 pr-3">{m.def.label}</td>
                  {m.history.map((v, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums text-muted-foreground">{formatValue(m.def.unit, v)}</td>
                  ))}
                  <td className="pl-3 py-2 text-right"><TrendBadge trend={m.trend} changePct={m.changePct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}