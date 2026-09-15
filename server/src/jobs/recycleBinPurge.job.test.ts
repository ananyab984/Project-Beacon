/**
 * Real-DB tests for the recycle-bin permanent-purge job: each soft-deleted
 * lead must be hard-deleted once ITS OWN 30-day window has elapsed, and left
 * alone otherwise -- covers the "per-item window, not a bin-wide expiry"
 * requirement (Windows Recycle Bin emulation) and that a lead's cascade
 * children (flag events) are cleaned up alongside it.
 *
 * Run: cd server && npx ts-node src/jobs/recycleBinPurge.job.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { purgeExpiredRecycleBinLeads } from "./recycleBinPurge.job";

const LEAD_FRESH = "Test RecycleBin Lead Fresh";
const LEAD_EXPIRED = "Test RecycleBin Lead Expired";
const LEAD_NOT_DELETED = "Test RecycleBin Lead NotDeleted";
const RECRUITER_EMAIL = "test_recyclebin_recruiter@example.com";

const DAY_MS = 24 * 60 * 60 * 1000;

async function cleanup() {
  await prisma.leadFlagEvent.deleteMany({
    where: { lead: { fullName: { in: [LEAD_FRESH, LEAD_EXPIRED, LEAD_NOT_DELETED] } } },
  });
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_FRESH, LEAD_EXPIRED, LEAD_NOT_DELETED] } } });
  await prisma.user.deleteMany({ where: { email: RECRUITER_EMAIL } });
}

async function test1_leadWithinRetentionWindowSurvivesThePurge() {
  const lead = await prisma.lead.create({
    data: { fullName: LEAD_FRESH, source: "LINKEDIN", deletedAt: new Date(Date.now() - 5 * DAY_MS) },
  });

  await purgeExpiredRecycleBinLeads();

  const stillThere = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.ok(stillThere, "a lead only 5 days into its own 30-day window must not be purged yet");
}

async function test2_leadPastItsOwnThirtyDayWindowIsHardDeleted() {
  const recruiter = await prisma.user.create({ data: { name: "Test RecycleBin Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" } });
  const lead = await prisma.lead.create({
    data: { fullName: LEAD_EXPIRED, source: "LINKEDIN", deletedAt: new Date(Date.now() - 31 * DAY_MS) },
  });
  // A cascade child that must be cleaned up alongside the hard delete, not
  // left orphaned or blocking the delete.
  await prisma.leadFlagEvent.create({
    data: { leadId: lead.id, flag: "WATCHING", action: "ADDED", setByRecruiterId: recruiter.id },
  });

  const result = await purgeExpiredRecycleBinLeads();
  assert.ok(result.purgedCount >= 1, "purge must report at least the one expired lead it removed");

  const gone = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(gone, null, "a lead 31 days past its own deletedAt must be permanently removed");
}

async function test3_leadNeverSoftDeletedIsUntouched() {
  const lead = await prisma.lead.create({ data: { fullName: LEAD_NOT_DELETED, source: "LINKEDIN" } });

  await purgeExpiredRecycleBinLeads();

  const stillThere = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.ok(stillThere, "a lead that was never soft-deleted must never be touched by the purge job");
}

async function test4_purgeCutoffIsPerItemNotGlobal() {
  // Two leads soft-deleted on different days, purged in the same run: only
  // the one past ITS OWN window goes, the other (deleted more recently) must
  // survive in the same pass -- pins that the purge isn't "empty everything
  // in the bin older than the oldest item" or any other bin-wide rule.
  const recentlyDeleted = await prisma.lead.create({
    data: { fullName: LEAD_FRESH, source: "LINKEDIN", deletedAt: new Date(Date.now() - 2 * DAY_MS) },
  });
  const longExpired = await prisma.lead.create({
    data: { fullName: LEAD_EXPIRED, source: "LINKEDIN", deletedAt: new Date(Date.now() - 45 * DAY_MS) },
  });

  await purgeExpiredRecycleBinLeads();

  const recentStillThere = await prisma.lead.findUnique({ where: { id: recentlyDeleted.id } });
  const oldGone = await prisma.lead.findUnique({ where: { id: longExpired.id } });
  assert.ok(recentStillThere, "a lead 2 days into its own window must survive");
  assert.strictEqual(oldGone, null, "a lead 45 days into its own window must be purged in the same run");
}

async function main() {
  const tests = [
    test1_leadWithinRetentionWindowSurvivesThePurge,
    test2_leadPastItsOwnThirtyDayWindowIsHardDeleted,
    test3_leadNeverSoftDeletedIsUntouched,
    test4_purgeCutoffIsPerItemNotGlobal,
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
