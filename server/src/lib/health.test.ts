/**
 * /health database check tests (audit AUDIT-31). test1 and test4 use the
 * real dev database (read-only SELECT 1); the rest use fake probes.
 *
 * Run: cd server && npx ts-node src/lib/health.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";
import { isDatabaseReachable, healthHandler } from "./health";

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
}

async function test1_realDatabaseIsReachable() {
  // Connectivity, not latency: a generous limit so a cold connection from a
  // distant dev machine doesn't make this flaky. The handler tests below run
  // on the now-warm connection with the real 4s production limit.
  assert.strictEqual(await isDatabaseReachable(10_000), true);
}

async function test2_hangingDatabaseCountsAsDownWithinTheTimeout() {
  const started = Date.now();
  const ok = await isDatabaseReachable(200, () => new Promise(() => {}));
  const elapsed = Date.now() - started;
  assert.strictEqual(ok, false);
  assert.ok(elapsed < 1000, `must give up near the 200ms timeout, took ${elapsed}ms`);
}

async function test3_failingDatabaseCountsAsDown() {
  assert.strictEqual(await isDatabaseReachable(200, async () => { throw new Error("connection refused"); }), false);
}

async function test4_handlerAnswers200WhenTheDatabaseIsUp() {
  const res = fakeRes();
  await healthHandler({} as any, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { status: "healthy", db: "up" });
}

async function test5_handlerAnswers503WhenTheDatabaseIsDown() {
  // Point the default probe at a query that fails, the same way an
  // unreachable database fails -- the handler takes no probe argument.
  const realQueryRaw = prisma.$queryRaw;
  (prisma as any).$queryRaw = async () => { throw new Error("Can't reach database server"); };
  try {
    const res = fakeRes();
    await healthHandler({} as any, res);
    assert.strictEqual(res.statusCode, 503);
    assert.deepStrictEqual(res.body, { status: "unhealthy", db: "down" }, "the public body must not carry the error text");
  } finally {
    (prisma as any).$queryRaw = realQueryRaw;
  }
}

async function main() {
  const tests = [
    test1_realDatabaseIsReachable,
    test2_hangingDatabaseCountsAsDownWithinTheTimeout,
    test3_failingDatabaseCountsAsDown,
    test4_handlerAnswers200WhenTheDatabaseIsUp,
    test5_handlerAnswers503WhenTheDatabaseIsDown,
  ];
  let failed = 0;
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
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
