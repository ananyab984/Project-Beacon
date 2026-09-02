import { describe, it, expect, vi } from "vitest";
import { generateEmail, generateLinkedin } from "./draftGenerator";
import { fromRecord } from "./leads";
import { buildShortApplyUrl } from "../lib/onboarding/shortLink";
import { BRAND } from "./promptBuilder";
import type { DraftingConfig } from "./config";
import type { ClaudeClient } from "./claudeClient";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

function fakeConfig(): DraftingConfig {
  return { apiKey: "test", genModel: "claude-sonnet-5", genTemperature: 0.5, requestTimeoutMs: 1000, maxRetries: 0, retryBackoffBase: 2 };
}

function fakeLead(overrides: Record<string, any> = {}) {
  return fromRecord({
    First_Name: "Ana",
    Full_Name: "Ana Silva",
    Email_Address: "ana@example.com",
    Services: "Subtitling",
    ...overrides,
  });
}

function fakeClaudeClient(responseText: string): ClaudeClient {
  return {
    chat: vi.fn().mockResolvedValue({
      text: responseText,
      model: "claude-sonnet-5",
      prompt_tokens: 10,
      completion_tokens: 10,
      latency_ms: 5,
    }),
  } as unknown as ClaudeClient;
}

describe("generateEmail / generateLinkedin -- personalized apply link substitution", () => {
  it("swaps a literal mention of the canonical BRAND.apply_url for this lead's personalized short link", async () => {
    const client = fakeClaudeClient(
      JSON.stringify({
        subject: "Hello",
        body: `Hi Ana,\n\nApply here: ${BRAND.apply_url}\n\nBest,\nResources Team`,
      })
    );

    const draft = await generateEmail(client, fakeConfig(), fakeLead(), LEAD_ID);

    expect(draft.body).not.toContain(BRAND.apply_url);
    expect(draft.body).toContain(buildShortApplyUrl(LEAD_ID));
  });

  it("appends the personalized short link when the model omitted an apply link entirely", async () => {
    const client = fakeClaudeClient(JSON.stringify({ subject: "Hello", body: "Hi Ana,\n\nBest,\nResources Team" }));

    const draft = await generateEmail(client, fakeConfig(), fakeLead(), LEAD_ID);

    expect(draft.body).toContain(buildShortApplyUrl(LEAD_ID));
  });

  it("never lets two different leads' drafts end up with the same personalized link", async () => {
    const otherLeadId = "22222222-2222-2222-2222-222222222222";
    const client = fakeClaudeClient(JSON.stringify({ subject: "Hello", body: "Hi Ana,\n\nBest,\nResources Team" }));

    const draftA = await generateEmail(client, fakeConfig(), fakeLead(), LEAD_ID);
    const draftB = await generateEmail(client, fakeConfig(), fakeLead(), otherLeadId);

    expect(draftA.body).toContain(buildShortApplyUrl(LEAD_ID));
    expect(draftB.body).toContain(buildShortApplyUrl(otherLeadId));
    expect(draftA.body).not.toContain(buildShortApplyUrl(otherLeadId));
  });

  it("does the same substitution for LinkedIn drafts", async () => {
    const client = fakeClaudeClient(JSON.stringify({ body: `Hi Ana, apply here: ${BRAND.apply_url}` }));

    const draft = await generateLinkedin(client, fakeConfig(), fakeLead(), LEAD_ID);

    expect(draft.body).not.toContain(BRAND.apply_url);
    expect(draft.body).toContain(buildShortApplyUrl(LEAD_ID));
  });
});
