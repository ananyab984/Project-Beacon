/**
 * Tests that the apply link reaching a candidate is THAT lead's personalized
 * short link, on both channels.
 *
 * The prompt still describes the canonical BRAND.apply_url to the model, so
 * the model writes that URL (or none at all). ensureLinks() is the single
 * point where it becomes a per-lead link -- if that substitution regresses,
 * every candidate gets an unpersonalized form with nothing pre-filled, and
 * nothing else in the pipeline would notice.
 *
 * Uses a hand-rolled fake Claude client (no network, no API key, no test
 * framework) so this runs anywhere.
 *
 * Run: cd server && npx ts-node src/drafting/applyLinkSubstitution.test.ts
 */

import assert from "node:assert";
import { generateEmail, generateLinkedin } from "./draftGenerator";
import { fromRecord } from "./leads";
import { buildShortApplyUrl } from "../lib/onboarding/shortLink";
import { BRAND } from "./promptBuilder";
import { LINKEDIN_NOTE_MAX_CHARS } from "../lib/linkedinNoteCap";
import type { DraftingConfig } from "./config";
import type { ClaudeClient } from "./claudeClient";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const SHORT = buildShortApplyUrl(LEAD_ID);

function fakeConfig(): DraftingConfig {
  return {
    apiKey: "test",
    genModel: "claude-sonnet-5",
    genTemperature: 0.5,
    requestTimeoutMs: 1000,
    maxRetries: 0,
    retryBackoffBase: 2,
    groqApiKey: "",
    groqModel: "",
  };
}

function fakeLead() {
  return fromRecord({
    First_Name: "Ana",
    Full_Name: "Ana Silva",
    Email_Address: "ana@example.com",
    Services: "Subtitling",
  });
}

/** Always answers with the same canned draft, however many times the
 *  generator retries -- these tests are about the final body, not retries. */
function fakeClient(body: string, subject = "Hello"): ClaudeClient {
  return {
    chat: async () => ({
      text: JSON.stringify({ subject, body }),
      model: "claude-sonnet-5",
      prompt_tokens: 10,
      completion_tokens: 10,
      latency_ms: 5,
    }),
  } as unknown as ClaudeClient;
}

async function test1_emailSwapsCanonicalUrlForThisLeadsShortLink() {
  const client = fakeClient(`Hi Ana,\n\nApply here: ${BRAND.apply_url}\n\nBest,\nResources Team`);
  const draft = await generateEmail(client, fakeConfig(), fakeLead(), LEAD_ID);

  assert.ok(draft.body.includes(SHORT), "body should carry this lead's short link");
  assert.ok(!draft.body.includes(BRAND.apply_url), "the unpersonalized canonical URL must not survive");
}

async function test2_emailAppendsTheLinkWhenTheModelOmitsItEntirely() {
  const client = fakeClient("Hi Ana,\n\nWe'd love to work with you.\n\nBest,\nResources Team");
  const draft = await generateEmail(client, fakeConfig(), fakeLead(), LEAD_ID);

  assert.ok(draft.body.includes(SHORT), "a draft with no link at all should still get one appended");
}

async function test3_linkedinSwapsTheUrlAndStaysUnderTheCap() {
  const client = fakeClient(`Hi Ana, your subtitling work stood out. Apply: ${BRAND.apply_url}`);
  const draft = await generateLinkedin(client, fakeConfig(), fakeLead(), LEAD_ID);

  assert.ok(draft.body.includes(SHORT), "LinkedIn note should carry the short link too");
  assert.ok(!draft.body.includes(BRAND.apply_url), "canonical URL must not survive on LinkedIn either");
  assert.ok(
    draft.body.length <= LINKEDIN_NOTE_MAX_CHARS,
    `note must fit ${LINKEDIN_NOTE_MAX_CHARS} chars once the link is in, got ${draft.body.length}`
  );
}

async function test4_twoLeadsGetDifferentLinks() {
  // The substitution has to be per-lead, not a single shared constant --
  // this is what makes the pre-fill actually personal.
  const other = "22222222-2222-2222-2222-222222222222";
  const client = fakeClient(`Hi Ana,\n\nApply here: ${BRAND.apply_url}\n\nBest`);

  const a = await generateEmail(client, fakeConfig(), fakeLead(), LEAD_ID);
  const b = await generateEmail(client, fakeConfig(), fakeLead(), other);

  assert.ok(a.body.includes(buildShortApplyUrl(LEAD_ID)));
  assert.ok(b.body.includes(buildShortApplyUrl(other)));
  assert.notStrictEqual(buildShortApplyUrl(LEAD_ID), buildShortApplyUrl(other), "links must differ per lead");
}

async function main() {
  const tests = [
    test1_emailSwapsCanonicalUrlForThisLeadsShortLink,
    test2_emailAppendsTheLinkWhenTheModelOmitsItEntirely,
    test3_linkedinSwapsTheUrlAndStaysUnderTheCap,
    test4_twoLeadsGetDifferentLinks,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err: any) {
      failed += 1;
      console.error(`FAIL ${t.name}\n${err?.message || err}`);
    }
  }
  console.log(failed ? `${failed}/${tests.length} test(s) failed` : `All ${tests.length} tests passed`);
  if (failed) process.exit(1);
}

main();
