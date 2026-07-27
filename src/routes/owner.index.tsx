import { createFileRoute, Link } from "@tanstack/react-router";
import {
  recruiters,
  languageDemand,
  outreachBatch,
  profileCompleteness,
  escalations,
  recruiterById,
  teamKpis,
} from "@/lib/g3-mock";
import { FEATURES } from "@/lib/feature-flags";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Radio,
  Mail,
  MailOpen,
  MessageSquare,
  Handshake,
  ShieldCheck,
  AlertOctagon,
  ShieldOff,
  Gauge,
} from "lucide-react";
import { KpiTile, ScoreRing } from "@/components/g3/kpi";
import { DateRangeToggle, useDateRange, scaleValue } from "@/components/g3/date-range-toggle";

export const Route = createFileRoute("/owner/")({
  head: () => ({
    meta: [
      { title: "Overview — Global3 Owner" },
      {
        name: "description",
        content: "Urgency-ordered oversight for recruiter, contractor, lead and language health.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const team = teamKpis();
  const { scale, label: rangeLabel } = useDateRange();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Hero header */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/[0.04] via-accent/[0.05] to-warning/[0.06] px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Owner overview</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Good morning, Ethan.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {escalations.length} items need your attention across {recruiters.length} recruiters and{" "}
              {languageDemand.length} active language demands.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <DateRangeToggle />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{rangeLabel}</span>
          </div>
        </div>
      </section>

      {/* Data Health — AI/enrichment surface, gated */}
      {FEATURES.ai && (
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
                <ShieldCheck className="h-3 w-3" /> Data health
              </div>
              <div className="mt-0.5 text-sm font-semibold">Profile completeness</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tabular-nums text-accent">
                {Math.round(profileCompleteness.after_enrichment * 100)}%
              </div>
              <div className="text-[11px] text-muted-foreground">
                from {Math.round(profileCompleteness.before_enrichment * 100)}% pre-enrichment
              </div>
            </div>
          </div>
          <div className="mt-5 relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 bg-muted-foreground/40"
              style={{ width: `${profileCompleteness.before_enrichment * 100}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-accent"
              style={{ width: `${profileCompleteness.after_enrichment * 100}%`, mixBlendMode: "multiply" }}
            />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <HealthTile label="Verified email" value={profileCompleteness.verified_email_pct} />
            <HealthTile label="Confirmed language pair" value={profileCompleteness.confirmed_language_pair_pct} />
            <HealthTile label="Experience data" value={profileCompleteness.experience_data_pct} />
          </div>
        </section>
      )}

      {/* Live outreach — 4 discrete blocks, generous spacing */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
              <Radio className="h-3 w-3" /> Live outreach
            </div>
            <div className="mt-0.5 text-sm font-semibold">Current batch</div>
          </div>
          <span className="text-[11px] text-muted-foreground">updates every 60s</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <OutreachBlock
            icon={Mail}
            label="Contacted"
            value={scaleValue(outreachBatch.contacted, scale)}
            tone="primary"
          />
          <OutreachBlock
            icon={MailOpen}
            label="Awaiting Reply"
            value={scaleValue(outreachBatch.awaiting_reply, scale)}
            tone="muted"
          />
          <OutreachBlock
            icon={MessageSquare}
            label="Replied"
            value={scaleValue(outreachBatch.replied, scale)}
            tone="accent"
          />
          <OutreachBlock
            icon={Handshake}
            label="In Negotiation"
            value={scaleValue(outreachBatch.in_negotiation, scale)}
            tone="warning"
          />
          <OutreachBlock icon={ShieldOff} label="DNC" value={scaleValue(outreachBatch.dnc, scale)} tone="destructive" />
        </div>
      </section>

      {/* Team health — evaluation framework strip */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
              <Gauge className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-accent">Team health</div>
              <div className="mt-0.5 text-sm font-semibold">Evaluation framework · {rangeLabel.toLowerCase()}</div>
            </div>
          </div>
          <ScoreRing score={team.overall_score} size={80} label="Team score" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile label="SLA adherence" value={team.sla_adherence} unit="pct" trend={+3} />
          <KpiTile
            label="Pipeline health"
            value={team.pipeline_health}
            unit="score"
            trend={-2}
            tone={team.pipeline_health < 65 ? "warning" : "neutral"}
          />
          <KpiTile label="Client satisfaction" value={team.client_satisfaction} unit="pct" trend={+4} tone="positive" />
          <KpiTile label="Response rate" value={team.response_rate} unit="pct" trend={+1} />
        </div>
      </section>

      {/* Escalations — the only true owner-only concern on this page */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-warning/15 text-warning">
              <AlertOctagon className="h-3.5 w-3.5" />
            </span>
            <div className="text-sm font-semibold">Escalated items</div>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
              {escalations.length}
            </span>
          </div>
          <Link
            to="/owner/leads"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <ul className="divide-y divide-border">
          {[...escalations]
            .sort((a, b) => a.priority.localeCompare(b.priority))
            .map((e) => {
              const rec = e.recruiter_id ? recruiterById(e.recruiter_id) : undefined;
              const priorityStyle =
                e.priority === "P1"
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : e.priority === "P2"
                    ? "border-warning/50 bg-warning/10 text-warning"
                    : "border-accent/40 bg-accent/10 text-accent";
              const statusStyle =
                e.status === "Open"
                  ? "bg-muted text-foreground/80"
                  : e.status === "Acknowledged"
                    ? "bg-accent/10 text-accent"
                    : "bg-primary/10 text-primary";
              const sla =
                e.sla_hours_remaining === undefined
                  ? null
                  : e.sla_hours_remaining < 0
                    ? { text: `${Math.abs(e.sla_hours_remaining)}h overdue`, cls: "text-destructive" }
                    : { text: `${e.sla_hours_remaining}h left`, cls: "text-warning" };
              return (
                <li key={e.id} className="px-6 py-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${priorityStyle}`}>
                          {e.priority}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {e.category}
                        </span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusStyle}`}>
                          {e.status}
                        </span>
                        <span className="text-[11px] text-muted-foreground">Owner · {e.owner}</span>
                        <span className="text-[11px] text-muted-foreground">· {e.age_days}d</span>
                        {sla && <span className={`text-[11px] font-medium ${sla.cls}`}>· SLA {sla.text}</span>}
                        {rec && <span className="text-[11px] text-accent">· {rec.name}</span>}
                      </div>
                      <div className="mt-1.5 text-sm font-medium">{e.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{e.detail}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[12px]">
                    <span className="text-muted-foreground">Recommended:</span>
                    <span className="font-medium text-foreground">{e.recommended_action}</span>
                  </div>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}

function OutreachBlock({
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
  const styles = {
    primary: { chip: "bg-primary/10 text-primary", value: "text-primary" },
    muted: { chip: "bg-muted text-muted-foreground", value: "text-foreground" },
    accent: { chip: "bg-accent/10 text-accent", value: "text-accent" },
    warning: { chip: "bg-warning/15 text-warning", value: "text-warning" },
    destructive: { chip: "bg-destructive/10 text-destructive", value: "text-destructive" },
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/30">
      <div className="flex items-center justify-between">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${styles.chip}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      <div className={`mt-4 text-3xl font-semibold tabular-nums ${styles.value}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function HealthTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-xl font-semibold tabular-nums">{Math.round(value * 100)}%</div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

// Keep Badge import satisfied elsewhere.
void Badge;
