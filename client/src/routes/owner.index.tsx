import { createFileRoute } from "@tanstack/react-router";
import {
  recruiters,
  useClientDemands,
  outreachBatch,
  profileCompleteness,
  getCombinedEscalations,
  useRequirements,
  recruiterById,
  teamKpis,
} from "@/lib/g3-mock";
import { FEATURES } from "@/lib/feature-flags";
import {
  Radio,
  Mail,
  MailOpen,
  MessageSquare,
  Handshake,
  ShieldCheck,
  AlertOctagon,
  ShieldOff,
  Gauge,
  AlertTriangle,
} from "lucide-react";
import { KpiTile, ScoreRing } from "@/components/features/kpi";
import { DateRangeSelect, useDateRange, scaleValue } from "@/components/features/date-range-toggle";
import { useMemo } from "react";

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
  const clientDemands = useClientDemands();
  const reqs = useRequirements();
  const escalationsList = useMemo(() => getCombinedEscalations(), [reqs]);
  const { scale, label: rangeLabel } = useDateRange();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Good Morning Ethan Hero Header Block */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/[0.04] via-accent/[0.05] to-warning/[0.06] p-6">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Owner overview</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Overview Dashboard</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {escalationsList.length} items need your attention across {recruiters.length} recruiters and{" "}
            {clientDemands.length} active language demands.
          </p>
        </div>
      </section>

      {/* Data Health — AI/enrichment surface */}
      {FEATURES.ai && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
                <ShieldCheck className="h-3 w-3" /> Data health
              </div>
              <div className="mt-0.5 text-sm font-semibold">Profile completeness</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums text-accent">
                {Math.round(profileCompleteness.after_enrichment * 100)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                from {Math.round(profileCompleteness.before_enrichment * 100)}% pre-enrichment
              </div>
            </div>
          </div>
          <div className="mt-4 relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 bg-muted-foreground/40"
              style={{ width: `${profileCompleteness.before_enrichment * 100}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-accent"
              style={{ width: `${profileCompleteness.after_enrichment * 100}%`, mixBlendMode: "multiply" }}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HealthTile label="Verified email" value={profileCompleteness.verified_email_pct} />
            <HealthTile label="Confirmed language pair" value={profileCompleteness.confirmed_language_pair_pct} />
            <HealthTile label="Experience data" value={profileCompleteness.experience_data_pct} />
          </div>
        </section>
      )}

      {/* Live outreach — 5 discrete blocks with DateRangeSelect aligned to the right */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
              <Radio className="h-3 w-3" /> Live outreach
            </div>
            <div className="mt-0.5 text-sm font-semibold">Current batch</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">updates every 60s</span>
            <DateRangeSelect />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
              <Gauge className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-accent">Team health</div>
              <div className="mt-0.5 text-sm font-semibold">Evaluation framework · {rangeLabel.toLowerCase()}</div>
            </div>
          </div>
          <ScoreRing score={team.overall_score} size={72} label="Team score" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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

      {/* Compact Escalations & Risk Summary (Full list in Notifications Bell) */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-warning/15 text-warning">
              <AlertOctagon className="h-3.5 w-3.5" />
            </span>
            <div className="text-sm font-semibold">Escalated Items & Client Due Date Risks</div>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
              {escalationsList.length}
            </span>
          </div>
          <span className="text-xs text-muted-foreground font-medium">Check Notifications Bell for complete list</span>
        </div>
        <ul className="divide-y divide-border/60">
          {escalationsList.slice(0, 2).map((e) => {
            const rec = e.recruiter_id ? recruiterById(e.recruiter_id) : undefined;
            const isClientRisk = e.category === "Client Risk";
            const priorityStyle =
              e.priority === "P1"
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : e.priority === "P2"
                  ? "border-warning/50 bg-warning/10 text-warning"
                  : "border-accent/40 bg-accent/10 text-accent";

            return (
              <li key={e.id} className="py-2.5 transition-colors hover:bg-muted/20">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${priorityStyle}`}>
                      {e.priority}
                    </span>
                    {isClientRisk && (
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold text-destructive flex items-center gap-1 shrink-0">
                        <AlertTriangle className="h-3 w-3" /> Client Due Date Alert
                      </span>
                    )}
                    <span className="text-xs font-semibold text-foreground truncate">{e.title}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    Owner: <span className="text-foreground font-medium">{e.owner}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Recruiter Roster */}
    </div>
  );
}

function HealthTile({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-lg font-bold tabular-nums text-foreground">{pct}%</span>
        <span className="text-[10px] text-accent font-medium">Enriched</span>
      </div>
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
