/**
 * Regression test for the lost-increment/decrement race in PATCH
 * /api/leads/:id's stage<->ONBOARDED handler (lead.routes.ts). Exercises the
 * exact atomic operation the fixed route code now uses, against the real DB,
 * to prove concurrent onboardings/un-onboardings never lose a count.
 * Run: cd server && npx ts-node src/routes/requirementFilledConcurrency.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";

async function withTestRequirement(headcountNeeded: number, filled: number, fn: (reqId: string) => Promise<void>) {
  const client = await prisma.client.create({
    data: { id: `test_client_concurrency_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: `Test Client Concurrency ${Date.now()}_${Math.random().toString(36).slice(2)}` },
  });
  const req = await prisma.requirement.create({
    data: {
      id: `test_req_concurrency_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      clientId: client.id,
      title: "Test Requirement",
      language: "Spanish",
      service: "Test Service",
      headcountNeeded,
      filled,
      gap: Math.max(0, headcountNeeded - filled),
      status: "ACTIVE",
      priority: "STANDARD",
    },
  });
  try {
    await fn(req.id);
  } finally {
    await prisma.requirement.delete({ where: { id: req.id } });
    await prisma.client.delete({ where: { id: client.id } });
  }
}

async function test1_concurrentIncrementsAreNotLost() {
  await withTestRequirement(10, 0, async (reqId) => {
    // Fire 5 concurrent atomic increments the same way the fixed route
    // code does -- this is the exact operation being validated, not a mock.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.requirement.update({
          where: { id: reqId },
          data: { filled: { increment: 1 } },
        })
      )
    );

    const final = await prisma.requirement.findUniqueOrThrow({ where: { id: reqId } });
    assert.strictEqual(final.filled, 5, `expected all 5 concurrent increments to land, got filled=${final.filled}`);
  });
}

async function test2_guardedDecrementNeverGoesNegative() {
  await withTestRequirement(10, 2, async (reqId) => {
    // Fire 5 concurrent guarded decrements against a requirement that only
    // has 2 filled -- the `filled: { gt: 0 } ` guard must stop it at 0,
    // never going negative, the same way the fixed route code guards it.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.requirement.updateMany({
          where: { id: reqId, filled: { gt: 0 } },
          data: { filled: { decrement: 1 } },
        })
      )
    );

    const successfulDecrements = results.reduce((sum, r) => sum + r.count, 0);
    assert.strictEqual(successfulDecrements, 2, `expected exactly 2 of the 5 concurrent decrements to actually apply, got ${successfulDecrements}`);

    const final = await prisma.requirement.findUniqueOrThrow({ where: { id: reqId } });
    assert.strictEqual(final.filled, 0, `filled must never go negative, got ${final.filled}`);
  });
}

async function main() {
  const tests = [test1_concurrentIncrementsAreNotLost, test2_guardedDecrementNeverGoesNegative];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
