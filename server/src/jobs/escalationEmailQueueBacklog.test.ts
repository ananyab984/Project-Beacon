/**
 * Tests for scanEmailQueueBacklog (escalation.job.ts) -- fixes a stale
 * notification confirmed live: "ananya's email queue has 25 unsent drafts"
 * kept showing long after PR #49 (EmailQueueItem.addedManually) corrected
 * the recruiter-facing queue to exclude historical auto-added rows. This
 * scan still counted ALL EmailQueueItem rows regardless of addedManually,
 * so its backlog count never matched what the recruiter could actually see
 * or act on in their own queue (2 real items, not 25).
 *
 * Two things matter: the count itself must match GET /api/email-queue's own
 * addedManually: true filter, and an escalation that's now stale (the
 * condition that created it no longer holds) must actually go away -- this
 * schema has no "resolved" status and nothing else ever revisits an
 * escalation once created, so without an explicit clear-on-recovery step an
 * escalation is permanent even after the real problem is gone.
 *
 * Run: cd server && npx ts-node src/jobs/escalationEmailQueueBacklog.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { scanForEscalations } from "./escalation.job";

const RECRUITER_EMAIL = "test_escalation_backlog_recruiter@example.com";
const CATEGORY = "Email Queue Threshold Alert";
const THRESHOLD = 25;

async function cleanup() {
  const recruiter = await prisma.user.findUnique({ where: { email: RECRUITER_EMAIL } });
  if (recruiter) {
    await prisma.escalation.deleteMany({ where: { recruiterId: recruiter.id } });
    await prisma.emailQueueItem.deleteMany({ where: { recruiterId: recruiter.id } });
  }
  // seedQueueItems creates a fresh Lead per queue item -- must be cleaned up
  // by name pattern, independent of the recruiter row, since Lead has no
  // direct recruiter FK for this creation path (findFirst-per-recruiter
  // above only catches EmailQueueItem/Escalation rows).
  await prisma.lead.deleteMany({ where: { fullName: { startsWith: "Test Escalation Backlog Lead" } } });
  if (recruiter) await prisma.user.delete({ where: { id: recruiter.id } });
}

async function seedQueueItems(recruiterId: string, count: number, addedManually: boolean) {
  await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const lead = await prisma.lead.create({ data: { fullName: `Test Escalation Backlog Lead ${addedManually ? "M" : "A"}${i}`, source: "LINKEDIN" } });
      await prisma.emailQueueItem.create({
        data: {
          leadId: lead.id, recruiterId, candidateName: lead.fullName!,
          status: "REVIEW_NEEDED", subject: "", body: "", addedManually,
        },
      });
    })
  );
}

async function test1_belowThresholdCreatesNoEscalation() {
  const recruiter = await prisma.user.create({ data: { name: "Test Escalation Backlog Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER", isActive: true } });
  await seedQueueItems(recruiter.id, THRESHOLD - 1, true);

  await scanForEscalations();

  const escalation = await prisma.escalation.findFirst({ where: { category: CATEGORY, recruiterId: recruiter.id } });
  assert.strictEqual(escalation, null, "a backlog just under the threshold must not create an escalation");
}

async function test2_autoAddedRowsAreExcludedFromTheCount() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  // Push well past the threshold, but entirely with addedManually: false rows
  // -- the historical auto-added kind GET /api/email-queue already excludes.
  await seedQueueItems(recruiter.id, THRESHOLD + 10, false);

  await scanForEscalations();

  const escalation = await prisma.escalation.findFirst({ where: { category: CATEGORY, recruiterId: recruiter.id } });
  assert.strictEqual(escalation, null, "auto-added rows must not count toward the backlog threshold, same as they're excluded from the visible queue");
}

async function test3_realBacklogAtThresholdCreatesAnEscalationWithTheCorrectCount() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  // From test1: THRESHOLD - 1 addedManually:true rows already exist. One more reaches THRESHOLD.
  await seedQueueItems(recruiter.id, 1, true);

  await scanForEscalations();

  const escalation = await prisma.escalation.findFirst({ where: { category: CATEGORY, recruiterId: recruiter.id } });
  assert.ok(escalation, "a genuinely-added backlog at the threshold must create an escalation");
  assert.ok(escalation!.title.includes(`${THRESHOLD} unsent drafts`), `title must reflect the addedManually-only count, got: ${escalation!.title}`);
}

async function test4_escalationIsAutoClearedOnceTheBacklogDrops() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const before = await prisma.escalation.findFirst({ where: { category: CATEGORY, recruiterId: recruiter.id } });
  assert.ok(before, "sanity check: the escalation from test3 must still be there");

  // Simulate the drafts being sent/discarded.
  await prisma.emailQueueItem.deleteMany({ where: { recruiterId: recruiter.id, addedManually: true } });

  await scanForEscalations();

  const after = await prisma.escalation.findFirst({ where: { category: CATEGORY, recruiterId: recruiter.id } });
  assert.strictEqual(after, null, "an escalation must be cleared once the condition that created it no longer holds -- this schema has no resolved status and nothing else revisits it");
}

async function test5_anInProgressEscalationIsNeverSilentlyDeleted() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  await seedQueueItems(recruiter.id, THRESHOLD, true);
  await scanForEscalations();
  const escalation = await prisma.escalation.findFirstOrThrow({ where: { category: CATEGORY, recruiterId: recruiter.id } });
  await prisma.escalation.update({ where: { id: escalation.id }, data: { status: "IN_PROGRESS" } });

  // Backlog clears while someone is actively working the escalation.
  await prisma.emailQueueItem.deleteMany({ where: { recruiterId: recruiter.id, addedManually: true } });
  await scanForEscalations();

  const stillThere = await prisma.escalation.findUnique({ where: { id: escalation.id } });
  assert.ok(stillThere, "an IN_PROGRESS escalation must never be silently deleted out from under whoever is handling it");
}

async function main() {
  const tests = [
    test1_belowThresholdCreatesNoEscalation,
    test2_autoAddedRowsAreExcludedFromTheCount,
    test3_realBacklogAtThresholdCreatesAnEscalationWithTheCorrectCount,
    test4_escalationIsAutoClearedOnceTheBacklogDrops,
    test5_anInProgressEscalationIsNeverSilentlyDeleted,
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
