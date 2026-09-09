/**
 * Integration test for the two Prisma queries behind GET
 * /api/enrichment-evaluation (real DB, test-prefixed fixture rows, full
 * cleanup -- same convention as recruiterScoreSync.test.ts). The pure metric
 * math itself is tested separately and DB-free in
 * enrichmentEvaluationMetrics.test.ts; this file only proves the queries
 * feed that function the right shape, including the platform filter and the
 * multi-run (re-enrichment) case.
 *
 * Run: cd server && npx ts-node src/routes/enrichmentEvaluation.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { computeEnrichmentEvaluationMetrics, type LatestRunPerLead } from "../lib/enrichmentEvaluationMetrics";

const LEAD_NAME_LINKEDIN = "Test EnrichEval Lead LinkedIn";
const LEAD_NAME_PROZ = "Test EnrichEval Lead ProZ";
const LEAD_NAME_REENRICHED = "Test EnrichEval Lead Reenriched";

async function cleanup() {
  for (const name of [LEAD_NAME_LINKEDIN, LEAD_NAME_PROZ, LEAD_NAME_REENRICHED]) {
    const lead = await prisma.lead.findFirst({ where: { fullName: name } });
    if (lead) {
      await prisma.enrichmentRun.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.delete({ where: { id: lead.id } });
    }
  }
}

/** Mirrors exactly what the route does for a given (platform, since) filter --
 *  see enrichmentEvaluation.routes.ts. */
async function fetchAndCompute(platform: "LINKEDIN" | "PROZ" | undefined, since: Date | undefined) {
  const runWhere = {
    ...(since ? { concludedAt: { gte: since } } : {}),
    ...(platform ? { platform } : {}),
  };
  const runs = await prisma.enrichmentRun.findMany({
    where: runWhere,
    select: { conclusion: true, tier: true, enrichedFieldCount: true, executionTimeMs: true },
  });
  const latestRunGroups = await prisma.enrichmentRun.groupBy({ by: ["leadId"], where: runWhere, _max: { concludedAt: true } });
  const leadIds = latestRunGroups.map((r) => r.leadId);
  const leads = leadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, enrichmentStatus: true, lastManualOverrideAt: true } })
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const latestRunPerLead: LatestRunPerLead[] = latestRunGroups
    .filter((row) => row._max.concludedAt !== null)
    .map((row) => {
      const lead = leadById.get(row.leadId);
      return {
        leadId: row.leadId,
        latestConcludedAt: row._max.concludedAt as Date,
        isComplete: lead?.enrichmentStatus === "COMPLETE",
        lastManualOverrideAt: lead?.lastManualOverrideAt ?? null,
      };
    });
  return computeEnrichmentEvaluationMetrics(runs, latestRunPerLead);
}

async function test1_platformFilterExcludesOtherPlatformsRuns() {
  const linkedinLead = await prisma.lead.create({
    data: { fullName: LEAD_NAME_LINKEDIN, source: "LINKEDIN", enrichmentStatus: "COMPLETE" },
  });
  const prozLead = await prisma.lead.create({
    data: { fullName: LEAD_NAME_PROZ, source: "PROZ", enrichmentStatus: "COMPLETE" },
  });
  const now = new Date();
  await prisma.enrichmentRun.create({
    data: { leadId: linkedinLead.id, platform: "LINKEDIN", conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_1", enrichedFieldCount: 8, executionTimeMs: 12000, startedAt: now, concludedAt: now },
  });
  await prisma.enrichmentRun.create({
    data: { leadId: prozLead.id, platform: "PROZ", conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_2", enrichedFieldCount: 4, executionTimeMs: 20000, startedAt: now, concludedAt: now },
  });

  const linkedinOnly = await fetchAndCompute("LINKEDIN", undefined);
  assert.strictEqual(linkedinOnly.totalRuns, 1);
  assert.strictEqual(linkedinOnly.tierAttribution.TIER_1, 100, "the ProZ/Tier-2 run must not leak into a LinkedIn-filtered result");

  const all = await fetchAndCompute(undefined, undefined);
  assert.strictEqual(all.totalRuns, 2, "no platform filter must see both runs");
}

async function test2_reenrichmentUsesTheLatestRunForManualOverrideMetric() {
  // Its own dedicated lead/runs, isolated from test1's fixtures -- test1's
  // lead already carries a run dated "now" (today), which would otherwise
  // silently outrank this test's synthetic Jan/Feb 2026 dates as the "most
  // recent run."
  const lead = await prisma.lead.create({
    data: { fullName: LEAD_NAME_REENRICHED, source: "LINKEDIN", enrichmentStatus: "COMPLETE" },
  });
  const firstRunAt = new Date("2026-01-01T00:00:00Z");
  const secondRunAt = new Date("2026-02-01T00:00:00Z");
  const overrideAfterFirstButBeforeSecond = new Date("2026-01-15T00:00:00Z");

  await prisma.enrichmentRun.create({
    data: { leadId: lead.id, platform: "LINKEDIN", conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_1", enrichedFieldCount: 5, executionTimeMs: 9000, startedAt: firstRunAt, concludedAt: firstRunAt },
  });
  await prisma.enrichmentRun.create({
    data: { leadId: lead.id, platform: "LINKEDIN", conclusion: "SHORT_CIRCUIT_SUCCESS", tier: "TIER_2", enrichedFieldCount: 6, executionTimeMs: 11000, startedAt: secondRunAt, concludedAt: secondRunAt },
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { lastManualOverrideAt: overrideAfterFirstButBeforeSecond } });

  // Sharing platform=LINKEDIN with test1's fixture lead (also COMPLETE, no
  // override) means the denominator here is 2 leads, not 1 -- this lead's
  // override state is what changes between the two checks below.
  const result = await fetchAndCompute("LINKEDIN", undefined);
  // This lead's most recent run is secondRunAt; the override predates it,
  // so it must NOT count as an override of the CURRENT (latest) run.
  assert.strictEqual(result.manualOverrideRate, 0, "an override between two runs isn't an override of the latest one");

  // Now push the override to after the latest run -- it should count: 1 of
  // the 2 complete LinkedIn leads in scope is now genuinely overridden.
  const overrideAfterSecond = new Date("2026-02-15T00:00:00Z");
  await prisma.lead.update({ where: { id: lead.id }, data: { lastManualOverrideAt: overrideAfterSecond } });
  const result2 = await fetchAndCompute("LINKEDIN", undefined);
  assert.strictEqual(result2.manualOverrideRate, 50);
}

async function test3_zeroDataPlatformReturnsWellFormedZeros() {
  // No leads/runs exist anywhere for BODALGO in this test's fixtures.
  const result = await fetchAndCompute("PROZ" as any, new Date("2099-01-01"));
  assert.strictEqual(result.totalRuns, 0);
  assert.deepStrictEqual(result.enrichmentPct, { enriched: 0, exhausted: 0, onHold: 0 });
  assert.strictEqual(result.manualOverrideRate, 0);
}

async function main() {
  const tests = [
    test1_platformFilterExcludesOtherPlatformsRuns,
    test2_reenrichmentUsesTheLatestRunForManualOverrideMetric,
    test3_zeroDataPlatformReturnsWellFormedZeros,
  ];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  await cleanup();
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
