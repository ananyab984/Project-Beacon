import cron from "node-cron";
import { pollPendingEnrichment } from "./enrichment.job";
import { runMonthlyScoring } from "./scoring.job";
import { scanForEscalations } from "./escalation.job";

/** Starts all recurring background work in-process (node-cron). No queue/Redis
 *  needed at current scale -- see the backend plan for why. */
export function startBackgroundJobs() {
  // Every 3 minutes: pick up newly-submitted leads waiting on enrichment.
  cron.schedule("*/3 * * * *", () => {
    pollPendingEnrichment().catch((err) => console.error("[jobs] enrichment poll failed:", err));
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
