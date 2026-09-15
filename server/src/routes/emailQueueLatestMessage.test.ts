/**
 * Real-DB tests for getEmailQueueForRecruiter (GET /api/email-queue) --
 * `item.body` is only ever this queue item's OWN outgoing draft/sent text,
 * set once at draft/send time and never updated again, so a candidate's
 * reply landing in the separate Conversation/ConversationMessage tables
 * never reached it. The item correctly climbed to the top of the sort when
 * a reply came in (an existing, already-working behavior), but the list's
 * preview snippet stayed frozen on the initial outgoing mail forever.
 * Confirmed live: "latest mail is not showing in the queue, showing only
 * the initial mail."
 *
 * Run: cd server && npx ts-node src/routes/emailQueueLatestMessage.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { getEmailQueueForRecruiter } from "./email-queue.routes";

const RECRUITER_EMAIL = "test_email_queue_latest_msg_recruiter@example.com";
const LEAD_WITH_REPLY = "Test EmailQueue LatestMsg Lead With Reply";
const LEAD_NO_REPLY = "Test EmailQueue LatestMsg Lead No Reply";

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { fullName: { in: [LEAD_WITH_REPLY, LEAD_NO_REPLY] } }, select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length) {
    const conversations = await prisma.conversation.findMany({ where: { leadId: { in: leadIds } }, select: { id: true } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.emailQueueItem.deleteMany({ where: { leadId: { in: leadIds } } });
  }
  await prisma.lead.deleteMany({ where: { fullName: { in: [LEAD_WITH_REPLY, LEAD_NO_REPLY] } } });
  await prisma.user.deleteMany({ where: { email: RECRUITER_EMAIL } });
}

async function test1_previewPrefersTheLatestReplyOverTheStaleDraftBody() {
  const recruiter = await prisma.user.create({ data: { name: "Test LatestMsg Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_WITH_REPLY, source: "LINKEDIN", createdByRecruiterId: recruiter.id } });

  await prisma.emailQueueItem.create({
    data: {
      leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!,
      status: "SENT", subject: "Intro", body: "This is the original outgoing mail.",
    },
  });

  const conversation = await prisma.conversation.create({
    data: { leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!, channel: "EMAIL", lastMessageAt: new Date() },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "ME", text: "This is the original outgoing mail.", sentAt: new Date(Date.now() - 60_000) },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "Thanks, I am interested -- what is the next step?", sentAt: new Date() },
  });

  const items = await getEmailQueueForRecruiter(recruiter.id);
  const item = items.find((i) => i.leadId === lead.id)!;
  assert.strictEqual(item.latestMessageText, "Thanks, I am interested -- what is the next step?");
  assert.notStrictEqual(item.latestMessageText, item.body, "the preview must not fall back to the stale outgoing draft when a real reply exists");
}

async function test2_noConversationYetFallsBackToNullNotAStaleValue() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_NO_REPLY, source: "LINKEDIN", createdByRecruiterId: recruiter.id } });

  await prisma.emailQueueItem.create({
    data: {
      leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!,
      status: "REVIEW_NEEDED", subject: "", body: "",
    },
  });

  const items = await getEmailQueueForRecruiter(recruiter.id);
  const item = items.find((i) => i.leadId === lead.id)!;
  assert.strictEqual(item.latestMessageText, null);
}

async function test3_itemsAreScopedToTheRequestingRecruiterOnly() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const items = await getEmailQueueForRecruiter(recruiter.id);
  assert.ok(items.every((i) => i.recruiterId === recruiter.id));
}

async function main() {
  const tests = [
    test1_previewPrefersTheLatestReplyOverTheStaleDraftBody,
    test2_noConversationYetFallsBackToNullNotAStaleValue,
    test3_itemsAreScopedToTheRequestingRecruiterOnly,
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
