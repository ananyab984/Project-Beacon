/**
 * Unit tests for markContactedOnFirstOutreach (real DB, matching the
 * convention in src/__tests__/webhook.test.ts).
 *
 * Covers:
 * 1. A NEW lead's first outbound message flips it to CONTACTED + records StageHistory.
 * 2. A lead already past NEW is left untouched by a later call (no re-fire, no duplicate history row).
 * 3. Two "simultaneous" first-outreach calls for the same lead only record StageHistory once.
 *
 * Run: cd server && npx ts-node src/lib/leadStageTransitions.test.ts
 */

import { prisma } from "../prisma";
import { markContactedOnFirstOutreach } from "./leadStageTransitions";

const TEST_EMAIL_PREFIX = "test_stage_transition_";

async function makeRecruiter(suffix: string) {
  return prisma.user.create({
    data: { name: `Test Recruiter ${suffix}`, email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`, role: "RECRUITER" },
  });
}

async function cleanup() {
  const testUsers = await prisma.user.findMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } }, select: { id: true } });
  const userIds = testUsers.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.stageHistory.deleteMany({ where: { changedByRecruiterId: { in: userIds } } });
    await prisma.lead.deleteMany({ where: { createdByRecruiterId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function test1_newLeadFlipsToContactedOnFirstOutreach() {
  const recruiter = await makeRecruiter("1");
  const lead = await prisma.lead.create({ data: { source: "LINKEDIN", createdByRecruiterId: recruiter.id } });
  console.assert(lead.stage === "NEW", "sanity check: a fresh lead starts as NEW");

  await markContactedOnFirstOutreach(lead.id, recruiter.id);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  console.assert(updated?.stage === "CONTACTED", `Expected stage=CONTACTED, got '${updated?.stage}'`);

  const history = await prisma.stageHistory.findMany({ where: { leadId: lead.id } });
  console.assert(history.length === 1, `Expected exactly 1 StageHistory row, got ${history.length}`);
  console.assert(history[0]?.fromStage === "NEW" && history[0]?.toStage === "CONTACTED", "StageHistory from/to mismatch");
  console.assert(history[0]?.changedByRecruiterId === recruiter.id, "StageHistory should credit the sending recruiter");

  console.log("✅ Test 1 PASSED: NEW lead -> CONTACTED + StageHistory recorded on first outreach");
}

async function test2_leadPastNewIsUntouchedByLaterCalls() {
  const recruiter = await makeRecruiter("2");
  const lead = await prisma.lead.create({
    data: { source: "LINKEDIN", createdByRecruiterId: recruiter.id, stage: "NEGOTIATING" },
  });

  await markContactedOnFirstOutreach(lead.id, recruiter.id);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  console.assert(updated?.stage === "NEGOTIATING", `Expected stage to stay NEGOTIATING, got '${updated?.stage}'`);

  const history = await prisma.stageHistory.findMany({ where: { leadId: lead.id } });
  console.assert(history.length === 0, `Expected no StageHistory row for a lead already past NEW, got ${history.length}`);

  console.log("✅ Test 2 PASSED: a lead already past NEW is never touched (a 2nd/3rd message must not re-fire this)");
}

async function test3_concurrentFirstOutreachCallsRecordHistoryOnce() {
  const recruiter = await makeRecruiter("3");
  const lead = await prisma.lead.create({ data: { source: "LINKEDIN", createdByRecruiterId: recruiter.id } });

  // Simulates email + LinkedIn both being the "first" outbound message and
  // racing each other -- only one may actually flip the row.
  await Promise.all([
    markContactedOnFirstOutreach(lead.id, recruiter.id),
    markContactedOnFirstOutreach(lead.id, recruiter.id),
  ]);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  console.assert(updated?.stage === "CONTACTED", `Expected stage=CONTACTED, got '${updated?.stage}'`);

  const history = await prisma.stageHistory.findMany({ where: { leadId: lead.id } });
  console.assert(history.length === 1, `Expected exactly 1 StageHistory row even from 2 racing calls, got ${history.length}`);

  console.log("✅ Test 3 PASSED: two racing first-outreach calls only record StageHistory once");
}

async function runAllTests() {
  console.log("\n🧪 Running markContactedOnFirstOutreach Tests...\n");

  try {
    await cleanup();

    await test1_newLeadFlipsToContactedOnFirstOutreach();
    await test2_leadPastNewIsUntouchedByLaterCalls();
    await test3_concurrentFirstOutreachCallsRecordHistoryOnce();

    console.log("\n🎉 All 3 tests passed!\n");
  } catch (err) {
    console.error("\n💥 Test suite failed:", err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

runAllTests();
