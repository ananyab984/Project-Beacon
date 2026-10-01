/**
 * Smoke test for the ReplyCategory / ReplyClassificationEvent schema and the
 * Lead.replyCategoryId / SetNull-on-delete behavior.
 *
 * Run: cd server && npx ts-node src/lib/__tests__/replyCategorySchema.test.ts
 */

import assert from "node:assert";
import { prisma } from "../../prisma";

const TEST_CATEGORY_NAME = "test_Rate Query";

async function cleanup() {
  const lead = await prisma.lead.findFirst({ where: { fullName: "Test Classification Lead" } });
  if (lead) {
    await prisma.replyClassificationEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.replyCategory.deleteMany({ where: { name: TEST_CATEGORY_NAME } });
}

async function test1_seededCategoriesExist() {
  const count = await prisma.replyCategory.count({ where: { isActive: true } });
  assert.ok(count >= 33, `expected at least 33 active reply categories, got ${count}`);
}

async function test2_deletingCategorySetsLeadFieldNull() {
  const category = await prisma.replyCategory.create({
    data: { groupName: "Payment & Invoicing", name: TEST_CATEGORY_NAME, description: "test row" },
  });

  const lead = await prisma.lead.create({
    data: {
      fullName: "Test Classification Lead",
      source: "LINKEDIN",
      replyCategoryId: category.id,
      replyClassificationSource: "AUTO",
      replyClassifiedAt: new Date(),
    },
  });

  await prisma.replyCategory.delete({ where: { id: category.id } });

  const reloaded = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(reloaded?.replyCategoryId, null, "Lead.replyCategoryId must be nulled when its category is deleted");
}

async function test3_classificationEventStoresConfidenceAsPlainNumber() {
  const lead = await prisma.lead.create({
    data: { fullName: "Test Classification Lead", source: "LINKEDIN" },
  });

  const event = await prisma.replyClassificationEvent.create({
    data: { leadId: lead.id, categoryId: null, confidence: 0.42, source: "AUTO" },
  });

  assert.strictEqual(Number(event.confidence), 0.42);
  assert.strictEqual(event.source, "AUTO");

  await prisma.replyClassificationEvent.delete({ where: { id: event.id } });
  await prisma.lead.delete({ where: { id: lead.id } });
}

async function main() {
  const tests = [test1_seededCategoriesExist, test2_deletingCategorySetsLeadFieldNull, test3_classificationEventStoresConfidenceAsPlainNumber];
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
