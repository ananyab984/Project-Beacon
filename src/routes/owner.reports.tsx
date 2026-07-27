import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Clock, TrendingUp, Users, Radio } from "lucide-react";
import { toast } from "sonner";
import { recruiters, languageDemand, outreachBatch, KPI_DEFINITIONS, teamKpis, aiDraftStats, type RecruiterKPIs } from "@/lib/g3-mock";
import { Sparkles, ArrowDown, PenLine, Wand2 } from "lucide-react";
import { FEATURES } from "@/lib/feature-flags";

export const Route = createFileRoute("/owner/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Global3" },
      { name: "description", content: "Performance metrics, analytics and exports for the Global3 recruitment engine." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const [range, setRange] = useState("30d");

  const summary = useMemo(() => {
    const totalDemand = languageDemand.reduce((s, d) => s + d.headcount_needed, 0);
    const totalFilled = languageDemand.reduce((s, d) => s + d.filled, 0);
    const fill = totalDemand ? Math.round((totalFilled / totalDemand) * 100) : 0;
    const reachTotal = outreachBatch.contacted + outreachBatch.awaiting_reply + outreachBatch.replied + outreachBatch.in_negotiation + outreachBatch.dnc;
    return { totalDemand, totalFilled, fill, reachTotal };
  }, []);

  // Time-saved benchmark inputs — configurable constants.
  const timeSaved = useMemo(() => {
    const draftsGenerated = aiDraftStats.total_generated;
    const manualMinutesPerDraft = 12;
    const aiMinutesPerDraft = 3;
    const manualHours = Math.round((draftsGenerated * manualMinutesPerDraft) / 60);
    const aiHours = Math.round((draftsGenerated * aiMinutesPerDraft) / 60);
    const savedHours = Math.max(0, manualHours - aiHours);
    return { draftsGenerated, manualMinutesPerDraft, aiMinutesPerDraft, manualHours, aiHours, savedHours };
  }, []);

  const team = teamKpis();

  const exportFile = (fmt: "csv" | "pdf") => {
    toast.success(`Preparing ${fmt.toUpperCase()} export for last ${range} — you'll get an email when ready.`);
  };

  const langBars = useMemo(() => {
    const map = new Map<string, { needed: number; filled: number }>();
    for (const d of languageDemand) {
      const cur = map.get(d.language) ?? { needed: 0, filled: 0 };
      map.set(d.language, { needed: cur.needed + d.headcount_needed, filled: cur.filled + d.filled });
    }
    return Array.from(map, ([language, v]) => ({ language, ...v })).sort((a, b) => b.needed - a.needed);
  }, []);

  const maxNeed = Math.max(...langBars.map(b => b.needed), 1);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Reports & analytics</div>
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
          <Button variant="outline" size="sm" onClick={() => exportFile("csv")}><Download className="h-4 w-4" /> CSV</Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => exportFile("pdf")}>
            <Download className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric icon={Radio} label="Outreach volume" value={summary.reachTotal.toLocaleString()} sub="+12% vs prior" />
        <Metric icon={Users} label="Active recruiters" value={String(recruiters.length)} sub={`${recruiters.filter(r => r.status === "healthy").length} healthy`} />
        <Metric icon={TrendingUp} label="Fill rate" value={`${summary.fill}%`} sub={`${summary.totalFilled}/${summary.totalDemand} seats`} />
        <Metric icon={Clock} label="Time saved" value={`${timeSaved.savedHours} hrs`} sub={`${timeSaved.draftsGenerated} drafts, 30d`} />
      </div>

      {FEATURES.ai && (
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
                <Clock className="h-3 w-3" /> Time saved · methodology
              </div>
              <div className="mt-0.5 text-sm font-semibold">Manual draft time vs AI draft time</div>
              <div className="mt-1 text-xs text-muted-foreground">Benchmarks are placeholders — swap for measured values when available.</div>
            </div>
          </div>
          <div className="mt-6 mx-auto flex max-w-xl flex-col items-stretch gap-3">
            <TimeRow icon={PenLine} label="Manual draft time" value={`${timeSaved.manualHours} hrs`} sub={`${timeSaved.manualMinutesPerDraft} min × ${timeSaved.draftsGenerated} drafts`} tone="muted" />
            <div className="flex justify-center text-muted-foreground"><ArrowDown className="h-4 w-4" /></div>
            <TimeRow icon={Wand2} label="AI draft time" value={`${timeSaved.aiHours} hrs`} sub={`${timeSaved.aiMinutesPerDraft} min × ${timeSaved.draftsGenerated} drafts`} tone="muted" />
            <div className="flex justify-center text-muted-foreground"><ArrowDown className="h-4 w-4" /></div>
            <TimeRow icon={Clock} label="Total time saved" value={`${timeSaved.savedHours} hrs`} sub="Manual − AI" tone="accent" />
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Language demand vs. filled</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Ordered by open headcount.</div>
            </div>
            <Badge variant="outline" className="border-accent/30 text-accent">Live</Badge>
          </div>
          <div className="mt-5 space-y-3">
            {langBars.map(b => (
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
            {recruiters.slice(0, 6).map(r => {
              const max = Math.max(...recruiters.map(x => x.leads_onboarded), 1);
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

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-sm font-semibold">Recent reports</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Auto-generated and manual exports.</div>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {RECENT.map(r => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-6 py-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.range} · {r.type.toUpperCase()} · {r.generated}</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="hover:bg-accent/10 hover:text-accent" onClick={() => toast.success(`Downloading ${r.name}`)}>
                <Download className="h-4 w-4" /> Download
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="text-sm font-semibold">Evaluation framework</div>
            <div className="mt-0.5 text-xs text-muted-foreground">The KPIs that roll up into each recruiter's overall score.</div>
          </div>
          <Badge variant="outline" className="border-accent/30 text-accent">Team score {team.overall_score}</Badge>
        </div>
        <div className="divide-y divide-border">
          {KPI_DEFINITIONS.map((def) => {
            const teamAvg = Math.round(
              recruiters.reduce((a, r) => a + (r.kpis[def.key] as number), 0) / recruiters.length,
            );
            const display =
              def.unit === "pct" ? `${teamAvg}%` :
              def.unit === "days" ? `${teamAvg.toFixed(1)}d` :
              String(teamAvg);
            return (
              <div key={def.key} className="grid grid-cols-[1fr_140px_100px] items-center gap-4 px-6 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{def.label}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{def.desc}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {def.higherIsBetter ? "Higher is better" : "Lower is better"}
                </div>
                <div className="text-right text-base font-semibold tabular-nums">{display}</div>
              </div>
            );
          })}
        </div>
      </section>

      {FEATURES.ai && (
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">AI Draft Analytics</div>
              <div className="mt-0.5 text-xs text-muted-foreground">How recruiters interact with AI-generated outreach.</div>
            </div>
          </div>
          <Badge variant="outline" className="border-accent/30 text-accent">Acceptance {aiDraftStats.acceptance_rate_pct}%</Badge>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6 md:grid-cols-5">
          <DraftStat label="Drafts generated" value={aiDraftStats.total_generated.toLocaleString()} sub="last 30d" />
          <DraftStat label="Sent without edits" value={`${aiDraftStats.sent_without_edit_pct}%`} sub="verbatim send" />
          <DraftStat label="Edited before send" value={`${aiDraftStats.edited_before_send_pct}%`} sub="light touch-ups" />
          <DraftStat label="Avg. edit rate" value={`${aiDraftStats.avg_edit_rate_pct}%`} sub="tokens changed" />
          <DraftStat label="Acceptance rate" value={`${aiDraftStats.acceptance_rate_pct}%`} sub="sent / generated" />
        </div>
        <div className="border-t border-border px-6 py-4">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>Draft usage split</span>
            <span>Sent · Edited · Discarded</span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-accent" style={{ width: `${aiDraftStats.sent_without_edit_pct}%` }} />
            <div className="bg-primary" style={{ width: `${aiDraftStats.edited_before_send_pct}%` }} />
            <div className="bg-destructive/60" style={{ width: `${aiDraftStats.discarded_pct}%` }} />
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

// keep type imports satisfied
void ({} as RecruiterKPIs);

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

function TimeRow({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string; tone: "muted" | "accent" }) {
  const chip = tone === "accent" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground";
  const val = tone === "accent" ? "text-accent" : "text-foreground";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border ${tone === "accent" ? "border-accent/40 bg-accent/5" : "border-border bg-card"} px-4 py-3`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${chip}`}><Icon className="h-4 w-4" /></span>
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${val}`}>{value}</div>
    </div>
  );
}

const RECENT = [
  { id: "r1", name: "Weekly Recruiter Scorecard", type: "pdf", range: "Nov 11–17", generated: "generated today, 08:12" },
  { id: "r2", name: "Q4 Language Fill Analysis",   type: "pdf", range: "Q4",         generated: "generated 2d ago" },
  { id: "r3", name: "Leads Pipeline Export",       type: "csv", range: "Last 30d",   generated: "generated 3d ago" },
  { id: "r4", name: "Outreach Volume Trend",       type: "csv", range: "Last 90d",   generated: "generated last week" },
];