/**
 * Run: cd server && npx ts-node src/services/webhookAuth.test.ts
 */
import assert from "node:assert";
import { safeCompare } from "./unipile.service";

function test1_equalStringsMatch() {
  assert.strictEqual(safeCompare("abc123", "abc123"), true);
}

function test2_differentSameLengthStringsDoNotMatch() {
  assert.strictEqual(safeCompare("abc123", "abc124"), false);
}

function test3_differentLengthStringsDoNotMatch() {
  assert.strictEqual(safeCompare("short", "much-longer-value"), false);
}

function test4_handlesEmptyAndNullish() {
  assert.strictEqual(safeCompare("", ""), true);
  assert.strictEqual(safeCompare("", "x"), false);
}

function main() {
  const tests = [test1_equalStringsMatch, test2_differentSameLengthStringsDoNotMatch, test3_differentLengthStringsDoNotMatch, test4_handlesEmptyAndNullish];
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
