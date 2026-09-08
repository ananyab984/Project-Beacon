/**
 * Unit tests for the reply classifier's decision logic, against a fake
 * GroqClient (no real Groq calls) -- table-driven cases across the doc's 6
 * category groups, plus the confidence-threshold and hallucination guards.
 *
 * Run: cd server && npx ts-node src/lib/replyClassifier.test.ts
 */

import assert from "node:assert";
import { classifyReply } from "./replyClassifier";

const CATEGORIES = [
  { id: "cat_rate_query", name: "Rate Query", description: "RTM rate, hourly rate, per-word rate, premium rate request" },
  { id: "cat_login_issue", name: "Login Issue", description: "Password reset, 2FA setup, authenticator app, backup code" },
  { id: "cat_ai_voice", name: "AI Usage / Voice Cloning Concern", description: "Candidate concerned about AI training or voice data usage" },
];

function fakeClient(responseText: string) {
  return {
    chat: async () => ({ text: responseText, model: "fake", prompt_tokens: null, completion_tokens: null, latency_ms: 0 }),
  };
}

async function test1_confidentMatchReturnsResult() {
  const client = fakeClient(JSON.stringify({ categoryId: "cat_rate_query", confidence: 0.9 }));
  const result = await classifyReply(client as any, "What's your hourly rate for RTM work?", CATEGORIES);
  assert.deepStrictEqual(result, { categoryId: "cat_rate_query", confidence: 0.9 });
}

async function test2_belowThresholdReturnsNull() {
  const client = fakeClient(JSON.stringify({ categoryId: "cat_login_issue", confidence: 0.4 }));
  const result = await classifyReply(client as any, "hmm not sure what this is about", CATEGORIES);
  assert.strictEqual(result, null);
}

async function test3_explicitNullCategoryReturnsNull() {
  const client = fakeClient(JSON.stringify({ categoryId: null, confidence: 0 }));
  const result = await classifyReply(client as any, "Just saying hi!", CATEGORIES);
  assert.strictEqual(result, null);
}

async function test4_hallucinatedCategoryIdIsRejected() {
  const client = fakeClient(JSON.stringify({ categoryId: "cat_does_not_exist", confidence: 0.95 }));
  const result = await classifyReply(client as any, "Some message", CATEGORIES);
  assert.strictEqual(result, null, "a categoryId not in the provided list must never be trusted");
}

async function test5_emptyCategoryListReturnsNullWithoutCallingClient() {
  let called = false;
  const client = { chat: async () => { called = true; return { text: "{}", model: "fake", prompt_tokens: null, completion_tokens: null, latency_ms: 0 }; } };
  const result = await classifyReply(client as any, "Some message", []);
  assert.strictEqual(result, null);
  assert.strictEqual(called, false, "must not call the client when there are no categories to match against");
}

async function main() {
  const tests = [
    test1_confidentMatchReturnsResult,
    test2_belowThresholdReturnsNull,
    test3_explicitNullCategoryReturnsNull,
    test4_hallucinatedCategoryIdIsRejected,
    test5_emptyCategoryListReturnsNullWithoutCallingClient,
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
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
