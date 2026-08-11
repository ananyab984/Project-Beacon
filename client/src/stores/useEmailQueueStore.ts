import { create } from "zustand";
import {
  type EmailQueueItem,
  type Conversation,
  initialRecruiterStore,
} from "@/lib/recruiter-mock";

interface EmailQueueState {
  emailQueue: EmailQueueItem[];
  conversations: Conversation[];
  selectedQueueItemId: string | null;
  selectedConversationId: string | null;
  isGeneratingDraft: boolean;

  setEmailQueue: (items: EmailQueueItem[]) => void;
  setConversations: (conversations: Conversation[]) => void;
  setSelectedQueueItemId: (id: string | null) => void;
  setSelectedConversationId: (id: string | null) => void;
  setIsGeneratingDraft: (isGenerating: boolean) => void;

  updateDraft: (id: string, updates: Partial<Pick<EmailQueueItem, "subject" | "body" | "preview">>) => void;
  approveAndSendDraft: (id: string) => void;
  batchApproveAndSend: (ids: string[]) => void;
  addConversationMessage: (conversationId: string, text: string) => void;
}

export const useEmailQueueStore = create<EmailQueueState>((set) => ({
  emailQueue: [],
  conversations: [],
  selectedQueueItemId: null,
  selectedConversationId: null,
  isGeneratingDraft: false,

  setEmailQueue: (emailQueue) => set({ emailQueue }),
  setConversations: (conversations) => set({ conversations }),
  setSelectedQueueItemId: (selectedQueueItemId) => set({ selectedQueueItemId }),
  setSelectedConversationId: (selectedConversationId) => set({ selectedConversationId }),
  setIsGeneratingDraft: (isGeneratingDraft) => set({ isGeneratingDraft }),

  updateDraft: (id, updates) => {
    set((state) => ({
      emailQueue: state.emailQueue.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    }));
  },

  approveAndSendDraft: (id) => {
    set((state) => {
      const nextQueue = state.emailQueue.filter((item) => item.id !== id);
      const nextSelected =
        state.selectedQueueItemId === id ? nextQueue[0]?.id || null : state.selectedQueueItemId;
      return { emailQueue: nextQueue, selectedQueueItemId: nextSelected };
    });
  },

  batchApproveAndSend: (ids) => {
    set((state) => {
      const idSet = new Set(ids);
      const nextQueue = state.emailQueue.filter((item) => !idSet.has(item.id));
      return { emailQueue: nextQueue, selectedQueueItemId: nextQueue[0]?.id || null };
    });
  },

  addConversationMessage: (conversationId, text) => {
    set((state) => ({
      conversations: state.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const newMsg = { from: "me" as const, text, at: "Just now" };
        return {
          ...conv,
          last_message: text,
          last_ago: "Just now",
          messages: [...conv.messages, newMsg],
        };
      }),
    }));
  },
}));
