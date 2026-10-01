/**
 * Real-DB tests for getOutreachFunnelLeadIds -- the shared computation
 * behind the dashboard's clickable outreach-funnel tiles (Contacted/
 * Awaiting Reply/Replied/In Negotiation/DNC/Onboarded). Added as part of
 * making these tiles interactive on the recruiter and contractor
 * dashboards, not just the owner's.
 *
 * Two things matter most here: the new "onboarded" category actually counts
 * ONBOARDED-stage leads, and the 3-way ownership branch (owner/recruiter/
 * contractor) genuinely isolates each contractor to their own leads --
 * this endpoint was newly opened to the contractor role as part of this
 * change, and its ownership scoping previously only had two branches
 * (owner vs. "everyone else uses the recruiter-assignment fields"), which
 * would have matched nothing (or worse, leaked) for a contractor's own
 * createdByContractorId-scoped leads.
 *
 * Run: cd server && npx ts-node src/routes/outreachFunnel.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { getOutreachFunnelLeadIds } from "./reports.routes";

const LEAD_A = "Test Funnel Lead A";
const LEAD_B = "Test Funnel Lead B";
const CONTRACTOR_A_EMAIL = "test_funnel_contractor_a@example.com";
const CONTRACTOR_B_EMAIL = "test_funnel_contractor_b@example.com";

async function cleanup() {
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_A, LEAD_B] } } });
  await prisma.user.deleteMany({ where: { email: { in: [CONTRACTOR_A_EMAIL, CONTRACTOR_B_EMAIL] } } });
}

async function test1_onboardedCategoryCountsOnboardedStageLeads() {
  const contractor = await prisma.user.create({ data: { name: "Test Funnel Contractor A", email: CONTRACTOR_A_EMAIL, role: "CONTRACTOR" } });
  const lead = await prisma.lead.create({
    data: { fullName: LEAD_A, source: "LINKEDIN", stage: "ONBOARDED", createdByContractorId: contractor.id },
  });

  const ids = await getOutreachFunnelLeadIds("contractor", contractor.id, "all");
  assert.ok(ids.onboarded.includes(lead.id), "an ONBOARDED-stage lead owned by this contractor must appear in their onboarded set");
}

async function test2_contractorIsScopedToOwnLeadsOnly() {
  const contractorA = await prisma.user.findUniqueOrThrow({ where: { email: CONTRACTOR_A_EMAIL } });
  const contractorB = await prisma.user.create({ data: { name: "Test Funnel Contractor B", email: CONTRACTOR_B_EMAIL, role: "CONTRACTOR" } });
  const leadB = await prisma.lead.create({
    data: { fullName: LEAD_B, source: "LINKEDIN", stage: "ONBOARDED", createdByContractorId: contractorB.id },
  });

  const idsForA = await getOutreachFunnelLeadIds("contractor", contractorA.id, "all");
  assert.ok(!idsForA.onboarded.includes(leadB.id), "contractor A must never see contractor B's onboarded lead");

  const idsForB = await getOutreachFunnelLeadIds("contractor", contractorB.id, "all");
  assert.ok(idsForB.onboarded.includes(leadB.id), "contractor B must see their own onboarded lead");
}

async function test3_ownerSeesEveryContractorsLeads() {
  const contractorA = await prisma.user.findUniqueOrThrow({ where: { email: CONTRACTOR_A_EMAIL } });
  const contractorB = await prisma.user.findUniqueOrThrow({ where: { email: CONTRACTOR_B_EMAIL } });
  const leadA = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_A } });
  const leadB = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_B } });

  const idsForOwner = await getOutreachFunnelLeadIds("owner", "irrelevant-owner-id", "all");
  assert.ok(idsForOwner.onboarded.includes(leadA.id));
  assert.ok(idsForOwner.onboarded.includes(leadB.id));
}

async function main() {
  const tests = [
    test1_onboardedCategoryCountsOnboardedStageLeads,
    test2_contractorIsScopedToOwnLeadsOnly,
    test3_ownerSeesEveryContractorsLeads,
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
