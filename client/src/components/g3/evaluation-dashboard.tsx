// Full recruiter evaluation dashboard — Project Beacon rubric.
// Styled strictly to match the Project Beacon Rubric layout specification in clean tabular form with fixed column alignments.
import { useState } from "react";
import { Info, ChevronDown, ChevronRight } from "lucide-react";
import {
  METRIC_GROUPS, formatValue, getEvaluation,
  type Evaluation, type MetricGroup, type MetricSnapshot,
} from "@/lib/evaluation";
import { ScoreRing } from "@/components/g3/kpi";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  const evalData = getEvaluation(subjectId, subjectName);
  return <EvaluationBody data={evalData} roleLabel={roleLabel} isExpandable={isExpandable} />;
}

function EvaluationBody({
  data,
  roleLabel,
  isExpandable,
}: {
  data: Evaluation;
  roleLabel: string;
  isExpandable?: boolean;
}) {
  const bandTone =
    data.band.tone === "positive" ? "bg-accent/15 text-accent border-accent/30" :
    data.band.tone === "warning" ? "bg-warning/15 text-warning border-warning/30" :
    data.band.tone === "critical" ? "bg-destructive/15 text-destructive border-destructive/30" :
    "bg-primary/15 text-primary border-primary/30";

  return (
    <div className="space-y-5 text-foreground font-sans">
      {/* 1. Overall Recruiter Score Hero Card */}
      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
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
        <div className="rounded-2xl border border-border/80 bg-card p-5 space-y-4 shadow-sm">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">Outreach Volume</div>
            <div className="mt-1 text-base font-bold text-foreground">Outreach vs assigned target</div>

            <div className="mt-4 grid grid-cols-4 gap-2 text-center border-t border-border/60 pt-4">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Outreach Vol.</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{data.outreach.completed}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Assigned</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{data.outreach.assigned}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Target Met</div>
                <div className="mt-1 text-xl font-bold text-accent">{data.outreach.targetAchieved ? "Yes" : "No"}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">% Completed</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{data.outreach.achievedPct}%</div>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Proactive Sourcing */}
        <div className="rounded-2xl border border-border/80 bg-card p-5 space-y-4 shadow-sm">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">Proactive Sourcing</div>
            <div className="mt-1 text-base font-bold text-foreground">Assigned vs self-sourced · {data.sourcing.ratioLabel}</div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center border-t border-border/60 pt-4">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Assigned Leads</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{data.sourcing.assigned}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Self-Sourced</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{data.sourcing.selfSourced}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Sourcing Ratio</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-accent">{data.sourcing.ratioLabel}</div>
              </div>
            </div>

            <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full">
              <div className="h-full bg-warning" style={{ width: `${100 - data.sourcing.selfPct}%` }} />
              <div className="h-full bg-accent" style={{ width: `${data.sourcing.selfPct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>Assigned {100 - data.sourcing.selfPct}%</span>
              <span>Self-sourced {data.sourcing.selfPct}%</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Grouped Metric Tables (Clean Tabular Form with fixed column alignments) */}
      {METRIC_GROUPS.map((group) => {
        const items = data.metrics.filter((m) => m.def.group === group);
        if (!items.length) return null;
        return (
          <GroupMetricSection
            key={group}
            group={group}
            items={items}
            isExpandable={isExpandable}
          />
        );
      })}
    </div>
  );
}

function GroupMetricSection({
  group,
  items,
  isExpandable,
}: {
  group: MetricGroup;
  items: MetricSnapshot[];
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
            <p className="text-[11px] text-muted-foreground">{GROUP_BLURB[group]}</p>
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
                return (
                  <tr key={m.def.id} className="transition-colors hover:bg-muted/20">
                    <td className="py-3 px-3 font-semibold text-foreground truncate w-[40%] text-left">
                      <div className="flex items-center gap-1.5">
                        <span>{m.def.label}</span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-muted-foreground hover:text-accent p-0.5 rounded transition-colors shrink-0">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64 p-3 text-xs space-y-1">
                            <div className="font-semibold text-foreground">{m.def.label}</div>
                            <div className="text-muted-foreground leading-normal">{m.def.definition}</div>
                            {m.def.scored && (
                              <div className="text-[10px] text-accent font-medium pt-1">
                                Weight in Rubric: {m.def.weight}%
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-muted-foreground text-[11px] w-[30%] text-center truncate">
                      {m.def.target !== null ? formatValue(m.def.unit, m.def.target) : m.def.targetLabel}
                    </td>

                    <td className="py-3 px-3 text-right font-bold text-foreground text-sm tabular-nums w-[15%]">
                      {formatValue(m.def.unit, m.current)}
                    </td>

                    <td className="py-3 px-3 text-right w-[15%]">
                      {statusChip(m.status)}
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