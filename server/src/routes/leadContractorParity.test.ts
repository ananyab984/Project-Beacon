/**
 * Unit + real-DB tests for the contractor ownership scoping added to
 * lead.routes.ts as part of contractor/recruiter feature parity (retry-
 * enrichment, flags, reenrich, bulk PATCH/delete/export). Three of those
 * routes (bulk PATCH, batch-delete, export) previously had NO ownership
 * check at all -- they trusted only recruiter/owner ever called them. Opening
 * them to contractor required adding real scoping, not just an RBAC toggle;
 * these tests pin that scoping actually works, both the pure single-lead
 * check (assertContractorOwnsLead) and the real "any foreign id in this
 * batch" query pattern used by the bulk routes.
 *
 * Run: cd server && npx ts-node src/routes/leadContractorParity.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { assertContractorOwnsLead } from "./lead.routes";
import { ApiError } from "../lib/apiError";

const LEAD_A = "Test Parity Lead A";
const LEAD_B = "Test Parity Lead B";
const CONTRACTOR_A_EMAIL = "test_parity_contractor_a@example.com";
const CONTRACTOR_B_EMAIL = "test_parity_contractor_b@example.com";

async function cleanup() {
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_A, LEAD_B] } } });
  await prisma.user.deleteMany({ where: { email: { in: [CONTRACTOR_A_EMAIL, CONTRACTOR_B_EMAIL] } } });
}

function test1_ownerAndRecruiterAreNeverRestricted() {
  const lead = { createdByContractorId: "someone-elses-id" };
  assert.doesNotThrow(() => assertContractorOwnsLead("owner", "my-id", lead));
  assert.doesNotThrow(() => assertContractorOwnsLead("recruiter", "my-id", lead));
}

function test2_contractorOwningTheLeadPasses() {
  assert.doesNotThrow(() => assertContractorOwnsLead("contractor", "contractor-1", { createdByContractorId: "contractor-1" }));
}

function test3_contractorNotOwningTheLeadIsRejected() {
  assert.throws(
    () => assertContractorOwnsLead("contractor", "contractor-1", { createdByContractorId: "contractor-2" }),
    (err: unknown) => err instanceof ApiError && err.statusCode === 403
  );
}

function test4_contractorAgainstAnUnownedLeadIsRejected() {
  // createdByContractorId null (a recruiter-added or global-pool lead) must
  // not be treated as "no owner, anyone may act" -- still rejected.
  assert.throws(
    () => assertContractorOwnsLead("contractor", "contractor-1", { createdByContractorId: null }),
    (err: unknown) => err instanceof ApiError && err.statusCode === 403
  );
}

async function test5_bulkOwnershipQueryDetectsAForeignIdInTheBatch() {
  // Mirrors the exact check PATCH /bulk and POST /batch-delete run before
  // acting on a list of ids: count how many of the requested ids are NOT
  // owned by this contractor -- any non-zero count must block the whole
  // batch, not silently skip the foreign ones.
  const contractorA = await prisma.user.create({ data: { name: "Test Parity Contractor A", email: CONTRACTOR_A_EMAIL, role: "CONTRACTOR" } });
  const contractorB = await prisma.user.create({ data: { name: "Test Parity Contractor B", email: CONTRACTOR_B_EMAIL, role: "CONTRACTOR" } });
  const leadA = await prisma.lead.create({ data: { fullName: LEAD_A, source: "LINKEDIN", createdByContractorId: contractorA.id } });
  const leadB = await prisma.lead.create({ data: { fullName: LEAD_B, source: "LINKEDIN", createdByContractorId: contractorB.id } });

  const foreignCountForOwnBatch = await prisma.lead.count({
    where: { id: { in: [leadA.id] }, createdByContractorId: { not: contractorA.id } },
  });
  assert.strictEqual(foreignCountForOwnBatch, 0, "a batch containing only the contractor's own lead must find zero foreign ids");

  const foreignCountForMixedBatch = await prisma.lead.count({
    where: { id: { in: [leadA.id, leadB.id] }, createdByContractorId: { not: contractorA.id } },
  });
  assert.strictEqual(foreignCountForMixedBatch, 1, "a batch containing one foreign lead must be caught, not silently pass");
}

async function main() {
  const tests = [
    test1_ownerAndRecruiterAreNeverRestricted,
    test2_contractorOwningTheLeadPasses,
    test3_contractorNotOwningTheLeadIsRejected,
    test4_contractorAgainstAnUnownedLeadIsRejected,
    test5_bulkOwnershipQueryDetectsAForeignIdInTheBatch,
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
