/**
 * GroqClient tests. The offline tests swap the SDK for a fake, so they make
 * no network calls and cost nothing -- they cover the request defaults, the
 * jsonMode flag, response mapping and error wrapping.
 *
 * The two live smoke tests make real, billable Groq calls and only run when
 * RUN_LIVE_API_TESTS=1 (they also need GROQ_API_KEY).
 *
 * Run: cd server && npx ts-node src/drafting/groqClient.test.ts
 * Live: cd server && RUN_LIVE_API_TESTS=1 npx ts-node src/drafting/groqClient.test.ts
 */

import assert from "node:assert";
import { GroqClient, GroqError } from "./groqClient";
import { loadDraftingConfig } from "./config";

/** A GroqClient whose SDK is replaced by `create`; records each request body. */
function fakeClient(create: (body: any) => Promise<any>) {
  const calls: any[] = [];
  const client = new GroqClient(loadDraftingConfig());
  (client as any).client = {
    chat: { completions: { create: async (body: any) => { calls.push(body); return create(body); } } },
  };
  return { client, calls };
}

const OK_RESPONSE = {
  model: "fake-model",
  choices: [{ message: { content: "Paris" } }],
  usage: { prompt_tokens: 12, completion_tokens: 1 },
};

async function test1_defaultsAndResponseMapping() {
  const { client, calls } = fakeClient(async () => OK_RESPONSE);
  const result = await client.chat("system text", "user text");

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].model, loadDraftingConfig().groqModel, "model defaults to the configured one");
  assert.strictEqual(calls[0].temperature, 0.3);
  assert.strictEqual(calls[0].max_tokens, 256);
  assert.strictEqual(calls[0].response_format, undefined, "no response_format unless jsonMode");
  assert.deepStrictEqual(calls[0].messages, [
    { role: "system", content: "system text" },
    { role: "user", content: "user text" },
  ]);

  assert.strictEqual(result.text, "Paris");
  assert.strictEqual(result.model, "fake-model");
  assert.strictEqual(result.prompt_tokens, 12);
  assert.strictEqual(result.completion_tokens, 1);
  assert.ok(result.latency_ms >= 0);
}

async function test2_jsonModeAndOverrides() {
  const { client, calls } = fakeClient(async () => OK_RESPONSE);
  await client.chat("s", "u", { jsonMode: true, temperature: 0, maxTokens: 50, model: "other-model" });

  assert.deepStrictEqual(calls[0].response_format, { type: "json_object" });
  assert.strictEqual(calls[0].temperature, 0, "an explicit 0 must not fall back to the default");
  assert.strictEqual(calls[0].max_tokens, 50);
  assert.strictEqual(calls[0].model, "other-model");
}

async function test3_missingContentAndUsageMapToEmptyAndNull() {
  const { client } = fakeClient(async () => ({ model: "fake-model", choices: [] }));
  const result = await client.chat("s", "u");

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.prompt_tokens, null);
  assert.strictEqual(result.completion_tokens, null);
}

async function test4_sdkErrorIsWrappedAsGroqError() {
  // 401 is non-retryable, so this is exactly one call with no backoff wait --
  // and one failure stays well under the shared circuit breaker's threshold.
  const { client, calls } = fakeClient(async () => {
    throw Object.assign(new Error("Invalid API Key"), { status: 401 });
  });

  await assert.rejects(client.chat("s", "u"), (err: any) => {
    assert.ok(err instanceof GroqError);
    assert.ok(err.message.includes("Invalid API Key"), `got: ${err.message}`);
    return true;
  });
  assert.strictEqual(calls.length, 1, "a non-retryable error must not be retried");
}

async function live1_plainTextCompletion() {
  const client = new GroqClient(loadDraftingConfig());
  const result = await client.chat(
    "You are a terse assistant. Reply with exactly one word.",
    "What is the capital of France?"
  );
  assert.ok(result.text.length > 0, "expected non-empty completion text");
  assert.ok(result.text.toLowerCase().includes("paris"), `expected "paris" in response, got: ${result.text}`);
  assert.ok(result.latency_ms >= 0);
}

async function live2_jsonMode() {
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
  const live = process.env.RUN_LIVE_API_TESTS === "1";
  const tests = [
    test1_defaultsAndResponseMapping,
    test2_jsonModeAndOverrides,
    test3_missingContentAndUsageMapToEmptyAndNull,
    test4_sdkErrorIsWrappedAsGroqError,
    ...(live ? [live1_plainTextCompletion, live2_jsonMode] : []),
  ];
  if (!live) console.log("SKIP live1_plainTextCompletion, live2_jsonMode (set RUN_LIVE_API_TESTS=1 to run)");

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
