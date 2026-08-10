import { CURRENT_RECRUITER_ID, useRecruiterStore } from "@/lib/recruiter-mock";
import { KpiTile } from "@/components/features/kpi";
import { EvaluationDashboard } from "@/components/features/evaluation-dashboard";
import { useAuth } from "@/lib/auth";

export function PerformancePageView({
  subjectId = CURRENT_RECRUITER_ID,
  roleLabel = "Recruiter",
}: { subjectId?: string; roleLabel?: string } = {}) {
  const s = useRecruiterStore();
  const { user } = useAuth();
  const subjectName = user?.name ?? user?.email?.split("@")[0] ?? roleLabel;

  // Lead-specific workflow metrics — NOT in the rubric
  const assigned = 80;
  const active = 44;
  const positive = 16;
  const followUps = 12;
  const emailsSent = s.weekly.reduce((a, w) => a + w.emails_sent, 0);
  const emailsReplied = s.weekly.reduce((a, w) => a + w.emails_replied, 0);
  const dnc = 5;
  const responseRate = emailsSent ? Math.round((emailsReplied / emailsSent) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 1. Primary: Lead-specific pipeline state (Shifted to VERY TOP as requested) */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-accent/5 to-transparent p-6 shadow-sm">
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Lead pipeline state</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Your active lead activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Live pipeline snapshot — distinct from rubric scores below. These reflect what is currently in your queue.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Assigned leads" value={assigned} unit="score" context={`${active} active`} />
          <KpiTile label="Active leads" value={active} unit="score" context={`${Math.round((active / assigned) * 100)}% of assigned`} />
          <KpiTile label="Response rate" value={responseRate} unit="pct" trend={+2} tone="positive" context={`${emailsReplied} of ${emailsSent} emails`} />
          <KpiTile label="Positive replies" value={positive} unit="score" context="qualified responses" />
          <KpiTile label="DNC count" value={dnc} unit="score" tone={dnc > 8 ? "warning" : "neutral"} context="opted out / bounced" />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile label="Follow-ups pending" value={followUps} unit="score" tone={followUps > 10 ? "warning" : "neutral"} context="due this week" />
          <KpiTile label="Emails sent (period)" value={emailsSent} unit="score" context={`${emailsReplied} replies received`} />
        </div>
      </section>

      {/* 2. Secondary: Full Rubric Evaluation Dashboard (with expandable category groups & clean tables) */}
      <EvaluationDashboard
        subjectId={subjectId}
        subjectName={subjectName}
        roleLabel={roleLabel}
        isExpandable={true}
      />
    </div>
  );
}
