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
import {
  resolveLeadIdForInboundMessage,
  applyClassificationResult,
  processInboundMessage,
  buildClassificationText,
} from "./processInboundMessage";

const TEST_CHAT_ID = "test_chat_classification_001";
const TEST_OUTBOUND_MSG_ID = "test_unipile_msg_outbound_echo_001";

async function cleanup() {
  const lead = await prisma.lead.findFirst({ where: { fullName: "Test Wiring Lead" } });
  if (lead) {
    await prisma.replyClassificationEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.replyCategory.deleteMany({ where: { name: { startsWith: "test_" } } });
  await prisma.inboundMessage.deleteMany({ where: { unipileMessageId: { startsWith: "test_unipile_msg_" } } });
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

/**
 * Regression: Unipile echoes the recruiter's OWN sent messages back through
 * the message webhook, and unipile.service.ts deliberately stores those as
 * InboundMessage rows too. Classifying one would treat our own outreach text
 * as the candidate's answer, and a confident match would silently destroy a
 * human's MANUAL override. `isOutbound` is not persisted on the row (it's
 * threaded through as a parameter from handleWebhookEvent), so this tests
 * processInboundMessage(id, isOutbound) at the function level.
 */
async function test6_outboundEchoIsNeverClassified() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const category = await prisma.replyCategory.create({
    data: { groupName: "General Queries", name: "test_Outbound Echo Guard", description: "test" },
  });

  // A human already set this lead's category by hand -- the exact state an
  // echo-triggered classification would clobber.
  await prisma.lead.update({
    where: { id: lead.id },
    data: { replyCategoryId: category.id, replyClassificationSource: "MANUAL" },
  });
  const before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });

  const echo = await prisma.inboundMessage.create({
    data: {
      unipileMessageId: TEST_OUTBOUND_MSG_ID,
      channel: "LINKEDIN",
      accountId: "test_account_outbound_echo",
      threadId: TEST_CHAT_ID,
      sender: "test_recruiter_own_provider_id",
      // Recruiter's own outreach copy -- reads like a candidate reply to a
      // classifier, which is exactly the trap.
      content: "Hi! Are you available for a quick call this week to discuss the role and your rate expectations?",
      receivedAt: new Date(),
    },
  });

  await processInboundMessage(echo.id, true);

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 0, "an outbound echo must never produce a ReplyClassificationEvent");

  const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.strictEqual(after.replyCategoryId, before.replyCategoryId, "the MANUAL override must survive an outbound echo");
  assert.strictEqual(after.replyClassificationSource, "MANUAL");
  assert.strictEqual(
    after.replyClassifiedAt?.getTime() ?? null,
    before.replyClassifiedAt?.getTime() ?? null,
    "replyClassifiedAt must not be touched by an outbound echo"
  );

  const processedRow = await prisma.inboundMessage.findUniqueOrThrow({ where: { id: echo.id } });
  assert.strictEqual(processedRow.processed, true, "the echo row must still end up marked processed");

  await prisma.replyCategory.delete({ where: { id: category.id } });
}

/**
 * A lead often splits one reply across several quick messages before the
 * recruiter answers -- buildClassificationText should combine them, oldest
 * first, with the current message last, so a burst like "Hi!" / "quick
 * question" / "what's your rate?" classifies as one coherent reply instead
 * of three isolated (mostly Unclassified) fragments.
 */
async function test7_combinesUnansweredBurstOldestFirst() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });

  const base = Date.now();
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "Hi!", sentAt: new Date(base) },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "quick question", sentAt: new Date(base + 1000) },
  });

  const combined = await buildClassificationText(conversation.id, "what's your hourly rate?", new Date(base + 2000));

  assert.strictEqual(
    combined,
    "Hi!\n\n---\n\nquick question\n\n---\n\nwhat's your hourly rate?",
    "prior messages must appear oldest-first, current message last"
  );
}

/**
 * Once the recruiter has replied, only THEM messages sent AFTER that reply
 * count as "the current unanswered burst" -- an old message from before the
 * recruiter's last response must not bleed into a fresh classification.
 */
async function test8_excludesMessagesBeforeLastOwnReply() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });

  const base = Date.now();
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "Old unrelated message from before we replied", sentAt: new Date(base) },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "ME", text: "Our reply", sentAt: new Date(base + 1000) },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "Follow-up after your reply", sentAt: new Date(base + 2000) },
  });

  const combined = await buildClassificationText(conversation.id, "one more thing", new Date(base + 3000));

  assert.ok(!combined.includes("Old unrelated message"), "must exclude THEM messages sent before the recruiter's last reply");
  assert.strictEqual(combined, "Follow-up after your reply\n\n---\n\none more thing");
}

/** With no prior messages at all, the current message passes through
 * unchanged -- same behavior as before this feature existed. */
async function test9_noPriorMessagesReturnsCurrentMessageOnly() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });

  const combined = await buildClassificationText(conversation.id, "just this one", new Date());
  assert.strictEqual(combined, "just this one");
}

async function main() {
  const tests = [
    test1_resolvesLeadIdFromMatchingConversation,
    test2_returnsNullWhenNoConversationMatches,
    test3_confidentResultAlwaysOverwrites,
    test4_lowConfidenceOverManualLeavesLeadUntouched,
    test5_lowConfidenceOverAutoOrUnsetClearsToUnclassified,
    test6_outboundEchoIsNeverClassified,
    test7_combinesUnansweredBurstOldestFirst,
    test8_excludesMessagesBeforeLastOwnReply,
    test9_noPriorMessagesReturnsCurrentMessageOnly,
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
