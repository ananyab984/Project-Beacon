/**
 * One-off recovery for leads frozen at "Enriching (96%)" by the old bulk
 * upload path (one unbounded enrichLeadById per row; see
 * createLeadsFromRows in src/routes/lead.routes.ts for the fix).
 *
 * Why nothing can just be "marked enriched": enrichLeadById writes the
 * enriched fields and enrichmentStatus in ONE updateMany, then records an
 * EnrichmentRun. So a lead still IN_PROGRESS never got its result written --
 * the run either died with the Node process or finished in Python after Node
 * gave up, and the pipeline keeps no copy. Per lead, this script:
 *   - has an EnrichmentRun for its CURRENT attempt (run.startedAt >= the
 *     lead's enrichmentStartedAt): set the status that run implies -- the
 *     write that should have followed it never landed.
 *   - otherwise: requeue (PENDING, startedAt cleared). The fixed poller
 *     re-runs it POLL_CONCURRENCY at a time.
 *
 * Only touches leads whose run started before --before: run this AFTER the
 * fix is deployed and pass the time that deploy went live. Anything that
 * started before a restart cannot still be in flight in Node, so requeueing
 * it can't double-pay for a run that's still going.
 *
 * Dry run by default:
 *   npx ts-node scripts/recoverStuckEnrichments.ts --before=2026-10-06T12:00:00Z
 *   npx ts-node scripts/recoverStuckEnrichments.ts --before=2026-10-06T12:00:00Z --apply
 */

import assert from "node:assert";
import { PrismaClient, type EnrichmentRunConclusion, type OnHoldReason } from "@prisma/client";
import { computeOnHoldTransition } from "../src/lib/onHoldTransition";

type Run = { startedAt: Date; conclusion: EnrichmentRunConclusion };
type Decision = { kind: "concluded"; run: Run } | { kind: "requeue" };

/** enrichLeadById stamps the same `startedAt` on the lead and on the run it
 *  records, so a run at/after the lead's own startedAt is THIS attempt's. */
export function decide(leadStartedAt: Date | null, latestRun: Run | null): Decision {
  if (latestRun && (!leadStartedAt || latestRun.startedAt >= leadStartedAt)) return { kind: "concluded", run: latestRun };
  return { kind: "requeue" };
}

// Self-check: runs every time, before anything touches the database.
{
  const t0 = new Date("2026-10-06T10:00:00Z");
  const later = new Date("2026-10-06T10:05:00Z");
  assert.deepStrictEqual(decide(t0, null), { kind: "requeue" }, "no run at all -> requeue");
  assert.strictEqual(decide(later, { startedAt: t0, conclusion: "SHORT_CIRCUIT_SUCCESS" }).kind, "requeue", "a PREVIOUS attempt's run must not count");
  assert.strictEqual(decide(t0, { startedAt: t0, conclusion: "SYSTEM_ERROR" }).kind, "concluded", "this attempt's run counts");
  assert.strictEqual(decide(null, { startedAt: t0, conclusion: "EXHAUSTED_NO_MATCH" }).kind, "concluded", "no lead startedAt -> latest run is the one");
}

const OUTCOME: Partial<Record<EnrichmentRunConclusion, "timed_out" | "system_error">> = {
  TIMED_OUT: "timed_out",
  SYSTEM_ERROR: "system_error",
};

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const beforeArg = process.argv.find((a) => a.startsWith("--before="))?.slice("--before=".length);

async function main() {
  const before = beforeArg ? new Date(beforeArg) : null;
  if (!before || isNaN(before.getTime())) {
    console.error("Pass --before=<ISO time the fix was deployed>, e.g. --before=2026-10-06T12:00:00Z");
    process.exit(1);
  }

  const stuck = await prisma.lead.findMany({
    where: {
      enrichmentStatus: "IN_PROGRESS",
      deletedAt: null,
      OR: [{ enrichmentStartedAt: { lt: before } }, { enrichmentStartedAt: null }],
    },
    select: {
      id: true, fullName: true, flags: true, onHoldReason: true, enrichmentStartedAt: true,
      enrichmentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { startedAt: true, conclusion: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const concluded: string[] = [];
  const requeued: string[] = [];
  for (const lead of stuck) {
    const d = decide(lead.enrichmentStartedAt, lead.enrichmentRuns[0] ?? null);
    if (d.kind === "concluded") {
      const outcome = OUTCOME[d.run.conclusion] ?? "concluded_normally";
      const { flags, onHoldReason } = computeOnHoldTransition({
        currentFlags: lead.flags as string[],
        currentOnHoldReason: lead.onHoldReason,
        outcome,
      });
      // Same status enrichLeadById's own write would have set for this outcome.
      const status = outcome === "concluded_normally" ? "COMPLETE" : "PENDING";
      concluded.push(`${lead.fullName} -> ${status}${onHoldReason ? ` (On Hold: ${onHoldReason})` : ""} [run ${d.run.conclusion}]`);
      if (APPLY) {
        await prisma.lead.updateMany({
          where: { id: lead.id, enrichmentStatus: "IN_PROGRESS" },
          data: { enrichmentStatus: status, flags: flags as any, onHoldReason: onHoldReason as OnHoldReason | null },
        });
      }
    } else {
      requeued.push(lead.fullName ?? lead.id);
      if (APPLY) {
        await prisma.lead.updateMany({
          where: { id: lead.id, enrichmentStatus: "IN_PROGRESS" },
          data: { enrichmentStatus: "PENDING", enrichmentStartedAt: null },
        });
      }
    }
  }

  console.log(`${stuck.length} lead(s) stuck IN_PROGRESS with a run started before ${before.toISOString()}.`);
  console.log(`\nHad a result for this attempt, status set from it (${concluded.length}):`);
  concluded.forEach((l) => console.log(`  ${l}`));
  console.log(`\nNo result ever reached the DB, requeued for the poller (${requeued.length}):`);
  requeued.forEach((l) => console.log(`  ${l}`));
  console.log(APPLY ? "\nApplied." : "\nDry run -- nothing written. Re-run with --apply.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
