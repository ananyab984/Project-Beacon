import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server/drafting/config", () => ({ loadDraftingConfig: vi.fn().mockReturnValue({ apiKey: "" }) }));
vi.mock("@server/drafting/orchestrator", () => ({ DraftingOrchestrator: vi.fn(class {}) }));

import { loadDraftingConfig } from "@server/drafting/config";
import { DraftingOrchestrator } from "@server/drafting/orchestrator";
import { getDraftingOrchestrator } from "@server/drafting/instance";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDraftingOrchestrator", () => {
  it("constructs the orchestrator using loadDraftingConfig() exactly once, and returns the same instance on every later call (singleton)", () => {
    const first = getDraftingOrchestrator();
    const second = getDraftingOrchestrator();
    const third = getDraftingOrchestrator();

    expect(second).toBe(first);
    expect(third).toBe(first);
    // The module-level singleton in instance.ts persists for the process's
    // lifetime -- the constructor and loadDraftingConfig() only ever run on
    // the very first call, never again on subsequent ones.
    expect(DraftingOrchestrator).toHaveBeenCalledTimes(1);
    expect(loadDraftingConfig).toHaveBeenCalledTimes(1);
  });
});
