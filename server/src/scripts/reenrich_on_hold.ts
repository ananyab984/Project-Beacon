/**
 * Batch re-enrichment script for ON_HOLD / STALLED leads.
 * Finds all leads with a valid profileLink that are currently on hold/stalled,
 * runs them through enrichLeadById with concurrency=5,
 * and clears onHoldReason / ON_HOLD flags upon successful completion.
 */
import { PrismaClient, EnrichmentStatus, LeadFlagType, OnHoldReason } from "@prisma/client";
import { enrichLeadById } from "../jobs/enrichment.job";

const prisma = new PrismaClient();
const CONCURRENCY = 5;

async function drainWithConcurrency(
  ids: string[],
  fn: (id: string, idx: number) => Promise<void>
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const i = idx++;
      await fn(ids[i], i).catch((err) =>
        console.error(`  ✗ Error on lead ${ids[i]}:`, err?.message ?? err)
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function main() {
  console.log("============================================================");
  console.log("RE-ENRICHING ON-HOLD & STALLED LEADS");
  console.log("============================================================\n");

  const leads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      profileLink: { not: null, notIn: [""] },
      OR: [
        { enrichmentStatus: EnrichmentStatus.STALLED },
        { flags: { has: LeadFlagType.ON_HOLD }, onHoldReason: { in: [OnHoldReason.SYSTEM_ERROR, OnHoldReason.TIMEOUT] } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      profileLink: true,
      source: true,
      enrichmentStatus: true,
      onHoldReason: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const total = leads.length;
  console.log(`Found ${total} on-hold / stalled leads with valid profileLink to re-enrich.`);
  console.log(`Running with CONCURRENCY=${CONCURRENCY} ...\n`);

  let completedCount = 0;
  const startTime = Date.now();

  await drainWithConcurrency(
    leads.map((l) => l.id),
    async (id, i) => {
      const l = leads[i];
      console.log(`[${i + 1}/${total}] ➔ Starting: ${l.fullName ?? "Unknown"} (${l.profileLink})`);
      await enrichLeadById(id);
      completedCount++;
      const elapsedMins = ((Date.now() - startTime) / 60000).toFixed(1);
      console.log(`[${i + 1}/${total}] ✓ Done: ${l.fullName ?? "Unknown"} (${completedCount}/${total} complete, ${elapsedMins}m elapsed)`);
    }
  );

  console.log("\n============================================================");
  console.log("RE-ENRICHMENT RUN FINISHED — VERIFYING DATABASE STATUS");
  console.log("============================================================\n");

  const afterLeads = await prisma.lead.findMany({
    where: { id: { in: leads.map((l) => l.id) } },
    select: {
      id: true,
      fullName: true,
      enrichmentStatus: true,
      flags: true,
      onHoldReason: true,
      identityResolved: true,
      yearsOfExperience: true,
      email: true,
    },
  });

  const statusSummary: Record<string, number> = {};
  let onHoldCleared = 0;
  let identityResolvedCount = 0;
  let emailCount = 0;

  for (const l of afterLeads) {
    statusSummary[l.enrichmentStatus] = (statusSummary[l.enrichmentStatus] || 0) + 1;
    if (!l.flags.includes("ON_HOLD" as any)) {
      onHoldCleared++;
    }
    if (l.identityResolved) {
      identityResolvedCount++;
    }
    if (l.email) {
      emailCount++;
    }
  }

  console.log(`Total processed:            ${total}`);
  console.log(`ON_HOLD cleared:            ${onHoldCleared}/${total} (${((onHoldCleared / total) * 100).toFixed(1)}%)`);
  console.log(`Identity Resolved:          ${identityResolvedCount}/${total}`);
  console.log(`Emails Present:             ${emailCount}/${total}`);
  console.log("Status Breakdown:");
  for (const [st, count] of Object.entries(statusSummary)) {
    console.log(`  - ${st}: ${count}`);
  }
  console.log("============================================================\n");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
