/**
 * Regression test for the "Recruiters page needs Recalculate Score clicked
 * over and over" bug. Root cause was in the route layer, not here: GET
 * /recruiters/:id/score and the Reports dashboard both only called
 * computeRecruiterScoreSnapshot() when NO snapshot existed yet for the
 * current month -- once one existed, repeat polls kept re-reading the same
 * frozen row forever. The fix makes both call sites call this function on
 * every read instead of only once.
 *
 * That fix only works if computeRecruiterScoreSnapshot is actually safe to
 * call repeatedly for the same (recruiterId, period): it must (a) reflect
 * newly-added activity on every call, not return a cached answer, and
 * (b) upsert the SAME snapshot row rather than accumulating duplicates every
 * time a poller calls it. This test pins exactly that contract.
 *
 * Run: cd server && npx ts-node src/routes/recruiterScoreSync.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { computeRecruiterScoreSnapshot } from "../jobs/scoring.job";

const RECRUITER_EMAIL = "test_score_sync_recruiter@example.com";
const LEAD_NAME = "Test Score Sync Lead";

async function cleanup() {
  const recruiter = await prisma.user.findUnique({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirst({ where: { fullName: LEAD_NAME } });
  if (lead) {
    await prisma.interactionEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  if (recruiter) {
    await prisma.recruiterMetricSnapshot.deleteMany({ where: { scoreSnapshot: { recruiterId: recruiter.id } } });
    await prisma.recruiterScoreSnapshot.deleteMany({ where: { recruiterId: recruiter.id } });
    await prisma.recruiterKpiSummary.deleteMany({ where: { recruiterId: recruiter.id } });
    await prisma.user.delete({ where: { id: recruiter.id } });
  }
}

async function test1_repeatedComputeReflectsNewActivityWithoutDuplicating() {
  const recruiter = await prisma.user.create({
    data: { name: "Test Score Sync Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" },
  });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_NAME, source: "LINKEDIN" } });
  const now = new Date();

  await prisma.interactionEvent.create({
    data: { leadId: lead.id, recruiterId: recruiter.id, direction: "OUTBOUND", channel: "EMAIL", occurredAt: now },
  });

  const snapshotA = await computeRecruiterScoreSnapshot(recruiter.id, now);
  const metricA = await prisma.recruiterMetricSnapshot.findUnique({
    where: { scoreSnapshotId_metricKey: { scoreSnapshotId: snapshotA.id, metricKey: "outreach_volume" } },
  });
  assert.strictEqual(metricA?.currentValue.toNumber(), 1, "first compute should count the one outbound event so far");

  // Simulate real usage: more outreach happens, then the roster page's next
  // 10s poll calls GET /score again -- which now recomputes unconditionally.
  await prisma.interactionEvent.create({
    data: { leadId: lead.id, recruiterId: recruiter.id, direction: "OUTBOUND", channel: "EMAIL", occurredAt: now },
  });

  const snapshotB = await computeRecruiterScoreSnapshot(recruiter.id, now);
  assert.strictEqual(snapshotB.id, snapshotA.id, "repeat calls for the same period must upsert the same row, not create a duplicate");

  const metricB = await prisma.recruiterMetricSnapshot.findUnique({
    where: { scoreSnapshotId_metricKey: { scoreSnapshotId: snapshotB.id, metricKey: "outreach_volume" } },
  });
  assert.strictEqual(metricB?.currentValue.toNumber(), 2, "second compute must reflect the new event, not return a stale cached count");

  const allSnapshotsForPeriod = await prisma.recruiterScoreSnapshot.count({
    where: { recruiterId: recruiter.id, period: snapshotA.period },
  });
  assert.strictEqual(allSnapshotsForPeriod, 1, "calling compute twice in the same period must not accumulate duplicate snapshot rows");
}

async function main() {
  const tests = [test1_repeatedComputeReflectsNewActivityWithoutDuplicating];
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
