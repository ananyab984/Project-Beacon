import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server/drafting/claudeClient", () => ({
  // Arrow functions (even wrapped in vi.fn) can never be used as a
  // constructor -- a real class stub is required so `new ClaudeClient(cfg)`
  // in the orchestrator doesn't throw.
  ClaudeClient: class {},
}));

vi.mock("@server/drafting/draftGenerator", () => ({
  generateEmail: vi.fn(),
  generateLinkedin: vi.fn(),
}));

import { generateEmail, generateLinkedin } from "@server/drafting/draftGenerator";
import { DraftingOrchestrator } from "@server/drafting/orchestrator";
import { Lead } from "@server/drafting/leads";

const mockGenerateEmail = generateEmail as unknown as ReturnType<typeof vi.fn>;
const mockGenerateLinkedin = generateLinkedin as unknown as ReturnType<typeof vi.fn>;

const cfgWithKey: any = { apiKey: "test-key", genModel: "claude-sonnet-5", genTemperature: 0.5 };
const cfgNoKey: any = { apiKey: "", genModel: "claude-sonnet-5", genTemperature: 0.5 };

function goodDraft(overrides: any = {}) {
  return {
    channel: "email",
    lead: new Lead({ firstName: "Jane", targetLanguage: "German", country: "Germany" }),
    subject: "Hi",
    body:
      "Hi Jane,\n\nWe're reaching out from the Resource Management team at Global3 about German freelance work. " +
      "We work with talented professionals across many regions and value long-term partnerships. ".repeat(6) +
      "Please apply here: https://app.global3.io/apply. Visit: global3.io.\n\nBest regards,\nResources Team",
    model: "claude-sonnet-5",
    latency_ms: 500,
    prompt_tokens: 100,
    completion_tokens: 50,
    rate_match: null,
    rate_flag: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("DraftingOrchestrator.processDraft", () => {
  it("returns INELIGIBLE without ever calling the LLM when the eligibility gate fails", async () => {
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft({ First_Name: "Jane" }, "email"); // no email, no override

    expect(result.verdict).toBe("INELIGIBLE");
    expect(result.flags).toContain("NO_EMAIL");
    expect(mockGenerateEmail).not.toHaveBeenCalled();
  });

  it("bypasses the eligibility gate entirely with manualOverride=true", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft());
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft({ First_Name: "Jane" }, "email", true);
    expect(result.verdict).not.toBe("INELIGIBLE");
    expect(mockGenerateEmail).toHaveBeenCalled();
  });

  it("throws when no Claude client is configured (no API key) and the lead is eligible", async () => {
    const orchestrator = new DraftingOrchestrator(cfgNoKey);
    await expect(
      orchestrator.processDraft({ First_Name: "Jane", Email_Address: "jane@example.com" }, "email")
    ).rejects.toThrow("CLAUDE_API_KEY is not configured");
  });

  it("returns verdict=SEND when the generated draft passes every evaluator gate", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft());
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft(
      { First_Name: "Jane", Email_Address: "jane@example.com", Target_Language: "German", Country_of_Residence: "Germany" },
      "email"
    );
    expect(result.verdict).toBe("SEND");
    expect(result.flags).toEqual([]);
  });

  it("returns verdict=HOLD (not INELIGIBLE) when the draft fails a gate check", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft({ body: "Too short." }));
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft(
      { First_Name: "Jane", Email_Address: "jane@example.com" },
      "email"
    );
    expect(result.verdict).toBe("HOLD");
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it("routes to generateLinkedin (not generateEmail) for the linkedin channel", async () => {
    mockGenerateLinkedin.mockResolvedValue(
      goodDraft({ channel: "linkedin", subject: null, body: "Hi Jane, interested in German work? Apply: https://app.global3.io/apply" })
    );
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    await orchestrator.processDraft(
      { First_Name: "Jane", Profile_Link: "https://linkedin.com/in/jane" },
      "linkedin"
    );
    expect(mockGenerateLinkedin).toHaveBeenCalled();
    expect(mockGenerateEmail).not.toHaveBeenCalled();
  });

  it("looks up a rate card match using the lead's language pair and first service", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft());
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft(
      {
        First_Name: "Jane",
        Email_Address: "jane@example.com",
        Source_Language: "English",
        Target_Language: "German",
        Services: "Translation",
      },
      "email"
    );
    expect(result.rate_applied).not.toBeNull();
    expect(result.rate_applied?.rate).toBe(0.12);
  });

  it("carries through telemetry (model, tokens, latency) from the generated draft", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft({ model: "claude-opus-5", prompt_tokens: 200, completion_tokens: 80 }));
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft({ First_Name: "Jane", Email_Address: "jane@example.com" }, "email");
    expect(result.telemetry.model).toBe("claude-opus-5");
    expect(result.telemetry.prompt_tokens).toBe(200);
    expect(result.telemetry.completion_tokens).toBe(80);
    expect(result.telemetry.total_execution_time_ms).toBeGreaterThanOrEqual(0);
  });

  it("generates a unique draft_id per call", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft());
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const lead = { First_Name: "Jane", Email_Address: "jane@example.com" };
    const r1 = await orchestrator.processDraft(lead, "email");
    const r2 = await orchestrator.processDraft(lead, "email");
    expect(r1.draft_id).not.toBe(r2.draft_id);
  });

  it("records manual_override on the result", async () => {
    mockGenerateEmail.mockResolvedValue(goodDraft());
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = await orchestrator.processDraft({ First_Name: "Jane" }, "email", true);
    expect(result.manual_override).toBe(true);
  });
});

describe("DraftingOrchestrator.recordEdit", () => {
  it("delegates to logRecruiterEdit and returns its result", () => {
    const orchestrator = new DraftingOrchestrator(cfgWithKey);
    const result = orchestrator.recordEdit("draft-1", "original text", "edited text");
    expect(result.draft_id).toBe("draft-1");
    expect(result.was_edited).toBe(true);
  });
});
