/**
 * Unit tests for the recycle-bin countdown copy shown per row in
 * recycle-bin-dialog.tsx.
 *
 * Run: cd client && npx tsx src/lib/recycleBin.test.ts
 */
import assert from "node:assert";
import { formatDaysUntilPurge } from "./recycleBin";

function test1_zeroDaysReadsAsDeletesToday() {
  assert.strictEqual(formatDaysUntilPurge(0), "Deletes today");
}

function test2_negativeDaysAlsoReadsAsDeletesToday() {
  // Shouldn't happen (server clamps at 0) but a defensive floor here keeps
  // the copy sane rather than printing "-1 days left" if it ever did.
  assert.strictEqual(formatDaysUntilPurge(-1), "Deletes today");
}

function test3_oneDayIsSingular() {
  assert.strictEqual(formatDaysUntilPurge(1), "1 day left");
}

function test4_multipleDaysArePlural() {
  assert.strictEqual(formatDaysUntilPurge(2), "2 days left");
  assert.strictEqual(formatDaysUntilPurge(30), "30 days left");
}

function main() {
  const tests = [
    test1_zeroDaysReadsAsDeletesToday,
    test2_negativeDaysAlsoReadsAsDeletesToday,
    test3_oneDayIsSingular,
    test4_multipleDaysArePlural,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
