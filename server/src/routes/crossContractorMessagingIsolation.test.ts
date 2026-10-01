/**
 * Regression tests for a real, confirmed vulnerability found during the
 * contractor-role security audit: a contractor could message ANY lead in
 * the system, not just their own, by passing a guessed/known leadId
 * belonging to a different contractor (or a recruiter) directly to
 * POST /api/email-queue or POST /api/conversations. Neither route checked
 * that the requesting contractor actually owned the target lead before
 * creating an EmailQueueItem/Conversation with the requester as its owner
 * -- every LATER route (GET /:id, POST /:id/messages, generate-draft, send)
 * then trusted that ownership stamp and let them proceed freely.
 *
 * Confirmed live via a direct call to addLeadToEmailQueue before this fix:
 * contractor A successfully queued contractor B's lead. This is exactly
 * the "messaging isolation" failure mode the audit's test plan calls out:
 * "contractor A should not be able to send/view messages tied to
 * contractor B's leads, even with a guessed/known lead ID."
 *
 * conversation.routes.ts's POST / has the identical fix (assertContractorOwnsLead
 * added before creating the conversation) but isn't covered by its own test
 * here -- it's not extracted into a directly-callable function, and testing
 * it would require either a real HTTP harness with a genuine Neon Auth JWT
 * (not obtainable without real credentials) or invasively reaching into
 * Express's router stack to invoke the raw handler. The fix is identical in
 * shape and equally simple (one added assertContractorOwnsLead(...) call
 * verified by direct code read), and it reuses the exact same
 * assertContractorOwnsLead function this file DOES test end-to-end.
 *
 * Run: cd server && npx ts-node src/routes/crossContractorMessagingIsolation.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { addLeadToEmailQueue } from "./email-queue.routes";

const CONTRACTOR_A_EMAIL = "test_cross_contractor_a@example.com";
const CONTRACTOR_B_EMAIL = "test_cross_contractor_b@example.com";
const LEAD_NAME = "Test Cross Contractor B Lead";

async function cleanup() {
  const lead = await prisma.lead.findFirst({ where: { fullName: LEAD_NAME } });
  if (lead) {
    await prisma.emailQueueItem.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.user.deleteMany({ where: { email: { in: [CONTRACTOR_A_EMAIL, CONTRACTOR_B_EMAIL] } } });
}

async function test1_contractorCannotQueueAnotherContractorsLead() {
  const contractorA = await prisma.user.create({ data: { name: "Test Cross Contractor A", email: CONTRACTOR_A_EMAIL, role: "CONTRACTOR" } });
  const contractorB = await prisma.user.create({ data: { name: "Test Cross Contractor B", email: CONTRACTOR_B_EMAIL, role: "CONTRACTOR" } });
  const bLead = await prisma.lead.create({ data: { fullName: LEAD_NAME, source: "LINKEDIN", createdByContractorId: contractorB.id } });

  await assert.rejects(
    () => addLeadToEmailQueue(bLead.id, contractorA.id, "contractor"),
    /own submitted leads/i,
    "a contractor must never be able to add a lead they didn't create to their own queue, even with a known/guessed lead id"
  );

  const leaked = await prisma.emailQueueItem.findFirst({ where: { leadId: bLead.id, recruiterId: contractorA.id } });
  assert.strictEqual(leaked, null, "no EmailQueueItem must exist tying contractor A to contractor B's lead");
}

async function test2_contractorCanStillQueueTheirOwnLead() {
  const contractorB = await prisma.user.findUniqueOrThrow({ where: { email: CONTRACTOR_B_EMAIL } });
  const bLead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });

  const item = await addLeadToEmailQueue(bLead.id, contractorB.id, "contractor");
  assert.strictEqual(item.leadId, bLead.id);
  assert.strictEqual(item.recruiterId, contractorB.id);
}

async function test3_recruiterAndOwnerKeepFullPoolAccessUnaffected() {
  const bLead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });
  const recruiter = await prisma.user.create({ data: { name: "Test Cross Contractor Recruiter", email: "test_cross_contractor_recruiter@example.com", role: "RECRUITER" } });

  try {
    const item = await addLeadToEmailQueue(bLead.id, recruiter.id, "recruiter");
    assert.strictEqual(item.leadId, bLead.id, "a recruiter must retain full-pool access -- this fix must only restrict contractor");
  } finally {
    await prisma.emailQueueItem.deleteMany({ where: { recruiterId: recruiter.id } });
    await prisma.user.delete({ where: { id: recruiter.id } });
  }
}

async function main() {
  const tests = [
    test1_contractorCannotQueueAnotherContractorsLead,
    test2_contractorCanStillQueueTheirOwnLead,
    test3_recruiterAndOwnerKeepFullPoolAccessUnaffected,
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
