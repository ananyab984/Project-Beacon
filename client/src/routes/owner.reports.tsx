import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Download, FileText, Clock, TrendingUp, Users, Radio, Sparkles, Eye, History, ChevronDown, ChevronRight, Info } from "lucide-react";
import { toast } from "sonner";
import { recruiters, useClientDemands, outreachBatch, teamKpis, aiDraftStats, useRequirements, useClients } from "@/lib/g3-mock";
import { RUBRIC, METRIC_GROUPS, formatValue, bandFor, getEvaluation } from "@/lib/evaluation";
import { FEATURES } from "@/lib/feature-flags";

export const Route = createFileRoute("/owner/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Global3" },
      { name: "description", content: "Performance metrics, analytics, live previews and exports for the Global3 recruitment engine." },
    ],
  }),
  component: ReportsPage,
});

interface ReportItem {
  id: string;
  name: string;
  type: "pdf" | "csv" | "log";
  range: string;
  generated: string;
}

const RECENT_REPORTS: ReportItem[] = [
  { id: "r0", name: "Assignment History & Activity Log", type: "log", range: "Real-time", generated: "live updated" },
  { id: "r1", name: "Weekly Recruiter Scorecard", type: "pdf", range: "Nov 11–17", generated: "generated today, 08:12" },
  { id: "r2", name: "Q4 Language Fill Analysis", type: "pdf", range: "Q4", generated: "generated 2d ago" },
  { id: "r3", name: "Leads Pipeline Export", type: "csv", range: "Last 30d", generated: "generated 3d ago" },
  { id: "r4", name: "Outreach Volume Trend", type: "csv", range: "Last 90d", generated: "generated last week" },
];

function ReportsPage() {
  const [range, setRange] = useState("30d");
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  const clientDemands = useClientDemands();
  const allReqs = useRequirements();
  const clients = useClients();

  const teamScores = useMemo(() => recruiters.map((r) => getEvaluation(r.id, r.name).score), []);
  const teamAvgScore = useMemo(
    () => Math.round(teamScores.reduce((a, b) => a + b, 0) / (teamScores.length || 1)),
    [teamScores],
  );
  const teamBand = useMemo(() => bandFor(teamAvgScore), [teamAvgScore]);

  const summary = useMemo(() => {
    const totalDemand = clientDemands.reduce((s, d) => s + d.headcount_needed, 0);
    const totalFilled = clientDemands.reduce((s, d) => s + d.filled, 0);
    const fill = totalDemand ? Math.round((totalFilled / totalDemand) * 100) : 0;
    const reachTotal =
      outreachBatch.contacted +
      outreachBatch.awaiting_reply +
      outreachBatch.replied +
      outreachBatch.in_negotiation +
      outreachBatch.dnc;
    return { totalDemand, totalFilled, fill, reachTotal };
  }, [clientDemands]);

  const timeSaved = useMemo(() => {
    const draftsGenerated = aiDraftStats.total_generated;
    const manualMinutesPerDraft = 12;
    const aiMinutesPerDraft = 3;
    const manualHours = Math.round((draftsGenerated * manualMinutesPerDraft) / 60);
    const aiHours = Math.round((draftsGenerated * aiMinutesPerDraft) / 60);
    const savedHours = Math.max(0, manualHours - aiHours);
    return { draftsGenerated, manualMinutesPerDraft, aiMinutesPerDraft, manualHours, aiHours, savedHours };
  }, []);

  const exportFile = (reportName: string, fmt: string) => {
    toast.success(`Exporting "${reportName}" as ${fmt.toUpperCase()} — download started.`);
  };

  const langBars = useMemo(() => {
    const map = new Map<string, { needed: number; filled: number }>();
    for (const d of clientDemands) {
      const cur = map.get(d.language) ?? { needed: 0, filled: 0 };
      map.set(d.language, { needed: cur.needed + d.headcount_needed, filled: cur.filled + d.filled });
    }
    return Array.from(map, ([language, v]) => ({ language, ...v })).sort((a, b) => b.needed - a.needed);
  }, [clientDemands]);

  const maxNeed = Math.max(...langBars.map((b) => b.needed), 1);
  const activeReport = RECENT_REPORTS.find((r) => r.id === previewReportId) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Reports &amp; Analytics</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Performance snapshot</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aggregate view of recruiter output, market fill and outreach signals.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="ytd">Year to date</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => exportFile("Full Analytics", "csv")}><Download className="h-4 w-4" /> CSV</Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => exportFile("Full Analytics", "pdf")}>
            <Download className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric icon={Radio} label="Outreach volume" value={summary.reachTotal.toLocaleString()} sub="+12% vs prior" />
        <Metric icon={Users} label="Active recruiters" value={String(recruiters.length)} sub={`${recruiters.filter(r => r.status === "healthy").length} healthy`} />
        <Metric icon={TrendingUp} label="Fill rate" value={`${summary.fill}%`} sub={`${summary.totalFilled}/${summary.totalDemand} seats`} />
        <Metric icon={Clock} label="Time saved" value={`${timeSaved.savedHours} hrs`} sub={`${timeSaved.draftsGenerated} drafts, 30d`} />
      </div>

      {/* Market Fill & Throughput Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="text-sm font-semibold">Demand vs. filled by language</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Top market demands.</div>
          <div className="mt-5 space-y-4">
            {langBars.slice(0, 6).map((b) => (
              <div key={b.language}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{b.language}</span>
                  <span className="tabular-nums text-muted-foreground">{b.filled}/{b.needed}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="relative h-full">
                    <div className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: `${(b.needed / maxNeed) * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(b.filled / maxNeed) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="text-sm font-semibold">Recruiter throughput</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Onboarded leads in range.</div>
          <div className="mt-5 space-y-4">
            {recruiters.slice(0, 6).map((r) => {
              const max = Math.max(...recruiters.map((x) => x.leads_onboarded), 1);
              return (
                <div key={r.id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{r.name}</span>
                    <span className="tabular-nums">{r.leads_onboarded}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${(r.leads_onboarded / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Recent Generated Reports Section with Live Preview & Download */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-sm font-semibold">Recent reports</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Auto-generated system reports, assignment activity logs, and exports.</div>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {RECENT_REPORTS.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-muted/20">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent shrink-0">
                  {r.type === "log" ? <History className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.range} · <span className="uppercase font-semibold">{r.type}</span> · {r.generated}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs bg-card hover:bg-accent/10 hover:text-accent"
                  onClick={() => setPreviewReportId(r.id)}
                >
                  <Eye className="h-3.5 w-3.5 text-accent" /> Preview
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs hover:bg-accent/10 hover:text-accent"
                  onClick={() => exportFile(r.name, r.type)}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Evaluation Framework Section */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-4">
          <div>
            <div className="text-sm font-semibold">Project Beacon evaluation framework</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Scored core and watched metrics that roll up into each recruiter's performance evaluation.
            </div>
          </div>
          <Badge variant="outline" className="border-accent/30 text-accent font-medium">
            Team score {teamAvgScore}/100 · {teamBand.label}
          </Badge>
        </div>

        <div className="p-6 space-y-4">
          {METRIC_GROUPS.map((group) => {
            const groupMetrics = RUBRIC.filter((m) => m.group === group);
            if (!groupMetrics.length) return null;
            return (
              <ExpandableMetricCategory
                key={group}
                group={group}
                groupMetrics={groupMetrics}
                recruiters={recruiters}
              />
            );
          })}
        </div>
      </section>

      {/* Frontend Report Preview Dialog */}
      <Dialog open={!!activeReport} onOpenChange={(o) => !o && setPreviewReportId(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {activeReport && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <DialogTitle className="text-base font-semibold flex items-center gap-2">
                      <FileText className="h-4 w-4 text-accent" />
                      Report Preview: {activeReport.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      Formatted document preview before export · {activeReport.range} · Author: Sundar (Owner)
                    </DialogDescription>
                  </div>
                  <Badge variant="outline" className="uppercase text-xs font-bold border-accent/40 text-accent">
                    {activeReport.type}
                  </Badge>
                </div>
              </DialogHeader>

              {/* Render rich document preview based on report ID */}
              <div className="mt-3 rounded-2xl border border-border bg-card p-5 space-y-4 font-sans text-xs">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <div className="text-sm font-bold text-foreground">GLOBAL3 RECRUITMENT ENGINE</div>
                    <div className="text-[11px] text-muted-foreground">{activeReport.name}</div>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <div>Range: {activeReport.range}</div>
                    <div>Status: Verified &amp; Synced</div>
                  </div>
                </div>

                {/* Report Content Switch */}
                {activeReport.id === "r0" && (
                  <AssignmentAuditLogPreview allReqs={allReqs} clients={clients} />
                )}
                {activeReport.id === "r1" && <RecruiterScorecardPreview recruiters={recruiters} />}
                {activeReport.id === "r2" && <LanguageFillAnalysisPreview clientDemands={clientDemands} />}
                {activeReport.id === "r3" && <LeadsPipelinePreview />}
                {activeReport.id === "r4" && <OutreachVolumePreview recruiters={recruiters} />}
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewReportId(null)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
                  onClick={() => {
                    exportFile(activeReport.name, activeReport.type);
                    setPreviewReportId(null);
                  }}
                >
                  <Download className="h-4 w-4" /> Download Report ({activeReport.type.toUpperCase()})
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Preview Component Renderers ─────────────────────────────────────────────

function AssignmentAuditLogPreview({ allReqs, clients }: { allReqs: ReturnType<typeof useRequirements>; clients: ReturnType<typeof useClients> }) {
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);

  const logEntries = useMemo(() => {
    const entries: Array<{
      title: string;
      language: string;
      service: string;
      clientName: string;
      recruiter_id: string;
      assigned_at: string;
      assigned_by: string;
      note?: string;
    }> = [];

    for (const req of allReqs) {
      for (const entry of req.assignment_history) {
        entries.push({
          title: req.title,
          language: req.language,
          service: req.service,
          clientName: clientMap[req.client_id] ?? "Unknown Client",
          ...entry,
        });
      }
    }
    return entries.sort((a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime());
  }, [allReqs, clientMap]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">Chronological Recruiter Assignment Audit Log</span>
        <span className="text-muted-foreground">{logEntries.length} total entries recorded</span>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border/80 bg-muted/10 overflow-hidden text-xs">
        {logEntries.map((entry, idx) => {
          const recruiter = recruiters.find((r) => r.id === entry.recruiter_id);
          return (
            <div key={idx} className="flex items-center justify-between p-3 transition-colors hover:bg-muted/30">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: `oklch(0.55 0.18 ${recruiter?.avatar_hue ?? 220}deg)` }}
                >
                  {recruiter?.name?.[0] ?? "?"}
                </div>
                <div>
                  <div className="font-medium text-foreground">
                    <span className="font-semibold">{recruiter?.name ?? "Unknown"}</span>
                    <span className="text-muted-foreground"> assigned to </span>
                    <span className="font-semibold">{entry.title}</span>
                    <span className="text-muted-foreground"> ({entry.clientName})</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Assigned by {entry.assigned_by} {entry.note ? `· "${entry.note}"` : ""}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-right shrink-0">
                <span className="rounded-md bg-accent/12 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {entry.language} — {entry.service}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {new Date(entry.assigned_at).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecruiterScorecardPreview({ recruiters: list }: { recruiters: typeof recruiters }) {
  return (
    <div className="space-y-3">
      <div className="font-semibold text-foreground">Recruiter Scorecard &amp; SLA Breakdown</div>
      <table className="w-full text-left text-xs border border-border rounded-lg overflow-hidden">
        <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="p-2.5">Recruiter</th>
            <th className="p-2.5">Status</th>
            <th className="p-2.5 text-right">Score</th>
            <th className="p-2.5 text-right">Outreach</th>
            <th className="p-2.5 text-right">SLA Adherence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {list.map((r) => (
            <tr key={r.id}>
              <td className="p-2.5 font-medium">{r.name}</td>
              <td className="p-2.5 text-muted-foreground">{r.status}</td>
              <td className="p-2.5 text-right font-bold text-accent">{r.kpis.overall_score}%</td>
              <td className="p-2.5 text-right tabular-nums">{r.kpis.outreach_volume}</td>
              <td className="p-2.5 text-right tabular-nums">{r.kpis.sla_adherence}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LanguageFillAnalysisPreview({ clientDemands }: { clientDemands: ReturnType<typeof useClientDemands> }) {
  return (
    <div className="space-y-3">
      <div className="font-semibold text-foreground">Language Demand &amp; Headcount Fill Rate</div>
      <table className="w-full text-left text-xs border border-border rounded-lg overflow-hidden">
        <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="p-2.5">Client</th>
            <th className="p-2.5">Languages</th>
            <th className="p-2.5 text-right">Needed</th>
            <th className="p-2.5 text-right">Filled</th>
            <th className="p-2.5 text-right">Gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {clientDemands.map((d) => (
            <tr key={d.id}>
              <td className="p-2.5 font-medium">{d.client}</td>
              <td className="p-2.5 text-accent font-medium">{d.language}</td>
              <td className="p-2.5 text-right tabular-nums">{d.headcount_needed}</td>
              <td className="p-2.5 text-right tabular-nums">{d.filled}</td>
              <td className="p-2.5 text-right tabular-nums font-semibold text-warning">{d.gap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeadsPipelinePreview() {
  return (
    <div className="space-y-3">
      <div className="font-semibold text-foreground">Candidate Pool &amp; Outreach Stage Summary</div>
      <div className="grid grid-cols-4 gap-3 text-center">
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Total Contacted</div>
          <div className="text-xl font-bold text-foreground">412</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Awaiting Reply</div>
          <div className="text-xl font-bold text-warning">142</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] text-muted-foreground uppercase">In Negotiation</div>
          <div className="text-xl font-bold text-accent">88</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Onboarded</div>
          <div className="text-xl font-bold text-primary">64</div>
        </div>
      </div>
    </div>
  );
}

function OutreachVolumePreview({ recruiters: list }: { recruiters: typeof recruiters }) {
  return (
    <div className="space-y-3">
      <div className="font-semibold text-foreground">Outreach Volume &amp; Response Trends</div>
      <table className="w-full text-left text-xs border border-border rounded-lg overflow-hidden">
        <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="p-2.5">Recruiter</th>
            <th className="p-2.5 text-right">Volume</th>
            <th className="p-2.5 text-right">Reply Rate</th>
            <th className="p-2.5 text-right">Read Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {list.map((r) => (
            <tr key={r.id}>
              <td className="p-2.5 font-medium">{r.name}</td>
              <td className="p-2.5 text-right tabular-nums">{r.kpis.outreach_volume}</td>
              <td className="p-2.5 text-right tabular-nums text-accent font-semibold">{Math.round(r.reply_rate * 100)}%</td>
              <td className="p-2.5 text-right tabular-nums">{Math.round(r.read_rate * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpandableMetricCategory({
  group,
  groupMetrics,
  recruiters,
}: {
  group: string;
  groupMetrics: typeof RUBRIC;
  recruiters: any[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border/80 bg-background/50 overflow-hidden transition-colors">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between p-4 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      >
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-accent">{group}</div>
          <div className="text-[11px] text-muted-foreground">{groupMetrics.length} metrics defined</div>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-accent" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-border/40 border-t border-border/60 p-2 space-y-1">
          {groupMetrics.map((def) => {
            const values = recruiters.map((r) => {
              const ev = getEvaluation(r.id, r.name);
              const snap = ev.metrics.find((x) => x.def.id === def.id);
              return snap ? snap.current : 0;
            });
            const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
            const display = formatValue(def.unit, avg);

            return (
              <div
                key={def.id}
                className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_180px_110px] sm:items-center sm:gap-4 text-xs transition-colors hover:bg-muted/20 rounded-lg"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{def.label}</span>
                    {def.scored && (
                      <span className="rounded bg-accent/10 text-accent px-1.5 py-0.5 text-[10px] font-medium">
                        weight {def.weight}%
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{def.definition}</div>
                </div>

                <div className="text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Target</div>
                  <div>{def.target !== null ? formatValue(def.unit, def.target) : def.targetLabel}</div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Team Avg</div>
                  <div className="text-base font-bold tabular-nums text-foreground">{display}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      <div className="mt-4 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function DraftStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}