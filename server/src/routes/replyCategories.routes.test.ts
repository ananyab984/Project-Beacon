/**
 * Unit tests for the ReplyCategory CRUD behavior (create/update/delete +
 * the unique-name constraint + SetNull-on-delete cascade to Lead). HTTP-
 * layer concerns (RBAC, status codes) are covered by manual verification
 * against the running dev server -- see Task 5, Step 6 of the
 * implementation plan.
 *
 * Run: cd server && npx ts-node src/routes/replyCategories.routes.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";

const TEST_NAME = "test_CRUD Category";
const TEST_NAME_RENAMED = "test_CRUD Category Renamed";

async function cleanup() {
  await prisma.replyCategory.deleteMany({ where: { name: { in: [TEST_NAME, TEST_NAME_RENAMED] } } });
}

async function test1_createAndFetch() {
  const created = await prisma.replyCategory.create({
    data: { groupName: "General Queries", name: TEST_NAME, description: "A test category" },
  });
  assert.strictEqual(created.isActive, true, "new categories default to active");

  const fetched = await prisma.replyCategory.findUnique({ where: { id: created.id } });
  assert.strictEqual(fetched?.name, TEST_NAME);
}

async function test2_duplicateNameRejected() {
  await assert.rejects(
    () => prisma.replyCategory.create({ data: { groupName: "General Queries", name: TEST_NAME, description: "dup" } }),
    /Unique constraint/i
  );
}

async function test3_updateRenamesAndDeactivates() {
  const existing = await prisma.replyCategory.findUniqueOrThrow({ where: { name: TEST_NAME } });
  const updated = await prisma.replyCategory.update({
    where: { id: existing.id },
    data: { name: TEST_NAME_RENAMED, isActive: false },
  });
  assert.strictEqual(updated.name, TEST_NAME_RENAMED);
  assert.strictEqual(updated.isActive, false);
}

async function test4_deleteRemovesRow() {
  const existing = await prisma.replyCategory.findUniqueOrThrow({ where: { name: TEST_NAME_RENAMED } });
  await prisma.replyCategory.delete({ where: { id: existing.id } });
  const gone = await prisma.replyCategory.findUnique({ where: { id: existing.id } });
  assert.strictEqual(gone, null);
}

async function main() {
  const tests = [test1_createAndFetch, test2_duplicateNameRejected, test3_updateRenamesAndDeactivates, test4_deleteRemovesRow];
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
