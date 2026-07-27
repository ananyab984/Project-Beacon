import { createFileRoute } from "@tanstack/react-router";
import { CURRENT_RECRUITER_ID, useRecruiterStore } from "@/lib/recruiter-mock";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/g3/kpi";
import { EvaluationDashboard } from "@/components/g3/evaluation-dashboard";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/recruiter/performance")({
  head: () => ({ meta: [{ title: "Lead Performance — Global3 Recruiter" }] }),
  component: PerformancePage,
});

export function PerformancePage({
  subjectId = CURRENT_RECRUITER_ID,
  roleLabel = "Recruiter",
}: { subjectId?: string; roleLabel?: string } = {}) {
  const s = useRecruiterStore();
  const { user } = useAuth();

  // Recruiter workflow metrics — derived from mock store where possible,
  // otherwise mocked at realistic values.
  const assigned = 80;
  const contacted = 62;
  const active = 44;
  const emailsSent = s.weekly.reduce((a, w) => a + w.emails_sent, 0);
  const emailsReplied = s.weekly.reduce((a, w) => a + w.emails_replied, 0);
  const positive = 16;
  const followUps = 12;
  const interviews = 7;
  const offers = 3;
  const dnc = 5;
  const responseRate = emailsSent ? Math.round((emailsReplied / emailsSent) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <EvaluationDashboard
        subjectId={subjectId}
        subjectName={user?.name ?? roleLabel}
        roleLabel={roleLabel}
      />

      <section className="rounded-2xl border border-border bg-gradient-to-br from-accent/5 via-primary/5 to-transparent p-6">
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Lead activity</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Your lead activity — last 30 days</h2>
        <p className="mt-1 text-sm text-muted-foreground">Workflow metrics that reflect what you actually do on leads. Not a leaderboard.</p>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <KpiTile label="Assigned leads" value={assigned} unit="score" context={`${active} active`} />
          <KpiTile label="Leads contacted" value={contacted} unit="score" context={`${contacted} / ${assigned}`} />
          <KpiTile label="Emails sent" value={emailsSent} unit="score" context={`${emailsReplied} replies`} />
          <KpiTile label="Response rate" value={responseRate} unit="pct" trend={+2} tone="positive" />
          <KpiTile label="Positive responses" value={positive} unit="score" context="qualified replies" />
          <KpiTile label="Follow-ups pending" value={followUps} unit="score" tone={followUps > 10 ? "warning" : "neutral"} context="due this week" />
          <KpiTile label="Interviews scheduled" value={interviews} unit="score" context={`${offers} offers sent`} />
          <KpiTile label="DNC count" value={dnc} unit="score" tone={dnc > 8 ? "warning" : "neutral"} context="opted out / bounced" />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-primary">Weekly Outreach Engagement</div>
            <h2 className="mt-1 text-lg font-semibold">Sent vs Replied — Email &amp; DMs</h2>
          </div>
        </div>
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={s.weekly} margin={{ top: 20, right: 20, left: 0, bottom: 8 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.25)" }} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={8} />
              <Bar dataKey="emails_replied" stackId="e" name="Emails Replied" fill="var(--primary)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="emails_sent" stackId="e" name="Emails Sent" fill="color-mix(in oklab, var(--primary) 25%, var(--muted))" radius={[6, 6, 0, 0]} />
              <Bar dataKey="dms_replied" stackId="d" name="DMs Replied" fill="var(--accent)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="dms_sent" stackId="d" name="DMs Sent" fill="color-mix(in oklab, var(--accent) 25%, var(--muted))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Stacked bars compare outreach volume to engaged replies per channel. No leaderboards — this view is for your own tracking.
        </p>
      </section>
    </div>
  );
}