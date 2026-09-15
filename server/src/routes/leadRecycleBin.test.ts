/**
 * Real-DB tests for the Global Leads recycle-bin feature: soft-deleted leads
 * must disappear from the normal pool (buildLeadWhere, shared by GET / and
 * GET /export) and show up only in the bin, and restoring must reverse that
 * exactly. Route handlers themselves aren't spun up over HTTP in this repo's
 * test convention (see leadContractorParity.test.ts) -- this exercises the
 * same Prisma operations POST /batch-delete, POST /:id/restore and
 * GET /bin perform, directly.
 *
 * Run: cd server && npx ts-node src/routes/leadRecycleBin.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { buildLeadWhere } from "../services/lead.service";

const LEAD_ACTIVE = "Test RecycleBin Route Active";
const LEAD_DELETED = "Test RecycleBin Route Deleted";
const RECRUITER_EMAIL = "test_recyclebin_route_recruiter@example.com";

async function cleanup() {
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_ACTIVE, LEAD_DELETED] } } });
  await prisma.user.deleteMany({ where: { email: RECRUITER_EMAIL } });
}

async function test1_buildLeadWhereExcludesSoftDeletedLeadsByDefault() {
  const active = await prisma.lead.create({ data: { fullName: LEAD_ACTIVE, source: "LINKEDIN" } });
  const deleted = await prisma.lead.create({ data: { fullName: LEAD_DELETED, source: "LINKEDIN", deletedAt: new Date() } });

  const pool = await prisma.lead.findMany({ where: { ...buildLeadWhere({}), fullName: { in: [LEAD_ACTIVE, LEAD_DELETED] } } });
  const poolIds = pool.map((l) => l.id);

  assert.ok(poolIds.includes(active.id), "an active (non-deleted) lead must still appear in the normal pool");
  assert.ok(!poolIds.includes(deleted.id), "a soft-deleted lead must never appear in the normal pool's where clause");
}

async function test2_batchDeleteSoftDeletesInsteadOfRemovingTheRow() {
  const recruiter = await prisma.user.create({ data: { name: "Test RecycleBin Route Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_ACTIVE, source: "LINKEDIN" } });

  // Mirrors POST /api/leads/batch-delete exactly.
  const result = await prisma.lead.updateMany({
    where: { id: { in: [lead.id] }, deletedAt: null },
    data: { deletedAt: new Date(), deletedByUserId: recruiter.id },
  });
  assert.strictEqual(result.count, 1);

  const stillExists = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.ok(stillExists, "the lead row must still exist after a batch-delete -- it's a soft delete, not a hard delete");
  assert.ok(stillExists!.deletedAt, "deletedAt must be stamped");
  assert.strictEqual(stillExists!.deletedByUserId, recruiter.id);

  // Now appears in the bin query (GET /bin's where clause)...
  const binHit = await prisma.lead.findFirst({ where: { id: lead.id, deletedAt: { not: null } } });
  assert.ok(binHit, "a soft-deleted lead must show up in the recycle bin query");

  // ...and disappears from the normal pool.
  const poolHit = await prisma.lead.findFirst({ where: { ...buildLeadWhere({}), id: lead.id } });
  assert.strictEqual(poolHit, null, "a soft-deleted lead must not show up in the normal pool query");
}

async function test3_batchDeleteIsIdempotentForAlreadyDeletedLeads() {
  // The `deletedAt: null` guard in the batch-delete where clause must stop a
  // second delete call from resetting an already-deleted lead's clock (which
  // would silently extend its recycle-bin window past 30 days from the
  // original delete).
  const lead = await prisma.lead.create({ data: { fullName: LEAD_ACTIVE, source: "LINKEDIN", deletedAt: new Date(Date.now() - 10 * 86_400_000) } });

  const result = await prisma.lead.updateMany({
    where: { id: { in: [lead.id] }, deletedAt: null },
    data: { deletedAt: new Date(), deletedByUserId: null },
  });
  assert.strictEqual(result.count, 0, "an already-deleted lead must not be re-stamped by a second batch-delete call");
}

async function test4_restoreClearsDeletedAtAndReturnsTheLeadToTheNormalPool() {
  const lead = await prisma.lead.create({ data: { fullName: LEAD_ACTIVE, source: "LINKEDIN", deletedAt: new Date() } });

  // Mirrors POST /api/leads/:id/restore exactly.
  const restored = await prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: null, deletedByUserId: null } });
  assert.strictEqual(restored.deletedAt, null);

  const poolHit = await prisma.lead.findFirst({ where: { ...buildLeadWhere({}), id: lead.id } });
  assert.ok(poolHit, "a restored lead must reappear in the normal pool query");

  const binHit = await prisma.lead.findFirst({ where: { id: lead.id, deletedAt: { not: null } } });
  assert.strictEqual(binHit, null, "a restored lead must no longer appear in the recycle bin query");
}

async function main() {
  const tests = [
    test1_buildLeadWhereExcludesSoftDeletedLeadsByDefault,
    test2_batchDeleteSoftDeletesInsteadOfRemovingTheRow,
    test3_batchDeleteIsIdempotentForAlreadyDeletedLeads,
    test4_restoreClearsDeletedAtAndReturnsTheLeadToTheNormalPool,
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
    await cleanup();
  }
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
