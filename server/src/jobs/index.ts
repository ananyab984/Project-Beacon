import cron from "node-cron";
import { pollPendingEnrichment, stallOverdueEnrichments } from "./enrichment.job";
import { runMonthlyScoring } from "./scoring.job";
import { scanForEscalations } from "./escalation.job";
import { runDueDateReminders } from "./due-date-reminder.job";
import { purgeExpiredRecycleBinLeads } from "./recycleBinPurge.job";
import { sendDailyDemandSummary, sendWeeklyContractorDigest } from "./contractorDigest.job";
import { sendFollowUpNudges } from "./followup-nudge.job";
import { sendWeeklyTeamHealthDigest } from "./ownerDigest.job";
import { runOncePerTick } from "./cronLock";

/** Starts all recurring background work in-process (node-cron). No queue/Redis
 *  needed at current scale -- see the backend plan for why. Every job goes
 *  through runOncePerTick, so running more than one instance still runs each
 *  scheduled job exactly once (see cronLock.ts). */
export function startBackgroundJobs() {
  // Every 3 minutes: pick up newly-submitted leads waiting on enrichment, and
  // separately sweep for any lead that's been sitting in IN_PROGRESS past the
  // stall timeout (see stallOverdueEnrichments) -- distinct concerns run
  // independently so one failing doesn't block the other.
  cron.schedule("*/3 * * * *", () => {
    runOncePerTick("enrichment_poll", pollPendingEnrichment).catch((err) => console.error("[jobs] enrichment poll failed:", err));
    runOncePerTick("enrichment_stall_sweep", stallOverdueEnrichments).catch((err) => console.error("[jobs] stall sweep failed:", err));
  });

  // Hourly: SLA breaches, stale leads, email-queue backlog.
  cron.schedule("0 * * * *", () => {
    runOncePerTick("escalation_scan", scanForEscalations).catch((err) => console.error("[jobs] escalation scan failed:", err));
  });

  // Hourly: nudge recruiters about outreach sent 3+/7+ days ago with no reply.
  cron.schedule("0 * * * *", () => {
    runOncePerTick("follow_up_nudges", sendFollowUpNudges).catch((err) => console.error("[jobs] follow-up nudge scan failed:", err));
  });

  // Monthly, 3am on the 1st: recompute every recruiter's score snapshot.
  cron.schedule("0 3 1 * *", () => {
    runOncePerTick("monthly_scoring", runMonthlyScoring).catch((err) => console.error("[jobs] monthly scoring failed:", err));
  });

  // Daily, 8am: due-date reminders for assigned Requirements nearing deadline.
  cron.schedule("0 8 * * *", () => {
    runOncePerTick("due_date_reminders", runDueDateReminders).catch((err) => console.error("[jobs] due-date reminder scan failed:", err));
  });

  // Daily, 2am: permanently purge Global Leads recycle-bin items whose own
  // 30-day window has elapsed.
  cron.schedule("0 2 * * *", () => {
    runOncePerTick("recycle_bin_purge", purgeExpiredRecycleBinLeads).catch((err) => console.error("[jobs] recycle bin purge failed:", err));
  });

  // Daily, 9am: every contractor gets the org-wide open-demand headcount.
  cron.schedule("0 9 * * *", () => {
    runOncePerTick("daily_demand_summary", sendDailyDemandSummary).catch((err) => console.error("[jobs] daily demand summary failed:", err));
  });

  // Weekly, Monday 8am: every contractor gets their own leads-added and
  // performance-snapshot digest for the past 7 days.
  cron.schedule("0 8 * * 1", () => {
    runOncePerTick("weekly_contractor_digest", sendWeeklyContractorDigest).catch((err) => console.error("[jobs] weekly contractor digest failed:", err));
  });

  // Weekly, Monday 8am: every owner gets a team-health digest (avg score,
  // fill rate, escalation count) for the past 7 days. Independent digest to
  // a different role -- same day/time as the contractor digest is fine.
  cron.schedule("0 8 * * 1", () => {
    runOncePerTick("weekly_team_health_digest", sendWeeklyTeamHealthDigest).catch((err) => console.error("[jobs] weekly owner team-health digest failed:", err));
  });

  console.log("[jobs] background jobs scheduled (enrichment: */3min, escalations: hourly, follow-up nudges: hourly, follow-up sequences: every minute, due-date reminders: daily, recycle bin purge: daily, contractor demand summary: daily, contractor digest: weekly, owner team-health digest: weekly, scoring: monthly)");
}

/** Stops every scheduled job in this process (graceful shutdown). */
export function stopBackgroundJobs() {
  for (const task of cron.getTasks().values()) void task.stop();
}
