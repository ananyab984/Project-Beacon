import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ArrowUpRight, Mail, UserPlus, CheckCircle2, MailOpen, MessageSquare, Handshake, ShieldOff, Radio, AlertTriangle, Clock } from "lucide-react";
import { DateRangeSelect, useDateRange } from "@/components/features/date-range-toggle";
import { useMemo } from "react";

export const Route = createFileRoute("/recruiter/")({
  head: () => ({ meta: [{ title: "Dashboard — Global3 Recruiter" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data: myLeadsData } = useQuery({ queryKey: ["leads", "mine"], queryFn: api.getMyLeads });
  const { data: emailQueueData } = useQuery({ queryKey: ["email-queue"], queryFn: api.getEmailQueue });
  // No backend "client due-date risk" endpoint exists -- escalations are the
  // real, server-scoped analog (recruiters only ever see their own via RBAC).
  const { data: escalationsData } = useQuery({ queryKey: ["escalations"], queryFn: api.getEscalations });
  const mine = myLeadsData?.leads ?? [];
  const emailQueueCount = emailQueueData?.items.length ?? 0;
  const dueAlerts = escalationsData?.escalations ?? [];
  const { range, label: rangeLabel } = useDateRange();
  const { data: funnelData } = useQuery({
    queryKey: ["outreach-funnel", range],
    queryFn: () => api.getOutreachFunnel(range),
  });
  const funnel = funnelData ?? { contacted: 0, awaiting_reply: 0, replied: 0, in_negotiation: 0, dnc: 0 };

  // leadsOnboardedCount() was a hardcoded mock constant (124) with no real
  // backing -- compute the real count from the recruiter's own leads instead.
  const onboardedCount = mine.filter((l) => l.stage === "ONBOARDED").length;

  // Same definition already used (and working correctly) on the Leads page's
  // own on-hold banner (recruiter.leads.tsx's onHoldCount) -- this dashboard
  // banner used to just say "3" as literal JSX text with no query behind it
  // at all, regardless of how many leads actually needed review.
  const onHoldCount = mine.filter((l) => l.enrichmentStatus !== "COMPLETE" && l.enrichmentStatus !== "IN_PROGRESS").length;

  const activities = mine.slice(0, 6).map((l) => ({
    id: l.id,
    icon: l.enrichmentStatus === "PENDING" ? UserPlus : CheckCircle2,
    title: l.enrichmentStatus === "PENDING" ? "New lead added" : `Lead enriched · ${l.fullName ?? l.displayName ?? l.maskedLabel}`,
    detail: `${l.fullName ?? l.displayName ?? l.maskedLabel}${l.services?.length ? " · " + l.services.join(", ") : ""}`,
    ago: relative(l.createdAt),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Current Batch Section with Date Control dropdown matching Owner Dashboard */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
              <Radio className="h-3 w-3" /> Current batch
            </div>
            <div className="mt-0.5 text-sm font-semibold">My outreach · {rangeLabel.toLowerCase()}</div>
          </div>
          <DateRangeSelect />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <BatchTile icon={Mail} label="Contacted" value={funnel.contacted} tone="primary" />
          <BatchTile icon={MailOpen} label="Awaiting Reply" value={funnel.awaiting_reply} tone="muted" />
          <BatchTile icon={MessageSquare} label="Replied" value={funnel.replied} tone="accent" />
          <BatchTile icon={Handshake} label="Negotiation" value={funnel.in_negotiation} tone="warning" />
          <BatchTile icon={ShieldOff} label="DNC" value={funnel.dnc} tone="destructive" />
        </div>
      </section>

      {/* Compact Escalations Summary (Full list in Notifications Tab) */}
      {dueAlerts.length > 0 && (
        <section className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-destructive/15 text-destructive font-bold shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-bold text-destructive uppercase tracking-wider text-[10px]">{dueAlerts[0].priority}:</span>
                <span className="font-semibold text-foreground">{dueAlerts[0].title}</span>
                {dueAlerts[0].slaHoursRemaining != null && (
                  <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {dueAlerts[0].slaHoursRemaining < 0
                      ? `${Math.abs(dueAlerts[0].slaHoursRemaining)}h overdue`
                      : `${dueAlerts[0].slaHoursRemaining}h remaining`}
                  </span>
                )}
                {dueAlerts.length > 1 && (
                  <span className="text-muted-foreground text-[11px]">
                    (+{dueAlerts.length - 1} more in Notifications)
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-medium text-muted-foreground hidden sm:inline">Check Notifications Tab for complete list</span>
              <Link
                to="/recruiter/clients"
                className="text-xs font-semibold text-destructive hover:underline flex items-center gap-1 shrink-0"
              >
                View Client Demands <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Recruiter Notifications for On Hold Leads -- hidden entirely when
          there's genuinely nothing to review, same gating as the Leads
          page's own version of this banner. */}
      {onHoldCount > 0 && (
        <section className="rounded-2xl border border-warning/40 bg-warning/5 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-warning/15 text-warning font-bold shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-warning">
                  Action Required · Manual Enrichment
                </div>
                <h2 className="mt-0.5 text-base font-semibold text-foreground">
                  {onHoldCount} lead{onHoldCount > 1 ? "s" : ""} require manual enrichment review
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Automated scrape incomplete. Please review and update missing details so leads can move to Global Leads.
                </p>
              </div>
            </div>
            <Link
              to="/recruiter/leads"
              search={{ scope: "mine" }}
              className="rounded-lg bg-warning px-4 py-2 text-xs font-semibold text-warning-foreground hover:bg-warning/90 transition-colors shrink-0"
            >
              Review On Hold Leads
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Leads Onboarded" value={onboardedCount} delta="" tone="positive" />
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-accent/15 p-2 text-accent"><Mail className="h-4 w-4" /></div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Email Queue</div>
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <div className="text-3xl font-semibold tracking-tight">{emailQueueCount}</div>
            <div className="text-xs text-muted-foreground">pending manual review</div>
          </div>
          <Link to="/recruiter/email-queue" className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted">
            Review Queue
          </Link>
        </div>
      </div>

      {/* Language & Services Requirements Overview */}
      <RecruiterMarketRequirementsSection />

      {/* Recent Activity */}
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
  const { data } = useQuery({ queryKey: ["client-demands"], queryFn: api.getClientDemands });
  const demands = data?.clientDemands ?? [];

  const summary = useMemo(() => {
    const totalNeeded = demands.reduce((s, d) => s + d.headcountNeeded, 0);
    const totalFilled = demands.reduce((s, d) => s + d.filled, 0);
    const totalRemaining = Math.max(0, totalNeeded - totalFilled);
    return { totalNeeded, totalFilled, totalRemaining };
  }, [demands]);

  const byLang = useMemo(() => {
    const map = new Map<string, { needed: number; filled: number; services: Set<string> }>();
    for (const d of demands) {
      const cur = map.get(d.language) ?? { needed: 0, filled: 0, services: new Set() };
      d.serviceBreakdown.forEach(s => cur.services.add(s.service));
      map.set(d.language, {
        needed: cur.needed + d.headcountNeeded,
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

function BatchTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "primary" | "muted" | "accent" | "warning" | "destructive";
}) {
  const colorMap = {
    primary: "border-primary/30 bg-primary/5 text-primary",
    muted: "border-border bg-card text-foreground",
    accent: "border-accent/30 bg-accent/5 text-accent",
    warning: "border-warning/30 bg-warning/5 text-warning",
    destructive: "border-destructive/30 bg-destructive/5 text-destructive",
  };
  return (
    <div className={`rounded-xl border p-3.5 space-y-2 ${colorMap[tone]}`}>
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function relative(isoOrTs: string | number): string {
  const ts = typeof isoOrTs === "number" ? isoOrTs : new Date(isoOrTs).getTime();
  const diff = (Date.now() - ts) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}