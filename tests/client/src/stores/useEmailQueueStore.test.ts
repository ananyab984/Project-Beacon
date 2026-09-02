import { describe, it, expect } from "vitest";
import { useEmailQueueStore } from "@/stores/useEmailQueueStore";

describe("useEmailQueueStore", () => {
  it("has null/false defaults", () => {
    const s = useEmailQueueStore.getState();
    expect(s.selectedQueueItemId).toBeNull();
    expect(s.selectedConversationId).toBeNull();
    expect(s.isGeneratingDraft).toBe(false);
  });

  it("updates selectedQueueItemId", () => {
    useEmailQueueStore.getState().setSelectedQueueItemId("q1");
    expect(useEmailQueueStore.getState().selectedQueueItemId).toBe("q1");
  });

  it("updates selectedConversationId", () => {
    useEmailQueueStore.getState().setSelectedConversationId("c1");
    expect(useEmailQueueStore.getState().selectedConversationId).toBe("c1");
  });

  it("updates isGeneratingDraft", () => {
    useEmailQueueStore.getState().setIsGeneratingDraft(true);
    expect(useEmailQueueStore.getState().isGeneratingDraft).toBe(true);
  });
});
