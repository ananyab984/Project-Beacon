import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmailQueuePageView } from "@/components/features/email-queue-page-view";
import { api } from "@/lib/api";
import type { ApiEmailQueueItem, ApiConversationMessage } from "@/lib/api-types";

vi.mock("@/lib/api", () => ({
  api: {
    getEmailQueue: vi.fn(),
    getLeads: vi.fn(),
    getConversationByLead: vi.fn(),
    addToEmailQueue: vi.fn(),
    generateEmailDraft: vi.fn(),
    updateEmailQueueItem: vi.fn(),
    sendEmailQueueItem: vi.fn(),
    getConnectedAccounts: vi.fn(),
    checkFaq: vi.fn(),
    sendConversationMessage: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/features/connect-account-dialog", () => ({
  ConnectAccountDialog: () => null,
}));

vi.mock("@/components/features/add-lead-dialog", () => ({
  AddLeadDialog: ({ trigger }: any) => <>{trigger}</>,
}));

vi.mock("@/components/features/search-lead-dialog", () => ({
  SearchLeadDialog: ({ trigger, onSelectLead }: any) => (
    <div>
      {trigger}
      <button onClick={() => onSelectLead({ id: "lead-new" })}>mock-select-lead</button>
    </div>
  ),
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

function item(overrides: Partial<ApiEmailQueueItem> = {}): ApiEmailQueueItem {
  return {
    id: "item-1",
    leadId: "lead-1",
    lead: { fullName: "Jordan Rivera", displayName: null, email: "jordan@example.com", profileLink: null },
    recruiterId: "rec-1",
    candidateName: "Jordan Rivera",
    candidateRole: "Subtitler",
    status: "AI_DRAFTED",
    to: null,
    subject: "Global3 Outreach",
    body: "Hi Jordan, we would love to work with you.",
    aiGenerated: true,
    receivedAt: new Date(Date.now() - 3600_000).toISOString(),
    sentAt: null,
    sentChannel: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailQueuePageView />
    </QueryClientProvider>
  );
}

function mockDefaults() {
  (api.getLeads as any).mockResolvedValue({ leads: [], nextCursor: null });
  (api.getConversationByLead as any).mockResolvedValue({ conversation: null, messages: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDefaults();
});

describe("EmailQueuePageView", () => {
  it("shows a loading state", () => {
    (api.getEmailQueue as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading email queue/i)).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    (api.getEmailQueue as any).mockRejectedValue(new Error("network down"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to load email queue: network down/i)).toBeInTheDocument());
  });

  it("shows an empty state with no items in the queue", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Add leads from an existing lead to get started/i)).toBeInTheDocument());
  });

  it("auto-selects the first item and populates the compose fields", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item({ id: "item-1" }), item({ id: "item-2", candidateName: "Alex Kim" })] });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Global3 Outreach")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hi Jordan, we would love to work with you.")).toBeInTheDocument();
  });

  it("switches compose fields when picking a different queue item", async () => {
    (api.getEmailQueue as any).mockResolvedValue({
      items: [
        item({ id: "item-1", candidateName: "Jordan Rivera" }),
        item({ id: "item-2", candidateName: "Alex Kim", subject: "Alex subject", body: "Alex body", lead: { fullName: "Alex Kim", displayName: null, email: "alex@example.com", profileLink: null } }),
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());

    await user.click(screen.getByText("Alex Kim"));
    await waitFor(() => expect(screen.getByDisplayValue("alex@example.com")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Alex subject")).toBeInTheDocument();
  });

  it("renders status badges with the correct label per status", async () => {
    (api.getEmailQueue as any).mockResolvedValue({
      items: [
        item({ id: "i1", status: "AI_DRAFTED", candidateName: "P1" }),
        item({ id: "i2", status: "FOLLOW_UP", candidateName: "P2" }),
        item({ id: "i3", status: "REVIEW_NEEDED", candidateName: "P3" }),
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("AI Drafted")).toBeInTheDocument());
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(screen.getByText("Review Needed")).toBeInTheDocument();
  });

  it("regression: uses the item's persisted `to` address over the lead's live email once saved", async () => {
    // Covers the "persist and display the actual recipient address" bug fix --
    // once an item has its own `to` (a recruiter override, or a saved send target),
    // that address is authoritative and must not be silently replaced by lead.email.
    (api.getEmailQueue as any).mockResolvedValue({
      items: [
        item({
          id: "item-1",
          to: "override@example.com",
          lead: { fullName: "Jordan Rivera", displayName: null, email: "jordan@example.com", profileLink: null },
        }),
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("override@example.com")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("jordan@example.com")).not.toBeInTheDocument();
  });

  it("regression: falls back to the lead's live email only when no `to` has been saved yet", async () => {
    (api.getEmailQueue as any).mockResolvedValue({
      items: [item({ id: "item-1", to: null, lead: { fullName: "Jordan Rivera", displayName: null, email: "jordan@example.com", profileLink: null } })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());
  });

  it("adds a lead to the queue via the search dialog", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [] });
    (api.addToEmailQueue as any).mockResolvedValue({
      item: item({ id: "item-added", candidateName: "New Lead", subject: "New subject", body: "New body", to: null, lead: { fullName: "New Lead", displayName: null, email: "new@example.com", profileLink: null } }),
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText(/Add leads from an existing lead to get started/i)).toBeInTheDocument());

    await user.click(screen.getAllByText("mock-select-lead")[0]);
    await waitFor(() => expect(api.addToEmailQueue).toHaveBeenCalledWith("lead-new"));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added New Lead to Email Queue!"));
  });

  it("filters the quick-add lead search dropdown by name and email", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [] });
    (api.getLeads as any).mockResolvedValue({
      leads: [
        { id: "l1", fullName: "Jordan Rivera", displayName: null, email: "jordan@example.com" },
        { id: "l2", fullName: "Alex Kim", displayName: null, email: "alex@example.com" },
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText(/Add leads from an existing lead to get started/i)).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search lead to add to queue…"), "jordan");
    expect(screen.getByText("Jordan Rivera")).toBeInTheDocument();
    expect(screen.queryByText("Alex Kim")).not.toBeInTheDocument();
  });

  it("saves a draft when clicking Save draft", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.updateEmailQueueItem as any).mockResolvedValue({ item: item() });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Save draft/i }));
    await waitFor(() => expect(api.updateEmailQueueItem).toHaveBeenCalledWith("item-1", {
      subject: "Global3 Outreach",
      body: "Hi Jordan, we would love to work with you.",
      to: "jordan@example.com",
    }));
    await waitFor(() => expect(screen.getByText(/Saved/)).toBeInTheDocument());
  });

  it("auto-saves after typing, via the debounced autosave timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.updateEmailQueueItem as any).mockResolvedValue({ item: item() });
    renderPage();
    await vi.waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());

    const subjectInput = screen.getByDisplayValue("Global3 Outreach");
    fireEvent.change(subjectInput, { target: { value: "Updated subject" } });
    expect(screen.getByText(/Unsaved changes/i)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(api.updateEmailQueueItem).toHaveBeenCalledWith("item-1", expect.objectContaining({ subject: "Updated subject" })));
    vi.useRealTimers();
  });

  it("regression: the debounced autosave does not drop the last keystroke (stale saveDraft closure)", async () => {
    // saveDraft() closes over subject/body/to state. markDirty() schedules
    // window.setTimeout(saveDraft, 1500) inside the very same synchronous
    // change-handler tick that also called setSubject/setBody/setTo -- before
    // that state update is committed. Without refs backing saveDraft's reads,
    // the timer fires with whatever `saveDraft` closed over *before* this
    // keystroke, silently discarding it. This single-change-event scenario
    // (type once, then go quiet) reproduces exactly that last-keystroke drop.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (api.getEmailQueue as any).mockResolvedValue({ items: [item({ body: "Original body" })] });
    (api.updateEmailQueueItem as any).mockResolvedValue({ item: item() });
    renderPage();
    await vi.waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());

    const bodyInput = screen.getByDisplayValue("Original body");
    fireEvent.change(bodyInput, { target: { value: "Original body plus one more edit" } });

    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(api.updateEmailQueueItem).toHaveBeenCalled());
    expect(api.updateEmailQueueItem).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ body: "Original body plus one more edit" })
    );
    vi.useRealTimers();
  });

  it("shows a save failure by reverting to dirty and toasting an error", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.updateEmailQueueItem as any).mockRejectedValue(new Error("save failed"));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("jordan@example.com")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Save draft/i }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("save failed"));
    expect(screen.getByText(/Unsaved changes/i)).toBeInTheDocument();
  });

  it("generates a draft when the body is empty", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item({ body: "" })] });
    (api.generateEmailDraft as any).mockResolvedValue({ item: item({ body: "Generated body", subject: "Generated subject" }) });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate Draft/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Generate Draft/i }));
    await waitFor(() => expect(api.generateEmailDraft).toHaveBeenCalledWith("item-1", "jordan@example.com"));
    await waitFor(() => expect(screen.getByDisplayValue("Generated body")).toBeInTheDocument());
  });

  it("shows a specific message when the drafting service is unavailable (502)", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item({ body: "" })] });
    const err: any = new Error("bad gateway");
    err.status = 502;
    (api.generateEmailDraft as any).mockRejectedValue(err);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate Draft/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Generate Draft/i }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Drafting service unavailable — write the message manually"));
  });

  it("checks the FAQ against the candidate's latest reply and autofills the body", async () => {
    const messages: ApiConversationMessage[] = [
      { id: "m1", conversationId: "c1", sender: "THEM", text: "How do I get paid?", sentAt: "2026-08-01T10:00:00Z", externalMessageId: null },
    ];
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.getConversationByLead as any).mockResolvedValue({ conversation: { id: "c1" }, messages });
    (api.checkFaq as any).mockResolvedValue({ match: true, answer: "Net 30 after invoice.", matchedQuestion: "How do I get paid?" });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Check FAQ/i })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: /Check FAQ/i }));
    await waitFor(() => expect(api.checkFaq).toHaveBeenCalledWith("How do I get paid?"));
    await waitFor(() => expect(screen.getByDisplayValue("Net 30 after invoice.")).toBeInTheDocument());
  });

  it("disables Check FAQ when there is no candidate reply yet", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Check FAQ/i })).toBeDisabled());
  });

  it("sends directly when a single connected account exists", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.getConnectedAccounts as any).mockResolvedValue([{ unipileAccountId: "acc-1", provider: "GOOGLE", status: "OK" }]);
    (api.sendEmailQueueItem as any).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Send$/i }));
    await waitFor(() =>
      expect(api.sendEmailQueueItem).toHaveBeenCalledWith("item-1", {
        to: "jordan@example.com",
        subject: "Global3 Outreach",
        body: "Hi Jordan, we would love to work with you.",
        channel: "EMAIL",
        accountId: "acc-1",
      })
    );
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Message sent via Unipile to Jordan Rivera!"));
  });

  it("routes to LINKEDIN channel when candidateRole mentions linkedin", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item({ candidateRole: "LinkedIn Outreach" })] });
    (api.getConnectedAccounts as any).mockResolvedValue([{ unipileAccountId: "acc-li", provider: "LINKEDIN", status: "OK" }]);
    (api.sendEmailQueueItem as any).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Send$/i }));
    await waitFor(() =>
      expect(api.sendEmailQueueItem).toHaveBeenCalledWith("item-1", expect.objectContaining({ channel: "LINKEDIN", accountId: "acc-li" }))
    );
  });

  it("shows a connect-account error when no account is connected for the channel", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.getConnectedAccounts as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Send$/i }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No connected Email account found", expect.any(Object)));
    expect(api.sendEmailQueueItem).not.toHaveBeenCalled();
  });

  it("opens the account picker with multiple connected accounts and sends with the chosen one", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.getConnectedAccounts as any).mockResolvedValue([
      { unipileAccountId: "acc-1", provider: "GOOGLE", status: "OK" },
      { unipileAccountId: "acc-2", provider: "OUTLOOK", status: "OK" },
    ]);
    (api.sendEmailQueueItem as any).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Send$/i }));
    await waitFor(() => expect(screen.getByText("pick-acc-2")).toBeInTheDocument());
    await user.click(screen.getByText("pick-acc-2"));
    await waitFor(() => expect(api.sendEmailQueueItem).toHaveBeenCalledWith("item-1", expect.objectContaining({ accountId: "acc-2" })));
  });

  it("shows an account-not-connected error distinctly on send failure", async () => {
    (api.getEmailQueue as any).mockResolvedValue({ items: [item()] });
    (api.getConnectedAccounts as any).mockResolvedValue([{ unipileAccountId: "acc-1", provider: "GOOGLE", status: "OK" }]);
    const err: any = new Error("connect your account");
    err.code = "ACCOUNT_NOT_CONNECTED";
    (api.sendEmailQueueItem as any).mockRejectedValue(err);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Send$/i }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unipile account not connected", expect.any(Object)));
  });

  it("renders a Delivered badge instead of Send for SENT items, using the persisted send record", async () => {
    (api.getEmailQueue as any).mockResolvedValue({
      items: [
        item({
          id: "item-1", status: "SENT", sentAt: "2026-08-01T12:00:00Z", sentChannel: "EMAIL",
          to: "sent-to@example.com", subject: "Sent subject", body: "Sent body",
        }),
      ],
    });
    (api.getConversationByLead as any).mockResolvedValue({
      conversation: { id: "c1" },
      messages: [{ id: "m1", conversationId: "c1", sender: "ME", text: "Sent body", sentAt: "2026-08-01T12:00:00Z", externalMessageId: null }],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Delivered via Email/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Send$/i })).not.toBeInTheDocument();
  });

  it("expands a message in the SENT thread and sends a reply threaded to the right message", async () => {
    (api.getEmailQueue as any).mockResolvedValue({
      items: [item({ id: "item-1", status: "SENT", sentAt: "2026-08-01T12:00:00Z", to: "jordan@example.com", subject: "Subj", body: "Original send" })],
    });
    (api.getConversationByLead as any).mockResolvedValue({
      conversation: { id: "conv-1" },
      messages: [
        { id: "m1", conversationId: "conv-1", sender: "ME", text: "Original send", sentAt: "2026-08-01T12:00:00Z", externalMessageId: null },
        { id: "m2", conversationId: "conv-1", sender: "THEM", text: "Thanks, interested!", sentAt: "2026-08-01T13:00:00Z", externalMessageId: "ext-2" },
      ],
    });
    (api.checkFaq as any).mockResolvedValue({ match: false });
    (api.sendConversationMessage as any).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Thanks, interested!")).toBeInTheDocument());
    // Latest message (the THEM reply) starts expanded -- reply affordance is visible.
    await waitFor(() => expect(screen.getByText("Reply to this message")).toBeInTheDocument());

    await user.click(screen.getByText("Reply to this message"));
    await waitFor(() => expect(api.checkFaq).toHaveBeenCalledWith("Thanks, interested!"));

    const replyBox = await screen.findByPlaceholderText("Type your reply…");
    fireEvent.change(replyBox, { target: { value: "Great, let's set up a call." } });
    await user.click(screen.getByRole("button", { name: /Send reply/i }));

    await waitFor(() =>
      expect(api.sendConversationMessage).toHaveBeenCalledWith("conv-1", "Great, let's set up a call.", undefined, undefined, "ext-2")
    );
  });

  it("collapses an expanded message back on second click", async () => {
    (api.getEmailQueue as any).mockResolvedValue({
      items: [item({ id: "item-1", status: "SENT", sentAt: "2026-08-01T12:00:00Z", to: "jordan@example.com" })],
    });
    (api.getConversationByLead as any).mockResolvedValue({
      conversation: { id: "conv-1" },
      messages: [{ id: "m1", conversationId: "conv-1", sender: "ME", text: "Original send", sentAt: "2026-08-01T12:00:00Z", externalMessageId: null }],
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Original send")).toBeInTheDocument());
    // Already expanded (latest message); clicking again collapses it to a one-line preview.
    await user.click(screen.getByText("Original send"));
    await waitFor(() => expect(screen.queryByText("Original send")).not.toBeInTheDocument());
  });
});
