/**
 * Unit tests for the manual reply-classification override path on
 * PATCH /api/leads/:id. Exercises the Prisma-level behavior the route
 * handler performs, matching this codebase's existing "business logic
 * over HTTP wiring" test split (see replyCategories.routes.test.ts).
 *
 * Run: cd server && npx ts-node src/routes/leadReplyOverride.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";

async function cleanup() {
  await prisma.replyClassificationEvent.deleteMany({ where: { lead: { fullName: "Test Override Lead" } } });
  await prisma.lead.deleteMany({ where: { fullName: "Test Override Lead" } });
  await prisma.replyCategory.deleteMany({ where: { name: { startsWith: "test_override_" } } });
  await prisma.user.deleteMany({ where: { email: "test_override_owner@example.com" } });
}

/** Mirrors exactly what the PATCH /:id handler does when `replyCategoryId`
 * is present in the request body (see Step 3 below) -- used here to test
 * the underlying data changes without spinning up an HTTP server. */
async function applyManualOverride(leadId: string, replyCategoryId: string | null, changedByUserId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { replyCategoryId, replyClassificationSource: "MANUAL", replyClassifiedAt: new Date() },
  });
  await prisma.replyClassificationEvent.create({
    data: { leadId, categoryId: replyCategoryId, confidence: null, source: "MANUAL", changedByUserId },
  });
}

async function test1_overrideSetsManualSourceAndLogsEvent() {
  const owner = await prisma.user.create({ data: { name: "Test Override Owner", email: "test_override_owner@example.com", role: "OWNER" } });
  const category = await prisma.replyCategory.create({ data: { groupName: "General Queries", name: "test_override_Category", description: "test" } });
  const lead = await prisma.lead.create({ data: { fullName: "Test Override Lead", source: "LINKEDIN" } });

  await applyManualOverride(lead.id, category.id, owner.id);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, category.id);
  assert.strictEqual(updated?.replyClassificationSource, "MANUAL");
  assert.ok(updated?.replyClassifiedAt);

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].source, "MANUAL");
  assert.strictEqual(events[0].changedByUserId, owner.id);
  assert.strictEqual(events[0].confidence, null, "a human override has no confidence score");
}

async function test2_overrideToNullClearsToUnclassified() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "test_override_owner@example.com" } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: "Test Override Lead" } });

  await applyManualOverride(lead.id, null, owner.id);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, null);
  assert.strictEqual(updated?.replyClassificationSource, "MANUAL", "explicitly clearing to Unclassified is still a MANUAL action");
}

async function main() {
  const tests = [test1_overrideSetsManualSourceAndLogsEvent, test2_overrideToNullClearsToUnclassified];
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
