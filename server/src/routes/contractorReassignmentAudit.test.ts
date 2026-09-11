/**
 * Regression tests for two related vulnerabilities found during the
 * contractor-role security audit, both matching its explicit "cannot
 * reassign leads to themselves or others" requirement:
 *
 * 1. resolveLeadAssignment (lead.routes.ts, used by both POST / and the
 *    bulk-create path): `assignedRecruiterId` used to come straight from
 *    the request body with no role restriction at all, so a contractor
 *    could include an arbitrary recruiterId on their OWN new lead and have
 *    it stamped on. Contractors have no "assign" concept -- this is always
 *    ignored for that role now regardless of what's sent; recruiter/owner
 *    behavior is unchanged.
 *
 * 2. assertContractorBulkUpdateAllowed (PATCH /api/leads/bulk): already had
 *    an ownership check restricting WHICH lead ids a contractor could bulk-
 *    update, but nothing stopped them from reassigning those (fully-owned)
 *    leads to an arbitrary recruiterId. Now rejected outright for
 *    contractor role, regardless of whether every id in the batch is
 *    genuinely theirs.
 *
 * Run: cd server && npx ts-node src/routes/contractorReassignmentAudit.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { resolveLeadAssignment, assertContractorBulkUpdateAllowed } from "./lead.routes";

function test1_contractorNeverGetsAnAssignmentRegardlessOfRequestedValue() {
  const withRequested = resolveLeadAssignment("contractor", "contractor-id", "some-recruiter-id");
  assert.strictEqual(withRequested.assignedRecruiterId, undefined);
  assert.strictEqual(withRequested.assignedAt, undefined);

  const withoutRequested = resolveLeadAssignment("contractor", "contractor-id", undefined);
  assert.strictEqual(withoutRequested.assignedRecruiterId, undefined);
  assert.strictEqual(withoutRequested.assignedAt, undefined);
}

function test2_recruiterAutoAssignsToSelfWhenNoneRequested() {
  const result = resolveLeadAssignment("recruiter", "recruiter-id", undefined);
  assert.strictEqual(result.assignedRecruiterId, "recruiter-id");
  assert.ok(result.assignedAt instanceof Date);
}

function test3_recruitersExplicitRequestIsHonored() {
  const result = resolveLeadAssignment("recruiter", "recruiter-id", "other-recruiter-id");
  assert.strictEqual(result.assignedRecruiterId, "other-recruiter-id");
  assert.ok(result.assignedAt instanceof Date);
}

function test4_ownerWithNoRequestGetsNoAssignment() {
  const result = resolveLeadAssignment("owner", "owner-id", undefined);
  assert.strictEqual(result.assignedRecruiterId, undefined);
  assert.strictEqual(result.assignedAt, undefined);
}

function test5_ownersExplicitRequestIsHonored() {
  const result = resolveLeadAssignment("owner", "owner-id", "some-recruiter-id");
  assert.strictEqual(result.assignedRecruiterId, "some-recruiter-id");
  assert.ok(result.assignedAt instanceof Date);
}

const CONTRACTOR_EMAIL = "test_reassignment_audit_contractor@example.com";
const RECRUITER_EMAIL = "test_reassignment_audit_recruiter@example.com";
const LEAD_OWN = "Test Reassignment Audit Own Lead";
const LEAD_FOREIGN = "Test Reassignment Audit Foreign Lead";

async function cleanup() {
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_OWN, LEAD_FOREIGN] } } });
  await prisma.user.deleteMany({ where: { email: { in: [CONTRACTOR_EMAIL, RECRUITER_EMAIL] } } });
}

async function test6_contractorCannotReassignEvenTheirOwnLead() {
  const contractor = await prisma.user.create({ data: { name: "Test Reassignment Audit Contractor", email: CONTRACTOR_EMAIL, role: "CONTRACTOR" } });
  const recruiter = await prisma.user.create({ data: { name: "Test Reassignment Audit Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" } });
  const ownLead = await prisma.lead.create({ data: { fullName: LEAD_OWN, source: "LINKEDIN", createdByContractorId: contractor.id } });

  await assert.rejects(
    () => assertContractorBulkUpdateAllowed("contractor", contractor.id, [ownLead.id], recruiter.id),
    /cannot reassign/i,
    "a contractor must never be allowed to reassign a lead to a recruiter, even one they fully own"
  );
}

async function test7_contractorBulkUpdateWithoutRecruiterIdOnOwnLeadsPasses() {
  const contractor = await prisma.user.findUniqueOrThrow({ where: { email: CONTRACTOR_EMAIL } });
  const ownLead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_OWN } });
  await assert.doesNotReject(() => assertContractorBulkUpdateAllowed("contractor", contractor.id, [ownLead.id], undefined));
}

async function test8_contractorCannotBulkUpdateAForeignLeadEvenWithoutReassignment() {
  const contractor = await prisma.user.findUniqueOrThrow({ where: { email: CONTRACTOR_EMAIL } });
  const foreignLead = await prisma.lead.create({ data: { fullName: LEAD_FOREIGN, source: "LINKEDIN", createdByContractorId: null } });
  await assert.rejects(() => assertContractorBulkUpdateAllowed("contractor", contractor.id, [foreignLead.id], undefined), /own submitted leads/i);
}

async function test9_recruiterAndOwnerAreUnrestricted() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const foreignLead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_FOREIGN } });
  await assert.doesNotReject(() => assertContractorBulkUpdateAllowed("recruiter", recruiter.id, [foreignLead.id], recruiter.id));
  await assert.doesNotReject(() => assertContractorBulkUpdateAllowed("owner", "irrelevant-owner-id", [foreignLead.id], recruiter.id));
}

async function main() {
  const tests = [
    test1_contractorNeverGetsAnAssignmentRegardlessOfRequestedValue,
    test2_recruiterAutoAssignsToSelfWhenNoneRequested,
    test3_recruitersExplicitRequestIsHonored,
    test4_ownerWithNoRequestGetsNoAssignment,
    test5_ownersExplicitRequestIsHonored,
    test6_contractorCannotReassignEvenTheirOwnLead,
    test7_contractorBulkUpdateWithoutRecruiterIdOnOwnLeadsPasses,
    test8_contractorCannotBulkUpdateAForeignLeadEvenWithoutReassignment,
    test9_recruiterAndOwnerAreUnrestricted,
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
