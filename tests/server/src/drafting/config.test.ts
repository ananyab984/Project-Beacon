import { describe, it, expect, vi } from "vitest";

const { getServerConfig, setServerConfig } = vi.hoisted(() => {
  let cfg: any = {
    claudeApiKey: "test-key",
    claudeModel: "sonnet",
    genTemperature: 0.5,
    requestTimeoutSeconds: 60,
    maxRetries: 4,
    retryBackoffBase: 2.0,
  };
  return { getServerConfig: () => cfg, setServerConfig: (c: any) => (cfg = c) };
});

vi.mock("@server/config", () => ({
  get config() {
    return getServerConfig();
  },
}));

import { loadDraftingConfig } from "@server/drafting/config";

describe("loadDraftingConfig", () => {
  it("resolves the 'sonnet' alias to the real Anthropic model ID", () => {
    setServerConfig({ ...getServerConfig(), claudeModel: "sonnet" });
    expect(loadDraftingConfig().genModel).toBe("claude-sonnet-5");
  });

  it("resolves 'opus' and 'haiku' aliases too", () => {
    setServerConfig({ ...getServerConfig(), claudeModel: "opus" });
    expect(loadDraftingConfig().genModel).toBe("claude-opus-5");
    setServerConfig({ ...getServerConfig(), claudeModel: "haiku" });
    expect(loadDraftingConfig().genModel).toBe("claude-haiku-4-5");
  });

  it("is case-insensitive when matching an alias", () => {
    setServerConfig({ ...getServerConfig(), claudeModel: "SONNET" });
    expect(loadDraftingConfig().genModel).toBe("claude-sonnet-5");
  });

  it("passes through an already-real model ID unchanged", () => {
    setServerConfig({ ...getServerConfig(), claudeModel: "claude-sonnet-5-20260101" });
    expect(loadDraftingConfig().genModel).toBe("claude-sonnet-5-20260101");
  });

  it("defaults to the haiku alias when claudeModel is empty", () => {
    setServerConfig({ ...getServerConfig(), claudeModel: "" });
    expect(loadDraftingConfig().genModel).toBe("claude-haiku-4-5");
  });

  it("converts requestTimeoutSeconds to milliseconds, not a raw copy", () => {
    setServerConfig({ ...getServerConfig(), requestTimeoutSeconds: 60 });
    expect(loadDraftingConfig().requestTimeoutMs).toBe(60_000);
  });

  it("passes through apiKey, maxRetries, retryBackoffBase, and genTemperature unchanged", () => {
    setServerConfig({
      claudeApiKey: "my-key",
      claudeModel: "sonnet",
      genTemperature: 0.7,
      requestTimeoutSeconds: 30,
      maxRetries: 5,
      retryBackoffBase: 3.0,
    });
    const cfg = loadDraftingConfig();
    expect(cfg.apiKey).toBe("my-key");
    expect(cfg.genTemperature).toBe(0.7);
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.retryBackoffBase).toBe(3.0);
  });
});
