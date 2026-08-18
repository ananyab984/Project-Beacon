import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Download, FileText, Clock, TrendingUp, Users, Radio, Eye, History, ChevronDown, ChevronRight, CheckCircle2, ShieldCheck, Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ApiReportsAnalytics, ApiRecentReport, ApiRequirement, ApiClient } from "@/lib/api-types";
import { RUBRIC, METRIC_GROUPS, formatValue, bandFor } from "@/lib/evaluation";

export const Route = createFileRoute("/owner/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — Global3" },
      { name: "description", content: "Performance metrics, analytics, live previews and exports for the Global3 recruitment engine." },
    ],
  }),
  component: ReportsPage,
});

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function ReportsPage() {
  const [range, setRange] = useState("30d");
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  // 1. Live Backend Analytics Query
  const { data: analytics, isLoading: analyticsLoading } = useQuery<ApiReportsAnalytics>({
    queryKey: ["reports-analytics", range],
    queryFn: () => api.getReportsAnalytics(range),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  // 2. Recent Generated Reports
  const { data: recentReportsData } = useQuery({
    queryKey: ["reports-recent"],
    queryFn: () => api.getRecentReports(),
    refetchInterval: 15_000,
  });
  const recentReports = recentReportsData?.reports ?? [];

  // 3. Client & Requirement records for deep previews
  const { data: reqsData } = useQuery({ queryKey: ["requirements", "all"], queryFn: () => api.getRequirements() });
  const allRequirements: ApiRequirement[] = reqsData?.requirements ?? [];

  const { data: clientsData } = useQuery({ queryKey: ["clients"], queryFn: () => api.getClients() });
  const allClients: ApiClient[] = clientsData?.clients ?? [];

  const summary = analytics?.summary ?? {
    outreachVolume: 0,
    activeRecruitersCount: 0,
    teamAvgScore: 75,
    totalDemand: 0,
    totalFilled: 0,
    fillRate: 0,
    aiDraftsCount: 0,
    savedHours: 0,
  };

  const teamBand = useMemo(() => bandFor(summary.teamAvgScore), [summary.teamAvgScore]);
  const langBars = analytics?.languageBreakdown ?? [];
  const maxNeed = Math.max(...langBars.map((b) => b.needed), 1);
  const throughput = analytics?.recruiterThroughput ?? [];
  const maxThroughput = Math.max(...throughput.map((t) => t.leadsOnboarded), 1);

  const activeReport = recentReports.find((r) => r.id === previewReportId) ?? null;

  const handleExportCsv = async (reportType: string = "summary") => {
    try {
      toast.info("Generating CSV export…");
      const filenameMap: Record<string, string> = {
        scorecard: "recruiter-evaluation-scorecard.csv",
        "market-demand": "market-demand-matrix.csv",
        "leads-pipeline": "leads-pipeline-export.csv",
        summary: "global3-performance-summary.csv",
      };
      const endpoint = reportType.includes("scorecard")
        ? "scorecard"
        : reportType.includes("demand")
        ? "market-demand"
        : reportType.includes("lead")
        ? "leads-pipeline"
        : "summary";

      const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
      const res = await fetch(`/api/reports/export/${endpoint}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error("Failed to export report CSV");
      const blob = await res.blob();
      downloadBlob(blob, filenameMap[endpoint] || "export.csv");
      toast.success("CSV export downloaded successfully!");
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Reports &amp; Analytics</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Performance snapshot</h2>
          <p className="mt-1 text-sm text-muted-foreground">Live aggregate view of recruiter output, market fill and outreach signals.</p>
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
          <Button variant="outline" size="sm" onClick={() => handleExportCsv("summary")} className="gap-1.5 text-xs">
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 text-xs" onClick={handlePrintPdf}>
            <Printer className="h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric icon={Radio} label="Outreach volume" value={summary.outreachVolume.toLocaleString()} sub={`in ${range}`} />
        <Metric icon={Users} label="Active recruiters" value={String(summary.activeRecruitersCount)} sub={`Team score ${summary.teamAvgScore}/100`} />
        <Metric icon={TrendingUp} label="Fill rate" value={`${summary.fillRate}%`} sub={`${summary.totalFilled}/${summary.totalDemand} seats`} />
        <Metric icon={Clock} label="AI Time saved" value={`${summary.savedHours} hrs`} sub={`${summary.aiDraftsCount} drafts generated`} />
      </div>

      {/* Market Fill & Throughput Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Demand vs. filled by language</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Real-time demand allocation across languages.</div>
            </div>
            <Badge variant="outline" className="text-[11px] font-medium border-border">
              {langBars.length} Languages
            </Badge>
          </div>
          <div className="mt-5 space-y-4">
            {langBars.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">No active language demand recorded.</div>
            ) : (
              langBars.slice(0, 6).map((b) => (
                <div key={b.language}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{b.language}</span>
                    <span className="tabular-nums text-muted-foreground font-mono">{b.filled}/{b.needed} seats</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="relative h-full">
                      <div className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: `${(b.needed / maxNeed) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(b.filled / maxNeed) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Recruiter throughput</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Onboarded leads placed in selected range ({range}).</div>
            </div>
            <Badge variant="outline" className="text-[11px] font-medium border-border">
              {throughput.length} Recruiters
            </Badge>
          </div>
          <div className="mt-5 space-y-4">
            {throughput.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">No onboarded lead events recorded in this period.</div>
            ) : (
              throughput.slice(0, 6).map((r) => (
                <div key={r.id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="tabular-nums font-mono text-muted-foreground">{r.leadsOnboarded} placed · {r.score}/100</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${(r.leadsOnboarded / maxThroughput) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Recent Generated Reports Section with Live Preview & Download */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-sm font-semibold">Recent reports &amp; exports</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Auto-generated system reports, assignment activity logs, and CSV data exports.</div>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {recentReports.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-muted/20">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent shrink-0">
                  {r.type === "log" ? <History className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.range} · <span className="uppercase font-semibold text-accent">{r.type}</span> · {new Date(r.generated).toLocaleDateString()}
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
                  onClick={() => handleExportCsv(r.id)}
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
              Category A (100% composite) and Category B outcome metrics governing recruiter performance.
            </div>
          </div>
          <Badge variant="outline" className="border-accent/30 text-accent font-medium">
            Team score {summary.teamAvgScore}/100 · {teamBand.label}
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
                      Formatted document preview before export · {activeReport.range} · Verified Database Snapshot
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
                    <div>Generated: {new Date(activeReport.generated).toLocaleDateString()}</div>
                    <div>Status: Live Verified Snapshot</div>
                  </div>
                </div>

                {/* Report Content Switch */}
                {activeReport.id === "rep-monthly-recruiter-scorecard" && (
                  <div className="space-y-3">
                    <div className="font-semibold text-foreground">Recruiter Composite Evaluation Summary</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl border border-border bg-muted/10">
                        <div className="text-muted-foreground text-[10px]">ACTIVE RECRUITERS</div>
                        <div className="text-lg font-bold">{summary.activeRecruitersCount}</div>
                      </div>
                      <div className="p-3 rounded-xl border border-border bg-muted/10">
                        <div className="text-muted-foreground text-[10px]">TEAM AVERAGE SCORE</div>
                        <div className="text-lg font-bold">{summary.teamAvgScore}/100</div>
                      </div>
                      <div className="p-3 rounded-xl border border-border bg-muted/10">
                        <div className="text-muted-foreground text-[10px]">TOTAL OUTREACH</div>
                        <div className="text-lg font-bold">{summary.outreachVolume}</div>
                      </div>
                    </div>
                  </div>
                )}

                {activeReport.id === "rep-market-demand-gap" && (
                  <div className="space-y-3">
                    <div className="font-semibold text-foreground">Market Demand Allocation &amp; Headcount Gaps</div>
                    <div className="divide-y divide-border rounded-xl border border-border/80 bg-muted/10 overflow-hidden">
                      {langBars.slice(0, 8).map((b) => (
                        <div key={b.language} className="flex items-center justify-between p-2.5">
                          <span className="font-medium">{b.language}</span>
                          <span className="tabular-nums text-muted-foreground font-mono">{b.filled} filled / {b.needed} needed ({b.gap} gap)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeReport.id === "rep-outreach-activity-log" && (
                  <div className="space-y-3">
                    <div className="font-semibold text-foreground">Outreach &amp; Volume Overview</div>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Captured {summary.outreachVolume} outbound interactions across Unipile (LinkedIn DM) and Resend (Email).
                      All message timestamps reflect provider-acknowledged event times for strict audit compliance.
                    </p>
                  </div>
                )}

                {activeReport.id === "rep-lead-stage-progression" && (
                  <div className="space-y-3">
                    <div className="font-semibold text-foreground">Pipeline Progression &amp; Placements</div>
                    <div className="divide-y divide-border rounded-xl border border-border/80 bg-muted/10 overflow-hidden">
                      {throughput.map((t) => (
                        <div key={t.id} className="flex items-center justify-between p-2.5">
                          <span className="font-medium">{t.name}</span>
                          <span className="tabular-nums font-mono text-muted-foreground">{t.leadsOnboarded} placed ({t.score}/100)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewReportId(null)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
                  onClick={() => {
                    handleExportCsv(activeReport.id);
                    setPreviewReportId(null);
                  }}
                >
                  <Download className="h-4 w-4" /> Download Report (CSV)
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent"><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ExpandableMetricCategory({
  group,
  groupMetrics,
}: {
  group: string;
  groupMetrics: typeof RUBRIC;
}) {
  const [expanded, setExpanded] = useState(false);

  const groupWeights = groupMetrics.reduce((s, m) => s + (m.weight ?? 0), 0);

  return (
    <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-accent/10 text-accent shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">{group}</div>
            <div className="text-[11px] text-muted-foreground">{groupMetrics.length} metrics in category</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {groupWeights > 0 && (
            <Badge variant="outline" className="text-[10px] font-bold border-primary/30 text-primary">
              Weight: {groupWeights}%
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 divide-y divide-border/60">
          {groupMetrics.map((metric) => (
            <div key={metric.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4 text-xs">
              <div>
                <div className="font-semibold text-foreground flex items-center gap-2">
                  {metric.label}
                  {metric.scored ? (
                    <span className="text-[10px] font-bold text-accent px-1.5 py-0.2 rounded border border-accent/30 bg-accent/10">
                      Scored {metric.weight}%
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.2 rounded border border-border bg-muted/30">
                      Watched Signal
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{metric.definition}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-mono text-foreground font-semibold">
                  Target: {metric.goodBand ? formatValue(metric.unit, metric.goodBand) : formatValue(metric.unit, metric.target)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {metric.targetLabel || `Unit: ${metric.unit}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}