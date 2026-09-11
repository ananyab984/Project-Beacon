/**
 * Regression tests for a real, confirmed bug: "not coming along with the
 * loop of [a] particular conversation even if replied from the platform" --
 * a lead's genuine email replies were invisible in the Conversations/Email
 * Queue UI even though they were real, correctly-delivered messages,
 * because Unipile does not keep one stable chat_id for the life of an email
 * exchange the way it does for LinkedIn: an outbound send with no reply_to
 * anchor starts a logically new thread from Unipile's side, and the
 * inbound-matching webhook handler only ever learned ONE chat_id per
 * Conversation (gated behind `unipileChatId: null`), so every later reply
 * that arrived under a different (but equally genuine) chat_id had no path
 * back to the Conversation and was silently dropped into InboundMessage-
 * only.
 *
 * Confirmed against real production data before this fix: a single lead's
 * ongoing email exchange had already fragmented across two different
 * Unipile chat_ids, and several of her real replies under the second one
 * were never attached to the Conversation row the app displays.
 *
 * Two independent fixes, both covered here:
 * 1. findReplyAnchor (unipile.service.ts) -- outbound sends now anchor to
 *    the lead's most recent reply, so future sends are far less likely to
 *    fragment the thread in the first place.
 * 2. The email-identity backfill in handleWebhookEvent no longer requires
 *    `unipileChatId: null` -- it re-matches on every miss, so even if
 *    fragmentation happens anyway, a genuine reply under a NEW chat_id
 *    still finds its way back to the right Conversation.
 *
 * Run: cd server && npx ts-node src/services/emailReplyThreading.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { UnipileService, findReplyAnchor, resolveReplySubject } from "./unipile.service";
import { config } from "../config";

const VALID_TOKEN = config.unipileWebhookPathToken;
const VALID_SECRET = config.unipileWebhookSecret;

const RECRUITER_EMAIL = "test_reply_thread_recruiter@example.com";
const LEAD_EMAIL = "test_reply_thread_lead@example.com";
const LEAD_NAME = "Test Reply Thread Lead";
const ACCOUNT_ID = "test_reply_thread_unipile_acc";

async function cleanup() {
  const recruiter = await prisma.user.findUnique({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirst({ where: { fullName: LEAD_NAME } });
  if (lead) {
    const conversations = await prisma.conversation.findMany({ where: { leadId: lead.id }, select: { id: true } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.inboundMessage.deleteMany({ where: { unipileMessageId: { startsWith: "test_reply_thread_" } } });
  await prisma.unipileWebhookEvent.deleteMany({ where: { dedupeKey: { startsWith: "test_reply_thread_subject_" } } });
  if (recruiter) {
    await prisma.connectedAccount.deleteMany({ where: { userId: recruiter.id } });
    // Defensive: this dev server's own background cron (runMonthlyScoring)
    // can score any active recruiter, including this freshly-created test
    // one, before cleanup runs -- clear those rows first so the user delete
    // below never trips their FK constraint.
    await prisma.recruiterMetricSnapshot.deleteMany({ where: { scoreSnapshot: { recruiterId: recruiter.id } } });
    await prisma.recruiterScoreSnapshot.deleteMany({ where: { recruiterId: recruiter.id } });
    await prisma.recruiterKpiSummary.deleteMany({ where: { recruiterId: recruiter.id } });
    await prisma.user.delete({ where: { id: recruiter.id } });
  }
}

async function test1_findReplyAnchorReturnsTheLatestReply() {
  const recruiter = await prisma.user.create({ data: { name: "Test Reply Thread Recruiter", email: RECRUITER_EMAIL, role: "RECRUITER" } });
  const lead = await prisma.lead.create({ data: { fullName: LEAD_NAME, source: "LINKEDIN", email: LEAD_EMAIL, createdByRecruiterId: recruiter.id } });
  const conversation = await prisma.conversation.create({
    data: { leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!, channel: "EMAIL" },
  });

  const noReplyYet = await findReplyAnchor(lead.id, recruiter.id);
  assert.strictEqual(noReplyYet, undefined, "must return undefined when the lead hasn't replied yet");

  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "ME", text: "Cold outreach", externalMessageId: "outbound-1", sentAt: new Date(Date.now() - 60_000) },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "First reply", externalMessageId: "reply-1", sentAt: new Date(Date.now() - 30_000) },
  });
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, sender: "THEM", text: "Second, more recent reply", externalMessageId: "reply-2", sentAt: new Date() },
  });

  const anchor = await findReplyAnchor(lead.id, recruiter.id);
  assert.strictEqual(anchor, "reply-2", "must anchor to the MOST RECENT reply, not the first one or an outbound message");
}

async function test2_inboundReplyUnderANewChatIdStillReattachesToTheExistingConversation() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });

  await prisma.connectedAccount.create({
    data: {
      userId: recruiter.id,
      provider: "EMAIL",
      unipileAccountId: ACCOUNT_ID,
      accountName: RECRUITER_EMAIL,
      status: "OK",
    },
  });

  // Conversation already carries a chat id from an earlier (real, but now
  // stale) event -- simulating the exact fragmentation confirmed live.
  const existing = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });
  const conversation = await prisma.conversation.update({
    where: { id: existing.id },
    data: { unipileChatId: "stale-thread-id-1" },
  });

  const result = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, {
    event: "mail_received",
    account_id: ACCOUNT_ID,
    message_id: "test_reply_thread_msg_1",
    email_id: "test_reply_thread_msg_1",
    body_plain: "I need information on the MSA process",
    chat_id: "brand-new-thread-id-2", // deliberately different from the stored one
    from_attendee: { identifier: LEAD_EMAIL },
    timestamp: new Date().toISOString(),
  });
  assert.strictEqual(result.status, "processed");

  const updated = await prisma.conversation.findUnique({ where: { id: conversation.id }, include: { messages: true } });
  assert.ok(
    updated!.messages.some((m) => m.externalMessageId === "test_reply_thread_msg_1"),
    "a reply arriving under a NEW chat_id must still be attached to the existing Conversation, not dropped into InboundMessage-only"
  );
  assert.strictEqual(updated!.unipileChatId, "brand-new-thread-id-2", "the Conversation should now track whichever chat_id Unipile is currently using");
}

async function test3_aThirdDifferentChatIdAlsoReattachesNotJustTheSecondOne() {
  // Guards against a fix that only "graduates" the null -> first-value case
  // once: the whole point is that this keeps working no matter how many
  // times fragmentation happens.
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.notStrictEqual(conversation.unipileChatId, null, "sanity check: this conversation already has a chat_id from test2, not null");

  const result = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, {
    event: "mail_received",
    account_id: ACCOUNT_ID,
    message_id: "test_reply_thread_msg_2",
    email_id: "test_reply_thread_msg_2",
    body_plain: "Following up on my previous question",
    chat_id: "yet-another-thread-id-3",
    from_attendee: { identifier: LEAD_EMAIL },
    timestamp: new Date().toISOString(),
  });
  assert.strictEqual(result.status, "processed");

  const updated = await prisma.conversation.findUnique({ where: { id: conversation.id }, include: { messages: true } });
  assert.ok(updated!.messages.some((m) => m.externalMessageId === "test_reply_thread_msg_2"));
}

async function test4_ambiguousLeadEmailAcrossTwoConversationsRefusesToGuess() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });

  // A second EMAIL conversation for the exact same recruiter+lead pair --
  // an edge case, but the identity match must still refuse rather than
  // guessing which of the two this reply belongs to.
  await prisma.conversation.create({
    data: { leadId: lead.id, recruiterId: recruiter.id, candidateName: lead.fullName!, channel: "EMAIL" },
  });

  const result = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, {
    event: "mail_received",
    account_id: ACCOUNT_ID,
    message_id: "test_reply_thread_msg_3",
    email_id: "test_reply_thread_msg_3",
    body_plain: "Ambiguous reply",
    chat_id: "yet-another-thread-id-4",
    from_attendee: { identifier: LEAD_EMAIL },
    timestamp: new Date().toISOString(),
  });
  assert.strictEqual(result.status, "processed");

  const anyMatch = await prisma.conversationMessage.findFirst({ where: { externalMessageId: "test_reply_thread_msg_3" } });
  assert.strictEqual(anyMatch, null, "with 2 conversations sharing this lead's email, the reply must not be silently guessed onto either one");
}

async function test5_resolveReplySubjectMatchesTheExplicitTargetNotTheMostRecentOne() {
  // The actual reported bug: a lead sends two separate emails with two
  // different subjects, then the recruiter replies to the OLDER one via the
  // new per-message picker. The subject must come from that specific
  // message's own thread, not whichever email happens to be newest.
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });

  await prisma.unipileWebhookEvent.create({
    data: {
      dedupeKey: "test_reply_thread_subject_older",
      eventType: "mail_received",
      payload: { event: "mail_received", email_id: "test_reply_thread_subject_msg_older", subject: "Question about the MSA process" },
    },
  });
  await prisma.unipileWebhookEvent.create({
    data: {
      dedupeKey: "test_reply_thread_subject_newer",
      eventType: "mail_received",
      payload: { event: "mail_received", email_id: "test_reply_thread_subject_msg_newer", subject: "Follow-up on payment setup" },
    },
  });

  const subjectForOlder = await resolveReplySubject(lead.id, recruiter.id, "test_reply_thread_subject_msg_older", lead.fullName!);
  assert.strictEqual(subjectForOlder, "Re: Question about the MSA process");

  const subjectForNewer = await resolveReplySubject(lead.id, recruiter.id, "test_reply_thread_subject_msg_newer", lead.fullName!);
  assert.strictEqual(subjectForNewer, "Re: Follow-up on payment setup", "must resolve independently per message id, not always 'the latest'");
}

async function test6_resolveReplySubjectFallsBackWhenNoExplicitTargetOrMatch() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });

  const noTarget = await resolveReplySubject(lead.id, recruiter.id, undefined, "Fallback Label");
  assert.strictEqual(noTarget, "Re: Fallback Label", "with no target and no queue item, falls back to the given label");

  const unmatchedTarget = await resolveReplySubject(lead.id, recruiter.id, "no-such-email-id", "Fallback Label");
  assert.strictEqual(unmatchedTarget, "Re: Fallback Label", "a target with no matching webhook event must also fall back cleanly");
}

async function test7_resolveReplySubjectDoesNotDoublePrefixAnAlreadyReSubject() {
  const recruiter = await prisma.user.findUniqueOrThrow({ where: { email: RECRUITER_EMAIL } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: LEAD_NAME } });

  await prisma.unipileWebhookEvent.create({
    data: {
      dedupeKey: "test_reply_thread_subject_already_re",
      eventType: "mail_received",
      payload: { event: "mail_received", email_id: "test_reply_thread_subject_msg_already_re", subject: "Re: Original question" },
    },
  });

  const subject = await resolveReplySubject(lead.id, recruiter.id, "test_reply_thread_subject_msg_already_re", lead.fullName!);
  assert.strictEqual(subject, "Re: Original question");
}

async function main() {
  const tests = [
    test1_findReplyAnchorReturnsTheLatestReply,
    test2_inboundReplyUnderANewChatIdStillReattachesToTheExistingConversation,
    test3_aThirdDifferentChatIdAlsoReattachesNotJustTheSecondOne,
    test4_ambiguousLeadEmailAcrossTwoConversationsRefusesToGuess,
    test5_resolveReplySubjectMatchesTheExplicitTargetNotTheMostRecentOne,
    test6_resolveReplySubjectFallsBackWhenNoExplicitTargetOrMatch,
    test7_resolveReplySubjectDoesNotDoublePrefixAnAlreadyReSubject,
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
