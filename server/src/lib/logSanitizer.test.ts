/**
 * Run: cd server && npx ts-node src/lib/logSanitizer.test.ts
 */
import assert from "node:assert";
import { redactForLog } from "./logSanitizer";

function test1_masksEmailAddresses() {
  const result = redactForLog("contact me at jane.doe@example.com please");
  assert.ok(!result.includes("jane.doe@example.com"), "raw email must not appear");
  assert.ok(result.includes("j***@example.com"), `expected masked email, got: ${result}`);
}

function test2_truncatesLongText() {
  const long = "a".repeat(200);
  const result = redactForLog(long, 50);
  assert.strictEqual(result.length, 53); // 50 chars + "..."
  assert.ok(result.endsWith("..."));
}

function test3_shortTextUnaffectedByTruncation() {
  const result = redactForLog("short message", 100);
  assert.strictEqual(result, "short message");
}

function test4_handlesEmptyAndNullish() {
  assert.strictEqual(redactForLog(""), "");
  assert.strictEqual(redactForLog(null as any), "");
  assert.strictEqual(redactForLog(undefined as any), "");
}

function main() {
  const tests = [test1_masksEmailAddresses, test2_truncatesLongText, test3_shortTextUnaffectedByTruncation, test4_handlesEmptyAndNullish];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
