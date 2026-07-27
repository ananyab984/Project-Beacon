import { createFileRoute, Link } from "@tanstack/react-router";
import { myContractorLeads, useRecruiterStore } from "@/lib/recruiter-mock";
import { ArrowUpRight, Mail, UserPlus, CheckCircle2, MailOpen, MessageSquare, Handshake, ShieldOff, Radio, AlertTriangle } from "lucide-react";
import { outreachBatch } from "@/lib/g3-mock";
import { DateRangeToggle, useDateRange, scaleValue } from "@/components/g3/date-range-toggle";

export const Route = createFileRoute("/contractor/")({
  head: () => ({ meta: [{ title: "Dashboard — Global3 Contractor" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const store = useRecruiterStore();
  const mine = myContractorLeads();
  const dupCount = mine.filter((l) => l.dup_flagged).length;
  const { scale, label: rangeLabel } = useDateRange();

  const activities = mine.slice(0, 6).map((l) => ({
    id: l.id,
    icon: l.dup_flagged ? AlertTriangle : UserPlus,
    title: l.dup_flagged ? `Duplicate flagged · ${l.full_name}` : `Lead submitted · ${l.full_name}`,
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
            <div className="mt-0.5 text-sm font-semibold">Team outreach · {rangeLabel.toLowerCase()}</div>
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
        <MetricCard label="Leads Submitted" value={mine.length} delta="+" tone="positive" />
        <MetricCard label="Duplicates Flagged" value={dupCount} delta={dupCount ? "review" : "0"} tone={dupCount ? "negative" : "positive"} />
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
          <Link to="/contractor/email-queue" className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted">
            Review Queue
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-primary">My Submission Overview</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">You've submitted {mine.length} leads to date.</h2>
          </div>
          <Link to="/contractor/leads" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">View leads <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-border pt-4">
          <Stat n={mine.length} label="Submitted" />
          <Stat n={mine.filter((l) => l.enrichment_status === "complete").length} label="Enriched" />
          <Stat n={mine.filter((l) => l.enrichment_status === "pending").length} label="Enriching" />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Recent Activity</div>
          <Link to="/contractor/leads" className="text-[11px] text-primary hover:underline">View All</Link>
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
      <div className="text-2xl font-semibold tabular-nums text-primary">{String(n).padStart(2, "0")}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function BatchTile({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: "primary" | "muted" | "accent" | "warning" | "destructive" }) {
  const styles = {
    primary: { chip: "bg-primary/10 text-primary", value: "text-primary" },
    muted: { chip: "bg-muted text-muted-foreground", value: "text-foreground" },
    accent: { chip: "bg-accent/10 text-accent", value: "text-accent" },
    warning: { chip: "bg-warning/15 text-warning", value: "text-warning" },
    destructive: { chip: "bg-destructive/10 text-destructive", value: "text-destructive" },
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${styles.chip}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      <div className={`mt-3 text-2xl font-semibold tabular-nums ${styles.value}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function relative(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}