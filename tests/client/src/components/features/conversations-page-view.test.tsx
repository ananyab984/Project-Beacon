import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationsPageView } from "@/components/features/conversations-page-view";
import { api } from "@/lib/api";
import type { ApiConversation } from "@/lib/api-types";

vi.mock("@/lib/api", () => ({
  api: {
    getConversations: vi.fn(),
    generateLinkedInDraft: vi.fn(),
    sendConversationMessage: vi.fn(),
    createConversation: vi.fn(),
    getConnectedAccounts: vi.fn(),
    checkFaq: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/features/search-lead-dialog", () => ({
  SearchLeadDialog: ({ trigger, onSelectLead }: any) => (
    <div>
      {trigger}
      <button
        onClick={() =>
          onSelectLead({
            id: "lead-new",
            fullName: "New Lead",
            displayName: null,
            profileLink: "https://linkedin.com/in/newlead",
            services: ["Subtitling"],
            targetLanguage: "French",
          })
        }
      >
        mock-select-lead
      </button>
    </div>
  ),
}));

vi.mock("@/components/features/connect-account-dialog", () => ({
  ConnectAccountDialog: () => null,
}));

vi.mock("@/components/features/select-account-dialog", () => ({
  SelectAccountDialog: ({ open, accounts, onSelectAccount }: any) =>
    open ? (
      <div>
        {accounts.map((a: any) => (
          <button key={a.unipileAccountId} onClick={() => onSelectAccount(a.unipileAccountId)}>
            pick-{a.unipileAccountId}
          </button>
        ))}
      </div>
    ) : null,
}));

function conv(overrides: Partial<ApiConversation> = {}): ApiConversation {
  return {
    id: "conv-1",
    leadId: "lead-1",
    lead: { fullName: "Jordan Rivera", displayName: null, email: null, profileLink: "https://linkedin.com/in/jordan" },
    recruiterId: "rec-1",
    candidateName: "Jordan Rivera",
    candidateRole: "Subtitler",
    channel: "LINKEDIN",
    unread: false,
    lastMessageAt: new Date(Date.now() - 3600_000).toISOString(),
    messages: [
      { id: "m1", conversationId: "conv-1", sender: "ME", text: "Hi Jordan, interested in freelance work?", sentAt: "2026-08-01T10:00:00Z", externalMessageId: null },
      { id: "m2", conversationId: "conv-1", sender: "THEM", text: "Yes, tell me more!", sentAt: "2026-08-01T11:00:00Z", externalMessageId: "ext-1" },
    ],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationsPageView />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConversationsPageView", () => {
  it("shows a loading state", () => {
    (api.getConversations as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading conversations/i)).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    (api.getConversations as any).mockRejectedValue(new Error("network down"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to load conversations: network down/i)).toBeInTheDocument());
  });

  it("shows an empty state when there are no LinkedIn conversations", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("No LinkedIn conversations yet.")).toBeInTheDocument());
  });

  it("filters out non-LinkedIn conversations from the thread list", async () => {
    (api.getConversations as any).mockResolvedValue({
      conversations: [conv({ id: "conv-1" }), conv({ id: "conv-2", channel: "EMAIL", candidateName: "Email Only Person" })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("1 Active Threads")).toBeInTheDocument());
    expect(screen.queryByText("Email Only Person")).not.toBeInTheDocument();
  });

  it("renders messages for the auto-selected first conversation", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));
    expect(screen.getByText("Hi Jordan, interested in freelance work?")).toBeInTheDocument();
    expect(screen.getByText("(Enriched Profile)")).toBeInTheDocument();
  });

  it("shows the no-messages empty state with a generate-draft CTA", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv({ messages: [] })] });
    renderPage();
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());
  });

  it("filters threads by the search box (name and role)", async () => {
    (api.getConversations as any).mockResolvedValue({
      conversations: [
        conv({ id: "conv-1", candidateName: "Jordan Rivera", candidateRole: "Subtitler" }),
        conv({ id: "conv-2", candidateName: "Alex Kim", candidateRole: "Dubbing Director" }),
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Jordan Rivera").length).toBeGreaterThan(0));
    expect(screen.getByText("Alex Kim")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search threads…"), "dubbing");
    expect(screen.queryByText("Subtitler")).not.toBeInTheDocument();
    expect(screen.getAllByText("Alex Kim").length).toBeGreaterThan(0);
  });

  it("adds a lead from search, creating a conversation with a prefilled draft", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [] });
    (api.createConversation as any).mockResolvedValue({ conversation: conv({ id: "conv-new", leadId: "lead-new" }) });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("No LinkedIn conversations yet.")).toBeInTheDocument());

    await user.click(screen.getAllByText("mock-select-lead")[0]);
    await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith("lead-new"));
  });

  it("generates a LinkedIn draft successfully", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv({ messages: [] })] });
    (api.generateLinkedInDraft as any).mockResolvedValue({ draft: { body: "Here's an official draft." } });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Generate Draft/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Here's an official draft.")).toBeInTheDocument());
  });

  it("falls back to a template draft when generation fails", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv({ messages: [] })] });
    (api.generateLinkedInDraft as any).mockRejectedValue(new Error("service down"));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Generate Draft/i }));
    await waitFor(() =>
      expect(screen.getByDisplayValue(/noticed your work in Subtitler/)).toBeInTheDocument()
    );
  });

  it("checks the FAQ against the candidate's last message and autofills the draft", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    (api.checkFaq as any).mockResolvedValue({ match: true, answer: "We pay net 30.", matchedQuestion: "When do I get paid?" });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: /Check FAQ/i }));
    await waitFor(() => expect(api.checkFaq).toHaveBeenCalledWith("Yes, tell me more!"));
    await waitFor(() => expect(screen.getByDisplayValue("We pay net 30.")).toBeInTheDocument());
  });

  it("sends a message directly when exactly one LinkedIn account is connected", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "acc-1", provider: "LINKEDIN", status: "OK" },
    ]);
    (api.sendConversationMessage as any).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));

    const textarea = screen.getByPlaceholderText("Type your message...");
    fireEvent.change(textarea, { target: { value: "Great, let's talk." } });
    await user.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() =>
      expect(api.sendConversationMessage).toHaveBeenCalledWith("conv-1", "Great, let's talk.", "acc-1", "https://linkedin.com/in/jordan")
    );
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Message dispatched via LinkedIn!"));
  });

  it("shows an error toast with a connect action when no LinkedIn account is connected", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    (api.getConnectedAccounts as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), { target: { value: "Hello" } });
    await user.click(screen.getByRole("button", { name: /Send/i }));

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No connected LinkedIn account found", expect.any(Object)));
    expect(api.sendConversationMessage).not.toHaveBeenCalled();
  });

  it("opens the account picker when multiple LinkedIn accounts are connected, and sends with the chosen account", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "acc-1", provider: "LINKEDIN", status: "OK" },
      { unipileAccountId: "acc-2", provider: "LINKEDIN", status: "OK" },
    ]);
    (api.sendConversationMessage as any).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), { target: { value: "Pick an account" } });
    await user.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(screen.getByText("pick-acc-2")).toBeInTheDocument());
    await user.click(screen.getByText("pick-acc-2"));
    await waitFor(() =>
      expect(api.sendConversationMessage).toHaveBeenCalledWith("conv-1", "Pick an account", "acc-2", "https://linkedin.com/in/jordan")
    );
  });

  it("shows an account-not-connected error distinctly from a generic send failure", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    (api.getConnectedAccounts as any).mockResolvedValue([{ unipileAccountId: "acc-1", provider: "LINKEDIN", status: "OK" }]);
    const err: any = new Error("Please connect your account first");
    err.code = "ACCOUNT_NOT_CONNECTED";
    (api.sendConversationMessage as any).mockRejectedValue(err);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), { target: { value: "Hello" } });
    await user.click(screen.getByRole("button", { name: /Send/i }));

    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Unipile LinkedIn account not connected", expect.any(Object))
    );
  });

  it("sends on Enter but not Shift+Enter", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv()] });
    (api.getConnectedAccounts as any).mockResolvedValue([{ unipileAccountId: "acc-1", provider: "LINKEDIN", status: "OK" }]);
    (api.sendConversationMessage as any).mockResolvedValue({ success: true });
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));

    const textarea = screen.getByPlaceholderText("Type your message...");
    fireEvent.change(textarea, { target: { value: "quick reply" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(api.sendConversationMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(api.sendConversationMessage).toHaveBeenCalled());
  });

  it("shows Unread status for unread conversations in the context sidebar", async () => {
    (api.getConversations as any).mockResolvedValue({ conversations: [conv({ unread: true })] });
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Yes, tell me more!").length).toBeGreaterThan(0));
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
