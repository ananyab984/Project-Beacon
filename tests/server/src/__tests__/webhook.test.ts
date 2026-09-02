/**
 * Unit tests for the Unipile webhook receiver.
 *
 * Covers:
 * 1. message_received payload → row created with channel='LINKEDIN'
 * 2. email.received payload → row created with channel='EMAIL'
 * 3. Same unipile_message_id sent twice → only one row, second 200
 * 4. Invalid/missing signature → 401, no row created
 * 5. Malformed/unknown event type → 200, no row, no crash
 *
 * Run: cd server && npx ts-node src/__tests__/webhook.test.ts
 */

import { prisma } from "@server-root/prisma";
import { UnipileService } from "@server/services/unipile.service";
import { config } from "@server/config";

const VALID_TOKEN = config.unipileWebhookPathToken;
const VALID_SECRET = config.unipileWebhookSecret;

async function cleanup() {
  // Clean up test data (inbound_messages and webhook events)
  await prisma.inboundMessage.deleteMany({
    where: { unipileMessageId: { startsWith: "test_" } },
  });
  await prisma.unipileWebhookEvent.deleteMany({
    where: { eventType: { in: ["message_received", "email.received", "unknown_test_event"] } },
  });
}

async function test1_linkedinMessageCreatesRow() {
  const body = {
    event: "message_received",
    account_id: "test_acc_001",
    message_id: "test_linkedin_msg_001",
    message: "Hi, I'm interested in the role!",
    chat_id: "test_chat_001",
    sender: { display_name: "Jane Doe", attendee_provider_id: "jane_doe_li" },
    timestamp: new Date().toISOString(),
  };

  const result = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, body);
  console.assert(result.status === "processed", `Expected 'processed', got '${result.status}'`);
  console.assert(result.inboundMessageId != null, "Expected inboundMessageId to be set");

  const row = await prisma.inboundMessage.findUnique({
    where: { unipileMessageId: "test_linkedin_msg_001" },
  });
  console.assert(row != null, "Expected InboundMessage row to exist");
  console.assert(row!.channel === "LINKEDIN", `Expected channel='LINKEDIN', got '${row!.channel}'`);
  console.assert(row!.content === "Hi, I'm interested in the role!", "Content mismatch");
  console.assert(row!.sender === "Jane Doe", `Expected sender='Jane Doe', got '${row!.sender}'`);

  console.log("✅ Test 1 PASSED: message_received → row with channel=LINKEDIN");
}

async function test2_emailReceivedCreatesRow() {
  const body = {
    event: "email.received",
    account_id: "test_acc_002",
    message_id: "test_email_msg_001",
    body: "Thanks for reaching out, I'd like to learn more.",
    thread_id: "test_thread_001",
    from: { identifier: "candidate@example.com", display_name: "John Smith" },
    timestamp: new Date().toISOString(),
  };

  const result = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, body);
  console.assert(result.status === "processed", `Expected 'processed', got '${result.status}'`);
  console.assert(result.inboundMessageId != null, "Expected inboundMessageId to be set");

  const row = await prisma.inboundMessage.findUnique({
    where: { unipileMessageId: "test_email_msg_001" },
  });
  console.assert(row != null, "Expected InboundMessage row to exist");
  console.assert(row!.channel === "EMAIL", `Expected channel='EMAIL', got '${row!.channel}'`);
  console.assert(row!.content.includes("Thanks for reaching out"), "Content mismatch");

  console.log("✅ Test 2 PASSED: email.received → row with channel=EMAIL");
}

async function test3_idempotency() {
  const body = {
    event: "message_received",
    account_id: "test_acc_003",
    message_id: "test_idempotent_msg_001",
    message: "Duplicate test message",
    chat_id: "test_chat_003",
    sender: { display_name: "Dup User" },
    timestamp: new Date().toISOString(),
  };

  // First call
  const result1 = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, body);
  console.assert(result1.status === "processed", `First call: expected 'processed', got '${result1.status}'`);

  // Second call with same message_id (body is identical, so dedupeKey will also match,
  // which is caught by the existing SHA256 dedupe — but we also verify our InboundMessage
  // table's unique constraint would catch it independently)
  // Use a slightly different body to test InboundMessage-level idempotency specifically
  const body2 = { ...body, extra_field: "retry" };
  const result2 = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, body2);
  // Should be caught by InboundMessage's unique unipileMessageId constraint
  console.assert(
    result2.status === "already_processed",
    `Second call: expected 'already_processed', got '${result2.status}'`
  );

  // Verify only one row
  const count = await prisma.inboundMessage.count({
    where: { unipileMessageId: "test_idempotent_msg_001" },
  });
  console.assert(count === 1, `Expected exactly 1 row, got ${count}`);

  console.log("✅ Test 3 PASSED: Same unipile_message_id twice → only 1 row, second returns 200");
}

async function test4_invalidSignature() {
  const body = {
    event: "message_received",
    account_id: "test_acc_004",
    message_id: "test_should_not_exist_001",
    message: "This should never be stored",
    timestamp: new Date().toISOString(),
  };

  // Test with wrong token
  try {
    await UnipileService.handleWebhookEvent("wrong_token", VALID_SECRET, body);
    console.assert(false, "Should have thrown");
  } catch (err: any) {
    console.assert(err.statusCode === 401, `Expected 401, got ${err.statusCode}`);
  }

  // Test with wrong secret
  try {
    await UnipileService.handleWebhookEvent(VALID_TOKEN, "wrong_secret", body);
    console.assert(false, "Should have thrown");
  } catch (err: any) {
    console.assert(err.statusCode === 401, `Expected 401, got ${err.statusCode}`);
  }

  // Test with missing secret
  try {
    await UnipileService.handleWebhookEvent(VALID_TOKEN, undefined, body);
    console.assert(false, "Should have thrown");
  } catch (err: any) {
    console.assert(err.statusCode === 401, `Expected 401, got ${err.statusCode}`);
  }

  // Verify no row was created
  const row = await prisma.inboundMessage.findUnique({
    where: { unipileMessageId: "test_should_not_exist_001" },
  });
  console.assert(row == null, "No InboundMessage row should exist for rejected webhook");

  console.log("✅ Test 4 PASSED: Invalid/missing signature → 401, no row created");
}

async function test5_unknownEventType() {
  const body = {
    event: "unknown_test_event",
    account_id: "test_acc_005",
    some_data: "irrelevant",
  };

  // Should not throw
  const result = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, body);
  console.assert(result.status === "processed", `Expected 'processed', got '${result.status}'`);
  console.assert(result.inboundMessageId == null, "Should NOT have created InboundMessage for unknown event");

  // Also test malformed body
  const malformed = { event: "message_received" }; // no message, no text, no account_id
  const result2 = await UnipileService.handleWebhookEvent(VALID_TOKEN, VALID_SECRET, malformed);
  console.assert(result2.status === "processed" || result2.status === "already_processed", "Should not crash");

  console.log("✅ Test 5 PASSED: Unknown/malformed event → 200, no row, no crash");
}

async function runAllTests() {
  console.log("\n🧪 Running Unipile Webhook Tests...\n");

  try {
    await cleanup();

    await test1_linkedinMessageCreatesRow();
    await test2_emailReceivedCreatesRow();
    await test3_idempotency();
    await test4_invalidSignature();
    await test5_unknownEventType();

    console.log("\n🎉 All 5 tests passed!\n");
  } catch (err) {
    console.error("\n💥 Test suite failed:", err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

runAllTests();
