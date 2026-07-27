import { createFileRoute, Link } from "@tanstack/react-router";
import { recruiters, escalations, leads, type Recruiter } from "@/lib/g3-mock";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { LeadCard } from "@/components/g3/lead-card";
import { KpiTile, ScoreRing } from "@/components/g3/kpi";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/owner/recruiters")({
  head: () => ({
    meta: [
      { title: "Recruiters — Global3" },
      { name: "description", content: "Recruiter and contractor performance, reply/read rate, onboarded/offboarded leads, escalations." },
    ],
  }),
  component: RecruitersPage,
});

const baseline = { reply: 0.28, read: 0.65 };

function RecruitersPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = recruiters.find(r => r.id === openId) ?? null;
  const full = [...recruiters.filter(r => r.role === "full_access")].sort((a, b) => b.kpis.overall_score - a.kpis.overall_score);
  const contractors = [...recruiters.filter(r => r.role === "contractor")].sort((a, b) => b.kpis.overall_score - a.kpis.overall_score);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-accent">Full-access recruiters</h2>
          <span className="text-xs text-muted-foreground">Ranked by overall recruiter score · Team baseline reply {Math.round(baseline.reply * 100)}%</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {full.map(r => <RecruiterCard key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Contractors</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {contractors.map(r => (
            <button key={r.id} onClick={() => setOpenId(r.id)} className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-accent/40">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{r.name}</div>
                <StatusPill status={r.status} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  reply {Math.round(r.reply_rate * 100)}% · onboarded {r.leads_onboarded}
                </div>
                <span className={`text-sm font-semibold tabular-nums ${r.kpis.overall_score >= 60 ? "text-accent" : "text-warning"}`}>{r.kpis.overall_score}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Sheet open={!!active} onOpenChange={o => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-auto">
          {active && <RecruiterDetail r={active} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RecruiterCard({ r, onOpen }: { r: Recruiter; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group rounded-2xl border border-border bg-card p-5 text-left transition-all hover:border-accent/50 hover:shadow-[0_1px_0_0_theme(colors.accent/10),0_12px_28px_-16px_theme(colors.accent/25)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: `oklch(0.55 0.16 ${r.avatar_hue})` }}
          >
            {r.name.charAt(0)}
          </div>
          <div>
            <div className="font-semibold">{r.name}</div>
            <div className="text-[11px] text-muted-foreground">Full access</div>
          </div>
        </div>
        <StatusPill status={r.status} />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3">
        <ScoreRing score={r.kpis.overall_score} size={72} label="Overall score" />
        <div className="text-right text-[11px] text-muted-foreground">
          <div>Onboarded <span className="tabular-nums font-semibold text-foreground">{r.leads_onboarded}</span></div>
          <div>Offboarded <span className="tabular-nums font-semibold text-foreground">{r.leads_offboarded}</span></div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <KpiTile label="SLA adherence" value={r.kpis.sla_adherence} unit="pct" />
        <KpiTile label="Response rate" value={r.kpis.response_rate} unit="pct" />
        <KpiTile label="Interview conv." value={r.kpis.interview_to_offer} unit="pct" />
        <KpiTile label="AI adoption" value={r.kpis.ai_adoption} unit="pct" />
      </div>

      {r.unresolved_5d > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
          {r.unresolved_5d} escalated {r.unresolved_5d === 1 ? "item" : "items"} 5+ days unresolved
        </div>
      )}
    </button>
  );
}

function RecruiterDetail({ r }: { r: Recruiter }) {
  const owned = leads.filter(l => l.recruiter_id === r.id);
  const esc = escalations.filter(e => e.recruiter_id === r.id);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: `oklch(0.55 0.16 ${r.avatar_hue})` }}>
            {r.name.charAt(0)}
          </div>
          {r.name}
          <StatusPill status={r.status} />
        </SheetTitle>
      </SheetHeader>

      <div className="mt-5 rounded-xl border border-border p-4 flex items-center justify-between">
        <ScoreRing score={r.kpis.overall_score} label="Overall recruiter score" />
        <div className="text-right text-xs text-muted-foreground">
          <div>Reply rate <span className="text-foreground font-semibold">{Math.round(r.reply_rate * 100)}%</span></div>
          <div>Turnaround <span className="text-foreground font-semibold">{r.kpis.avg_turnaround_days.toFixed(1)}d</span></div>
          <div>DNC <span className="text-foreground font-semibold">{r.kpis.dnc_pct}%</span></div>
        </div>
      </div>

      <Link
        to="/owner/recruiter-evaluation/$id"
        params={{ id: r.id }}
        className="mt-3 flex items-center justify-between rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
      >
        Open full performance evaluation
        <ArrowUpRight className="h-4 w-4" />
      </Link>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        <KpiTile label="SLA adherence" value={r.kpis.sla_adherence} unit="pct" />
        <KpiTile label="Email open rate" value={r.kpis.email_open_rate} unit="pct" hint="Directional — Apple privacy caveat" />
        <KpiTile label="Offer acceptance" value={r.kpis.offer_acceptance} unit="pct" />
        <KpiTile label="Interview → Offer" value={r.kpis.interview_to_offer} unit="pct" />
        <KpiTile label="Client satisfaction" value={r.kpis.client_satisfaction} unit="pct" />
        <KpiTile label="AI adoption" value={r.kpis.ai_adoption} unit="pct" />
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">Escalated items · 5+ days unresolved</h3>
        <div className="mt-3 space-y-2">
          {esc.length === 0 && <p className="text-xs text-muted-foreground">None right now.</p>}
          {esc.map(e => (
            <div key={e.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{e.title}</div>
                <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">{e.age_days}d</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{e.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">Activity timeline</h3>
        <ol className="mt-3 space-y-3 border-l border-border pl-4">
          {[
            { t: "2h ago", d: "Sent outreach to Lead #G-6613 (Mandarin / Dubbing)" },
            { t: "5h ago", d: "Marked Lead #B-2277 High Priority" },
            { t: "1d ago", d: "Onboarded Verified Lead 4401 (Spanish LatAm / Dubbing)" },
            { t: "2d ago", d: "Reclassified reply on Lead #A-1198 — Interested, not FAQ" },
          ].map((row, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
              <div className="text-xs text-muted-foreground">{row.t}</div>
              <div className="text-sm">{row.d}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">Recent leads</h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {owned.slice(0, 4).map(l => <LeadCard key={l.id} lead={l} compact />)}
        </div>
      </section>
    </>
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