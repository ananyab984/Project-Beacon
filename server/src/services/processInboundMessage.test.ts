/**
 * Unit tests for the inbound-message classification wiring. Exercises
 * resolveLeadIdForInboundMessage and applyClassificationResult directly
 * against the real dev DB (no live Groq calls -- classifyReply itself is
 * covered by replyClassifier.test.ts).
 *
 * Run: cd server && npx ts-node src/services/processInboundMessage.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";
import { resolveLeadIdForInboundMessage, applyClassificationResult } from "./processInboundMessage";

const TEST_CHAT_ID = "test_chat_classification_001";

async function cleanup() {
  const lead = await prisma.lead.findFirst({ where: { fullName: "Test Wiring Lead" } });
  if (lead) {
    await prisma.replyClassificationEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.replyCategory.deleteMany({ where: { name: { startsWith: "test_" } } });
}

async function makeLeadWithConversation(recruiterId: string) {
  const lead = await prisma.lead.create({ data: { fullName: "Test Wiring Lead", source: "LINKEDIN" } });
  await prisma.conversation.create({
    data: {
      leadId: lead.id,
      recruiterId,
      candidateName: "Test Wiring Lead",
      channel: "LINKEDIN",
      unipileChatId: TEST_CHAT_ID,
    },
  });
  return lead;
}

async function getOrCreateTestRecruiter(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { role: "RECRUITER" } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: { name: "Test Recruiter", email: `test_recruiter_${Date.now()}@example.com`, role: "RECRUITER" },
  });
  return created.id;
}

async function test1_resolvesLeadIdFromMatchingConversation() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);

  const leadId = await resolveLeadIdForInboundMessage({ channel: "LINKEDIN", threadId: TEST_CHAT_ID });
  assert.strictEqual(leadId, lead.id);
}

async function test2_returnsNullWhenNoConversationMatches() {
  const leadId = await resolveLeadIdForInboundMessage({ channel: "LINKEDIN", threadId: "test_chat_does_not_exist" });
  assert.strictEqual(leadId, null);
}

async function test3_confidentResultAlwaysOverwrites() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const category = await prisma.replyCategory.create({ data: { groupName: "Payment & Invoicing", name: "test_Rate Query Wiring", description: "test" } });

  // Start the lead with a MANUAL override -- a confident AUTO result must
  // still win over it.
  await prisma.lead.update({ where: { id: lead.id }, data: { replyCategoryId: category.id, replyClassificationSource: "MANUAL" } });

  const otherCategory = await prisma.replyCategory.create({ data: { groupName: "General Queries", name: "test_Other Category Wiring", description: "test" } });
  await applyClassificationResult(lead.id, { categoryId: otherCategory.id, confidence: 0.8 });

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, otherCategory.id);
  assert.strictEqual(updated?.replyClassificationSource, "AUTO");

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].source, "AUTO");
  assert.strictEqual(Number(events[0].confidence), 0.8);

  await prisma.replyCategory.deleteMany({ where: { id: { in: [category.id, otherCategory.id] } } });
}

async function test4_lowConfidenceOverManualLeavesLeadUntouched() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const category = await prisma.replyCategory.create({ data: { groupName: "Payment & Invoicing", name: "test_Rate Query Wiring 2", description: "test" } });

  await prisma.lead.update({ where: { id: lead.id }, data: { replyCategoryId: category.id, replyClassificationSource: "MANUAL" } });

  await applyClassificationResult(lead.id, null);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, category.id, "a MANUAL override must survive a low-confidence auto result");
  assert.strictEqual(updated?.replyClassificationSource, "MANUAL");

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 1, "the attempt must still be logged even though the Lead wasn't updated");
  assert.strictEqual(events[0].categoryId, null);

  await prisma.replyCategory.delete({ where: { id: category.id } });
}

async function test5_lowConfidenceOverAutoOrUnsetClearsToUnclassified() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId); // starts with replyClassificationSource = null

  await applyClassificationResult(lead.id, null);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, null);
  assert.strictEqual(updated?.replyClassificationSource, "AUTO");
}

async function main() {
  const tests = [
    test1_resolvesLeadIdFromMatchingConversation,
    test2_returnsNullWhenNoConversationMatches,
    test3_confidentResultAlwaysOverwrites,
    test4_lowConfidenceOverManualLeavesLeadUntouched,
    test5_lowConfidenceOverAutoOrUnsetClearsToUnclassified,
  ];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
      await cleanup();
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
