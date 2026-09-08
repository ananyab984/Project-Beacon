/**
 * Smoke test for GroqClient -- makes one real call against the configured
 * GROQ_API_KEY to confirm the client is wired correctly end-to-end.
 *
 * Run: cd server && npx ts-node src/drafting/groqClient.test.ts
 */

import assert from "node:assert";
import { GroqClient } from "./groqClient";
import { loadDraftingConfig } from "./config";

async function test1_plainTextCompletion() {
  const client = new GroqClient(loadDraftingConfig());
  const result = await client.chat(
    "You are a terse assistant. Reply with exactly one word.",
    "What is the capital of France?"
  );
  assert.ok(result.text.length > 0, "expected non-empty completion text");
  assert.ok(result.text.toLowerCase().includes("paris"), `expected "paris" in response, got: ${result.text}`);
  assert.ok(result.latency_ms >= 0);
}

async function test2_jsonMode() {
  const client = new GroqClient(loadDraftingConfig());
  const result = await client.chat(
    'You classify sentiment. Respond with a JSON object: {"sentiment": "positive" | "negative" | "neutral"}.',
    "I love this product!",
    { jsonMode: true }
  );
  const parsed = JSON.parse(result.text);
  assert.ok(["positive", "negative", "neutral"].includes(parsed.sentiment), `unexpected sentiment: ${parsed.sentiment}`);
}

async function main() {
  const tests = [test1_plainTextCompletion, test2_jsonMode];
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
