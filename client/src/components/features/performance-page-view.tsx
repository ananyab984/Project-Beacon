import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { KpiTile } from "@/components/features/kpi";
import { EvaluationDashboard } from "@/components/features/evaluation-dashboard";
import { useAuth } from "@/lib/auth";

const CLOSED_STATUSES = new Set(["CLOSED", "REJECTED", "PLACED", "ON_HOLD"]);

export function PerformancePageView({
  subjectId,
  roleLabel = "Recruiter",
}: {
  subjectId: string;
  roleLabel?: string;
}) {
  const { user } = useAuth();
  const subjectName = user?.name ?? user?.email?.split("@")[0] ?? roleLabel;

  // Live lead-pipeline snapshot for the current user — distinct from the rubric scores below,
  // which are cron-computed for `subjectId`. Sourced from the real leads/conversations/email-queue
  // endpoints (the mock's weekly emails-sent/replied aggregate has no backend equivalent, so the
  // response-rate tile is dropped rather than fabricated).
  const { data: leadsData } = useQuery({ queryKey: ["my-leads"], queryFn: () => api.getMyLeads() });
  const { data: conversationsData } = useQuery({ queryKey: ["conversations"], queryFn: () => api.getConversations() });
  const { data: emailQueueData } = useQuery({ queryKey: ["email-queue"], queryFn: () => api.getEmailQueue() });

  const leads = leadsData?.leads ?? [];
  const conversations = conversationsData?.conversations ?? [];
  const emailQueue = emailQueueData?.items ?? [];

  const assigned = leads.length;
  const active = leads.filter((l) => !CLOSED_STATUSES.has(l.status)).length;
  const unreadConversations = conversations.filter((c) => c.unread).length;
  const followUps = emailQueue.filter((e) => e.status === "FOLLOW_UP" || e.status === "REVIEW_NEEDED").length;
  const dnc = leads.filter((l) => l.flags.includes("DNC")).length;
  const activePct = assigned ? Math.round((active / assigned) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 1. Primary: Lead-specific pipeline state */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-accent/5 to-transparent p-6 shadow-sm">
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Lead pipeline state</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Your active lead activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Live pipeline snapshot — distinct from rubric scores below. These reflect what is currently in your queue.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Assigned leads" value={assigned} unit="score" context={`${active} active`} />
          <KpiTile label="Active leads" value={active} unit="score" context={`${activePct}% of assigned`} />
          <KpiTile label="Unread conversations" value={unreadConversations} unit="score" context="awaiting your reply" />
          <KpiTile label="Follow-ups pending" value={followUps} unit="score" tone={followUps > 10 ? "warning" : "neutral"} context="in email queue" />
          <KpiTile label="DNC count" value={dnc} unit="score" tone={dnc > 8 ? "warning" : "neutral"} context="opted out / bounced" />
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
