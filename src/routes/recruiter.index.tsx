import { createFileRoute, Link } from "@tanstack/react-router";
import { useRecruiterStore, myLeads, leadsOnboardedCount, leadsOffboardedCount } from "@/lib/recruiter-mock";
import { ArrowUpRight, Mail, UserPlus, CheckCircle2, MailOpen, MessageSquare, Handshake, ShieldOff, Radio } from "lucide-react";
import { outreachBatch, useClientDemands } from "@/lib/g3-mock";
import { DateRangeToggle, useDateRange, scaleValue } from "@/components/g3/date-range-toggle";
import { useMemo } from "react";

export const Route = createFileRoute("/recruiter/")({
  head: () => ({ meta: [{ title: "Dashboard — Global3 Recruiter" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const store = useRecruiterStore();
  const mine = myLeads();
  const { scale, label: rangeLabel } = useDateRange();

  const activities = mine.slice(0, 6).map((l) => ({
    id: l.id,
    icon: l.enrichment_status === "pending" ? UserPlus : CheckCircle2,
    title: l.enrichment_status === "pending" ? "New lead added" : `Lead enriched · ${l.full_name}`,
    detail: `${l.full_name}${l.services?.length ? " · " + l.services.join(", ") : ""}`,
    ago: relative(l.created_at),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
              <Radio className="h-3 w-3" /> Current batch
            </div>
            <div className="mt-0.5 text-sm font-semibold">My outreach · {rangeLabel.toLowerCase()}</div>
          </div>
          <DateRangeToggle />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <BatchTile icon={Mail} label="Contacted" value={scaleValue(outreachBatch.contacted, scale)} tone="primary" />
          <BatchTile icon={MailOpen} label="Awaiting Reply" value={scaleValue(outreachBatch.awaiting_reply, scale)} tone="muted" />
          <BatchTile icon={MessageSquare} label="Replied" value={scaleValue(outreachBatch.replied, scale)} tone="accent" />
          <BatchTile icon={Handshake} label="Negotiation" value={scaleValue(outreachBatch.in_negotiation, scale)} tone="warning" />
          <BatchTile icon={ShieldOff} label="DNC" value={scaleValue(outreachBatch.dnc, scale)} tone="destructive" />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Leads Onboarded" value={leadsOnboardedCount()} delta="+12%" tone="positive" />
        <MetricCard label="Leads Offboarded" value={leadsOffboardedCount()} delta="−4%" tone="negative" />
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-accent/15 p-2 text-accent"><Mail className="h-4 w-4" /></div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Email Queue</div>
            </div>
            <span className="text-[11px] text-primary">+4 today</span>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <div className="text-3xl font-semibold tracking-tight">{store.emailQueue.length}</div>
            <div className="text-xs text-muted-foreground">pending manual review</div>
          </div>
          <Link to="/recruiter/email-queue" className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted">
            Review Queue
          </Link>
        </div>
      </div>

      {/* Language & Services Requirements Overview */}
      <RecruiterMarketRequirementsSection />

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-primary">Active Pipeline Overview</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Urgent attention needed for {store.emailQueue.length} candidate reviews.</h2>
          </div>
          <Link to="/recruiter/leads" search={{ scope: "mine" }} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">View leads <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-border pt-4">
          <Stat n={mine.length} label="My Leads" />
          <Stat n={mine.filter((l) => l.enrichment_status === "complete").length} label="Enriched" />
          <Stat n={mine.filter((l) => l.enrichment_status === "pending").length} label="Enriching" />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Recent Activity</div>
          <Link to="/recruiter/leads" search={{ scope: "global" }} className="text-[11px] text-primary hover:underline">View All</Link>
        </div>
        <div className="mt-4 space-y-3">
          {activities.length === 0 && <div className="text-xs text-muted-foreground">No leads yet — click "Add a Lead" to get started.</div>}
          {activities.map((a) => {
            const Icon = a.icon;
            return (
              <div key={a.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Icon className="h-3.5 w-3.5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{a.detail}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/60">{a.ago}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RecruiterMarketRequirementsSection() {
  const demands = useClientDemands();

  const summary = useMemo(() => {
    const totalNeeded = demands.reduce((s, d) => s + d.headcount_needed, 0);
    const totalFilled = demands.reduce((s, d) => s + d.filled, 0);
    const totalRemaining = Math.max(0, totalNeeded - totalFilled);
    return { totalNeeded, totalFilled, totalRemaining };
  }, [demands]);

  const byLang = useMemo(() => {
    const map = new Map<string, { needed: number; filled: number; services: Set<string> }>();
    for (const d of demands) {
      const cur = map.get(d.language) ?? { needed: 0, filled: 0, services: new Set() };
      d.services.forEach(s => cur.services.add(s));
      map.set(d.language, {
        needed: cur.needed + d.headcount_needed,
        filled: cur.filled + d.filled,
        services: cur.services,
      });
    }
    return Array.from(map, ([language, v]) => ({
      language,
      needed: v.needed,
      filled: v.filled,
      remaining: Math.max(0, v.needed - v.filled),
      services: Array.from(v.services),
    })).sort((a, b) => b.remaining - a.remaining);
  }, [demands]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-accent font-semibold">Language &amp; Service Requirements</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Market Headcount Needed vs. Filled</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Current staffing targets across all languages · <span className="font-semibold text-foreground">{summary.totalRemaining} people still left to fill</span>
          </p>
        </div>
        <Link to="/recruiter/clients" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          Clients &amp; Market <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">People Needed</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{summary.totalNeeded}</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">People Filled</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[oklch(0.55_0.14_155)]">{summary.totalFilled}</div>
        </div>
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">People Still Left</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${summary.totalRemaining > 0 ? "text-warning" : "text-accent"}`}>
            {summary.totalRemaining}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {byLang.slice(0, 4).map(item => (
          <div key={item.language} className="rounded-xl border border-border/80 bg-background/50 p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{item.language}</span>
              <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${item.remaining > 0 ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent"}`}>
                {item.remaining > 0 ? `${item.remaining} left` : "Filled"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate">{item.services.join(", ")}</div>
            <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
              <span className="text-muted-foreground">Filled <strong className="text-foreground">{item.filled}</strong>/{item.needed}</span>
              <span className="font-semibold text-foreground">{item.remaining} left</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${item.needed ? Math.min(100, (item.filled / item.needed) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricCard({ label, value, delta, tone }: { label: string; value: number | string; delta: string; tone: "positive" | "negative" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        <span className={`text-xs font-medium ${tone === "positive" ? "text-success" : "text-destructive"}`}>{delta}</span>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{n}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function BatchTile({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string; tone: "primary" | "muted" | "accent" | "warning" | "destructive" }) {
  const map = {
    primary: "text-primary",
    muted: "text-muted-foreground",
    accent: "text-accent",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${map[tone]}`} />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function relative(time: number) {
  const diff = Date.now() - time;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}