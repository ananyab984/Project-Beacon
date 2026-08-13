import { create } from "zustand";

/**
 * Local UI-only state for the Email Queue / Conversations pages.
 * The actual data (email queue items, conversations) now lives in React
 * Query (`['email-queue']` / `['conversations']`), fetched and mutated
 * directly in the page-view components via `api.*`. This store only holds
 * transient selection/UI state that doesn't belong in server-cache state.
 */
interface EmailQueueState {
  selectedQueueItemId: string | null;
  selectedConversationId: string | null;
  isGeneratingDraft: boolean;

  setSelectedQueueItemId: (id: string | null) => void;
  setSelectedConversationId: (id: string | null) => void;
  setIsGeneratingDraft: (isGenerating: boolean) => void;
}

export const useEmailQueueStore = create<EmailQueueState>((set) => ({
  selectedQueueItemId: null,
  selectedConversationId: null,
  isGeneratingDraft: false,

  setSelectedQueueItemId: (selectedQueueItemId) => set({ selectedQueueItemId }),
  setSelectedConversationId: (selectedConversationId) => set({ selectedConversationId }),
  setIsGeneratingDraft: (isGeneratingDraft) => set({ isGeneratingDraft }),
}));
