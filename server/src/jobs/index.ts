import cron from "node-cron";
import { pollPendingEnrichment, stallOverdueEnrichments } from "./enrichment.job";
import { runMonthlyScoring } from "./scoring.job";
import { scanForEscalations } from "./escalation.job";

/** Starts all recurring background work in-process (node-cron). No queue/Redis
 *  needed at current scale -- see the backend plan for why. */
export function startBackgroundJobs() {
  // Every 3 minutes: pick up newly-submitted leads waiting on enrichment, and
  // separately sweep for any lead that's been sitting in IN_PROGRESS past the
  // stall timeout (see stallOverdueEnrichments) -- distinct concerns run
  // independently so one failing doesn't block the other.
  cron.schedule("*/3 * * * *", () => {
    pollPendingEnrichment().catch((err) => console.error("[jobs] enrichment poll failed:", err));
    stallOverdueEnrichments().catch((err) => console.error("[jobs] stall sweep failed:", err));
  });

  // Hourly: SLA breaches, stale leads, email-queue backlog.
  cron.schedule("0 * * * *", () => {
    scanForEscalations().catch((err) => console.error("[jobs] escalation scan failed:", err));
  });

  // Monthly, 3am on the 1st: recompute every recruiter's score snapshot.
  cron.schedule("0 3 1 * *", () => {
    runMonthlyScoring().catch((err) => console.error("[jobs] monthly scoring failed:", err));
  });

  console.log("[jobs] background jobs scheduled (enrichment: */3min, escalations: hourly, scoring: monthly)");
}
