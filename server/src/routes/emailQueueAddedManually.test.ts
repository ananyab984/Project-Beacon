/**
 * Real-DB tests for EmailQueueItem.addedManually -- the fix for "it should
 * show the number of leads the recruiter themselves added in the queue
 * rather than showing all 27." Before lead.routes.ts's auto-add-on-lead-
 * creation side effect was removed (see leadEmailQueueAutoAdd.test.ts),
 * every lead a recruiter created silently got its own EmailQueueItem row --
 * so removing that side effect stops NEW rows like that, but the queue kept
 * showing (and counting) every OLD row the bug had already created.
 * addedManually distinguishes them: true for anything created via this
 * page's own "Search Lead" -> add action (the only path left that creates a
 * row), false for the backfilled historical auto-added rows (see
 * scripts/backfill-email-queue-added-manually.ts). GET /api/email-queue
 * only returns addedManually: true rows.
 *
 * Also covers POST /api/email-queue's re-add path: a recruiter explicitly
 * adding a lead that already has a hidden (addedManually: false) row must
 * bring that same row back into view, not leave it hidden or duplicate it.
 *
 * Run: cd server && npx ts-node src/routes/emailQueueAddedManually.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { getEmailQueueForRecruiter, addLeadToEmailQueue } from "./email-queue.routes";

const RECRUITER_EMAIL = "test_email_queue_added_manually_recruiter@example.com";
const LEAD_AUTO_ADDED = "Test EmailQueue AddedManually Auto Lead";
const LEAD_EXPLICIT = "Test EmailQueue AddedManually Explicit Lead";
const LEAD_PROMOTED = "Test EmailQueue AddedManually Promoted Lead";

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { fullName: { in: [LEAD_AUTO_ADDED, LEAD_EXPLICIT, LEAD_PROMOTED] } }, select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length) {
    // Defensive: a lead here is genuinely never given a conversation by
    // this test file, but the recruiter row can't be deleted while any FK
    // still references it (e.g. from an inbound-webhook-driven conversation
    // landing on the same shared dev DB during a test run) -- clear those
    // out first rather than leaving the recruiter permanently stuck.
    const conversations = await prisma.conversation.findMany({ where: { leadId: { in: leadIds } }, select: { id: true } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.emailQueueItem.deleteMany({ where: { leadId: { in: leadIds } } });
  }
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_AUTO_ADDED, LEAD_EXPLICIT, LEAD_PROMOTED] } } });
  const recruiter = await prisma.user.findUnique({ where: { email: RECRUITER_EMAIL } });
  if (recruiter) await prisma.conversation.deleteMany({ where: { recruiterId: recruiter.id } });
  await prisma.user.deleteMany({ where: { email: RECRUITER_EMAIL } });
}

async function test1_autoAddedHistoricalRowIsExcludedFromTheList() {
  const recruiter = await prisma.user.create({ data: { name: "Test AddedManually Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_AUTO_ADDED, source: "LINKEDIN", createdByRecruiterId: recruiter.id } });
  await prisma.emailQueueItem.create({
    data: {
      leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!,
      status: "REVIEW_NEEDED", subject: "", body: "", addedManually: false,
    },
  });

  const items = await getEmailQueueForRecruiter(recruiter.id);
  assert.ok(!items.some((i) => i.leadId === lead.id), "an addedManually:false row must never appear in the returned queue");
}

async function test2_explicitlyAddedRowIsIncludedInTheList() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_EXPLICIT, source: "LINKEDIN", createdByRecruiterId: recruiter.id } });
  await prisma.emailQueueItem.create({
    data: {
      leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!,
      status: "REVIEW_NEEDED", subject: "", body: "", addedManually: true,
    },
  });

  const items = await getEmailQueueForRecruiter(recruiter.id);
  assert.ok(items.some((i) => i.leadId === lead.id), "an addedManually:true row must appear in the returned queue");
}

async function test3_countReflectsOnlyExplicitlyAddedLeads() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const items = await getEmailQueueForRecruiter(recruiter.id);
  // Fixtures from tests 1+2: one hidden auto-added row, one visible explicit
  // row -- the returned count must reflect only the explicit one.
  assert.strictEqual(items.length, 1);
}

async function test4_reAddingAHiddenAutoAddedLeadPromotesItIntoView() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_PROMOTED, source: "LINKEDIN", createdByRecruiterId: recruiter.id } });
  const original = await prisma.emailQueueItem.create({
    data: {
      leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!,
      status: "SENT", subject: "Old draft", body: "Already drafted before this fix.", addedManually: false,
    },
  });

  assert.ok(!(await getEmailQueueForRecruiter(recruiter.id)).some((i) => i.leadId === lead.id), "must start hidden");

  const promoted = await addLeadToEmailQueue(lead.id, recruiter.id, "recruiter");
  assert.strictEqual(promoted.id, original.id, "must reuse the existing row, not create a duplicate");
  assert.strictEqual(promoted.body, "Already drafted before this fix.", "existing draft/status history must survive the promotion");

  assert.ok((await getEmailQueueForRecruiter(recruiter.id)).some((i) => i.leadId === lead.id), "must now be visible after the explicit add");

  const count = await prisma.emailQueueItem.count({ where: { leadId: lead.id } });
  assert.strictEqual(count, 1, "promoting must never create a second row for the same lead");
}

async function main() {
  const tests = [
    test1_autoAddedHistoricalRowIsExcludedFromTheList,
    test2_explicitlyAddedRowIsIncludedInTheList,
    test3_countReflectsOnlyExplicitlyAddedLeads,
    test4_reAddingAHiddenAutoAddedLeadPromotesItIntoView,
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
