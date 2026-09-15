/**
 * Tests for contractor/recruiter rubric parity: contractors now get the
 * exact same evaluation dashboard (GET /recruiters/:id/score, /kpi-summary,
 * POST /recompute-score, GET /kpi-config -- all now open to "contractor" in
 * evaluation.routes.ts) that recruiters already had, wired in from the
 * recruiter's own Contractors page (recruiter.contractors.tsx) the same way
 * the owner's Recruiters page already does it for both roles.
 *
 * Two things matter most given that widening:
 * 1. A contractor must only ever view/recompute their OWN score -- unlike
 *    owner/recruiter, who get full cross-user oversight on these routes
 *    (the whole point of a roster page). Opening these routes to
 *    "contractor" without this check would let a contractor view or force-
 *    recompute anyone else's score by id.
 * 2. computeRecruiterScoreSnapshot -- the same function
 *    recruiterScoreSync.test.ts already proves is safe to call repeatedly
 *    for a recruiter -- works identically for a contractor id, since it
 *    takes any user id and has no role check of its own.
 *
 * Deliberately NOT exercising runMonthlyScoring's widened role filter
 * (scoring.job.ts) end-to-end here: that function iterates and computes a
 * real snapshot for every active recruiter/contractor in the WHOLE shared
 * dev DB, which is slow and non-deterministic in cost as a test (it gets
 * slower as the real roster grows, not something scoped to this file's own
 * fixtures) for what is a one-line filter change
 * (`role: "RECRUITER"` -> `role: { in: ["RECRUITER","CONTRACTOR"] }`).
 *
 * Run: cd server && npx ts-node src/routes/contractorEvaluationParity.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { assertContractorViewsOwnScore } from "./evaluation.routes";
import { computeRecruiterScoreSnapshot } from "../jobs/scoring.job";

const CONTRACTOR_EMAIL = "test_eval_parity_contractor@example.com";
const LEAD_NAME = "Test Eval Parity Lead";

async function cleanup() {
  const contractor = await prisma.user.findUnique({ where: { email: CONTRACTOR_EMAIL } });
  const lead = await prisma.lead.findFirst({ where: { fullName: LEAD_NAME } });
  if (lead) {
    await prisma.interactionEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  if (contractor) {
    await prisma.recruiterMetricSnapshot.deleteMany({ where: { scoreSnapshot: { recruiterId: contractor.id } } });
    await prisma.recruiterScoreSnapshot.deleteMany({ where: { recruiterId: contractor.id } });
    await prisma.recruiterKpiSummary.deleteMany({ where: { recruiterId: contractor.id } });
    await prisma.user.delete({ where: { id: contractor.id } });
  }
}

function test1_contractorViewingTheirOwnScorePasses() {
  assert.doesNotThrow(() => assertContractorViewsOwnScore("CONTRACTOR", "user-1", "user-1"));
  assert.doesNotThrow(() => assertContractorViewsOwnScore("contractor", "user-1", "user-1"), "role match must be case-insensitive");
}

function test2_contractorViewingSomeoneElsesScoreIsRejected() {
  assert.throws(() => assertContractorViewsOwnScore("CONTRACTOR", "user-1", "user-2"), /own performance/i);
}

function test3_recruiterAndOwnerKeepFullCrossUserOversight() {
  assert.doesNotThrow(() => assertContractorViewsOwnScore("RECRUITER", "user-1", "user-2"), "a recruiter viewing another user's score is the whole point of the roster page");
  assert.doesNotThrow(() => assertContractorViewsOwnScore("OWNER", "user-1", "user-2"));
}

async function test4_scoreComputationWorksIdenticallyForAContractorId() {
  const contractor = await prisma.user.create({ data: { name: "Test Eval Parity Contractor", email: CONTRACTOR_EMAIL, role: "CONTRACTOR", isActive: true } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_NAME, source: "LINKEDIN" } });
  const now = new Date();

  await prisma.interactionEvent.create({
    data: { leadId: lead.id, recruiterId: contractor.id, direction: "OUTBOUND", channel: "EMAIL", occurredAt: now },
  });

  const snapshot = await computeRecruiterScoreSnapshot(contractor.id, now);
  const metric = await prisma.recruiterMetricSnapshot.findUnique({
    where: { scoreSnapshotId_metricKey: { scoreSnapshotId: snapshot.id, metricKey: "outreach_volume" } },
  });
  assert.strictEqual(
    metric?.currentValue.toNumber(), 1,
    "computeRecruiterScoreSnapshot must compute a real, correct snapshot for a CONTRACTOR-role id, not just a RECRUITER one -- it takes any user id and has no role check of its own"
  );
}

async function main() {
  const tests = [
    test1_contractorViewingTheirOwnScorePasses,
    test2_contractorViewingSomeoneElsesScoreIsRejected,
    test3_recruiterAndOwnerKeepFullCrossUserOversight,
    test4_scoreComputationWorksIdenticallyForAContractorId,
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
