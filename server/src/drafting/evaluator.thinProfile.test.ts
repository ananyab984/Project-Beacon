/**
 * Unit tests for isThinProfileDraft -- the signal generate-draft (both
 * email-queue.routes.ts and conversation.routes.ts) uses to tell the
 * recruiter "this draft is real, but the lead's profile was thin" instead
 * of either silently shipping a generic draft or refusing to draft at all.
 *
 * Run: cd server && npx ts-node src/drafting/evaluator.thinProfile.test.ts
 */
import assert from "node:assert";
import { isThinProfileDraft } from "./evaluator";

function test1_lowPersonalizationDepthFlagsAsThin() {
  assert.strictEqual(isThinProfileDraft(["LOW_PERSONALIZATION_DEPTH"]), true);
}

function test2_lowNamedSpecificityFlagsAsThin() {
  assert.strictEqual(isThinProfileDraft(["LOW_NAMED_SPECIFICITY"]), true);
}

function test3_bothFlagsTogetherStillJustOneWarning() {
  assert.strictEqual(isThinProfileDraft(["LOW_PERSONALIZATION_DEPTH", "LOW_NAMED_SPECIFICITY"]), true);
}

function test4_unrelatedFlagsDoNotTriggerWarning() {
  // A draft can fail other gates (length, placeholders, rate grounding)
  // without the profile itself being thin -- those aren't "add more data"
  // problems, so they must not trigger this warning.
  assert.strictEqual(isThinProfileDraft(["LENGTH_OUT_OF_BOUNDS", "UNFILLED_PLACEHOLDERS_FOUND"]), false);
}

function test5_noFlagsIsNotThin() {
  assert.strictEqual(isThinProfileDraft([]), false);
}

async function main() {
  const tests = [
    test1_lowPersonalizationDepthFlagsAsThin,
    test2_lowNamedSpecificityFlagsAsThin,
    test3_bothFlagsTogetherStillJustOneWarning,
    test4_unrelatedFlagsDoNotTriggerWarning,
    test5_noFlagsIsNotThin,
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
