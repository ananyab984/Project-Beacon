import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, getConstructorArgs } = vi.hoisted(() => {
  const create = vi.fn();
  let ctorArgs: any = null;
  return { mockCreate: create, getConstructorArgs: () => ctorArgs, _setCtorArgs: (a: any) => (ctorArgs = a) };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function (this: any, args: any) {
    this.messages = { create: mockCreate };
    Object.assign(globalThis as any, { __lastAnthropicCtorArgs: args });
  }),
}));

import { ClaudeClient, ClaudeError } from "@server/drafting/claudeClient";

const cfg: any = {
  apiKey: "test-key",
  genModel: "claude-sonnet-5",
  requestTimeoutMs: 60_000,
  maxRetries: 4,
  retryBackoffBase: 2.0,
};

function completion(text: string, overrides: any = {}) {
  return {
    content: [{ type: "text", text }],
    model: "claude-sonnet-5",
    usage: { input_tokens: 10, output_tokens: 20 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClaudeClient construction", () => {
  it("constructs the SDK client with maxRetries: 0 -- retryWithBackoff is the only retry authority", () => {
    new ClaudeClient(cfg);
    expect((globalThis as any).__lastAnthropicCtorArgs).toMatchObject({ apiKey: "test-key", maxRetries: 0, timeout: 60_000 });
  });
});

describe("ClaudeClient.chat", () => {
  it("returns text, model, tokens, and latency from a successful call", async () => {
    mockCreate.mockResolvedValue(completion("Hello world"));
    const client = new ClaudeClient(cfg);
    const result = await client.chat("system", "user");
    expect(result.text).toBe("Hello world");
    expect(result.model).toBe("claude-sonnet-5");
    expect(result.prompt_tokens).toBe(10);
    expect(result.completion_tokens).toBe(20);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("joins multiple text content blocks and ignores non-text blocks", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello " }, { type: "tool_use", text: "ignored" }, { type: "text", text: "world" }],
      model: "claude-sonnet-5",
      usage: {},
    });
    const client = new ClaudeClient(cfg);
    const result = await client.chat("system", "user");
    expect(result.text).toBe("Hello world");
  });

  it("returns null prompt/completion tokens when usage is absent", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "hi" }], model: "claude-sonnet-5" });
    const client = new ClaudeClient(cfg);
    const result = await client.chat("system", "user");
    expect(result.prompt_tokens).toBeNull();
    expect(result.completion_tokens).toBeNull();
  });

  describe("jsonMode", () => {
    it("returns the parsed-and-reserialized JSON text when the model returns clean JSON", async () => {
      mockCreate.mockResolvedValue(completion('{"subject":"Hi","body":"Hello"}'));
      const client = new ClaudeClient(cfg);
      const result = await client.chat("system", "user", { jsonMode: true });
      expect(JSON.parse(result.text)).toEqual({ subject: "Hi", body: "Hello" });
    });

    it("salvages JSON embedded in markdown fences/preamble", async () => {
      mockCreate.mockResolvedValue(completion('Sure, here it is:\n```json\n{"body":"Hello"}\n```'));
      const client = new ClaudeClient(cfg);
      const result = await client.chat("system", "user", { jsonMode: true });
      expect(JSON.parse(result.text)).toEqual({ body: "Hello" });
    });

    it("throws (triggering the full retry cycle) when jsonMode is set but no JSON object is found at all", async () => {
      mockCreate.mockResolvedValue(completion("Completely unparseable, no braces"));
      const client = new ClaudeClient(cfg);

      vi.useFakeTimers();
      const promise = client.chat("system", "user", { jsonMode: true }).catch((e) => e);
      for (const wait of [1000, 2000, 4000, 8000]) {
        await vi.advanceTimersByTimeAsync(wait);
      }
      const err = await promise;
      vi.useRealTimers();

      expect(err).toBeInstanceOf(ClaudeError);
      expect(mockCreate).toHaveBeenCalledTimes(5); // every attempt re-parses and re-fails the same way
    });

    it("appends the strict-JSON suffix to the system prompt only when jsonMode is true", async () => {
      mockCreate.mockResolvedValue(completion('{"a":1}'));
      const client = new ClaudeClient(cfg);
      await client.chat("SYSTEM_PROMPT", "user", { jsonMode: true });
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain("SYSTEM_PROMPT");
      expect(callArgs.system).toContain("Respond with ONLY the JSON object");
    });
  });

  describe("temperature guard", () => {
    it("omits temperature for a claude-sonnet-5-family model (rejects the param with HTTP 400)", async () => {
      mockCreate.mockResolvedValue(completion("hi"));
      const client = new ClaudeClient({ ...cfg, genModel: "claude-sonnet-5" });
      await client.chat("system", "user", { temperature: 0.7 });
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("temperature");
    });

    it("includes temperature for an older model that accepts it", async () => {
      mockCreate.mockResolvedValue(completion("hi"));
      const client = new ClaudeClient({ ...cfg, genModel: "claude-haiku-4-5" });
      await client.chat("system", "user", { temperature: 0.7 });
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
    });
  });

  it("retries on failure and succeeds if a later attempt works", async () => {
    mockCreate.mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce(completion("recovered"));
    const client = new ClaudeClient(cfg);

    vi.useFakeTimers();
    const promise = client.chat("system", "user");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.text).toBe("recovered");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws ClaudeError after every retry is exhausted", async () => {
    mockCreate.mockRejectedValue({ status: 500 });
    const client = new ClaudeClient(cfg);

    vi.useFakeTimers();
    const promise = client.chat("system", "user").catch((e) => e);
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    const err = await promise;
    vi.useRealTimers();

    expect(err).toBeInstanceOf(ClaudeError);
    expect(mockCreate).toHaveBeenCalledTimes(5);
  });

  it("does not retry a non-retryable (401) error", async () => {
    mockCreate.mockRejectedValue({ status: 401 });
    const client = new ClaudeClient(cfg);
    await expect(client.chat("system", "user")).rejects.toBeInstanceOf(ClaudeError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
