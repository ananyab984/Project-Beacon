import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EscalationsBell } from "@/components/features/escalations";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getEscalations: vi.fn(),
    updateEscalation: vi.fn(),
  },
}));

function esc(overrides: Partial<any> = {}) {
  return {
    id: "e1",
    priority: "P2",
    status: "OPEN",
    category: "Pipeline",
    ownerUserId: null,
    title: "Lead stuck",
    detail: "A lead hasn't moved in 10 days",
    recommendedAction: "Reach out to the lead",
    slaHoursRemaining: 12,
    impact: null,
    recruiterId: null,
    leadId: null,
    clientId: null,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    ...overrides,
  };
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EscalationsBell />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EscalationsBell", () => {
  it("shows loading state in the popover, then the resolved list", async () => {
    let resolveFn: (v: any) => void;
    (api.getEscalations as any).mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText(/Loading escalations/i)).toBeInTheDocument());
    resolveFn!({ escalations: [] });
    await waitFor(() => expect(screen.getByText(/No escalations right now/i)).toBeInTheDocument());
  });

  it("renders empty state when there are no escalations", async () => {
    (api.getEscalations as any).mockResolvedValue({ escalations: [] });
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText(/No escalations right now/i)).toBeInTheDocument());
  });

  it("renders an error state when the query fails", async () => {
    (api.getEscalations as any).mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText(/Couldn't load escalations/i)).toBeInTheDocument());
  });

  it("sorts by priority then age, and shows the P1 count badge", async () => {
    (api.getEscalations as any).mockResolvedValue({
      escalations: [
        esc({ id: "e-p2-old", priority: "P2", createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), title: "P2 old" }),
        esc({ id: "e-p1-new", priority: "P1", createdAt: new Date(Date.now() - 1 * 86400000).toISOString(), title: "P1 new" }),
        esc({ id: "e-p1-old", priority: "P1", createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), title: "P1 old" }),
      ],
    });
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));

    await waitFor(() => expect(screen.getByText("P1 old")).toBeInTheDocument());
    const titles = screen.getAllByText(/P1 old|P1 new|P2 old/).map((el) => el.textContent);
    expect(titles).toEqual(["P1 new", "P1 old", "P2 old"]);
    expect(screen.getByText(/2 P1 · 3 open · owner-only view/i)).toBeInTheDocument();
  });

  it("opens the detail dialog and assigns to me", async () => {
    (api.getEscalations as any).mockResolvedValue({ escalations: [esc({ title: "Lead stuck" })] });
    (api.updateEscalation as any).mockResolvedValue({ escalation: esc() });
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText("Lead stuck")).toBeInTheDocument());

    await user.click(screen.getByText("Lead stuck"));
    expect(screen.getByText("A lead hasn't moved in 10 days")).toBeInTheDocument();
    expect(screen.getByText("Reach out to the lead")).toBeInTheDocument();
    expect(screen.getByText("12h remaining")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Assign to me/i }));
    await waitFor(() => expect(api.updateEscalation).toHaveBeenCalledWith("e1", { assignToMe: true }));
  });

  it("dismisses (acknowledges) an escalation from the dialog", async () => {
    (api.getEscalations as any).mockResolvedValue({ escalations: [esc({ title: "Lead stuck" })] });
    (api.updateEscalation as any).mockResolvedValue({ escalation: esc() });
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText("Lead stuck")).toBeInTheDocument());
    await user.click(screen.getByText("Lead stuck"));

    await user.click(screen.getByRole("button", { name: /Dismiss/i }));
    await waitFor(() => expect(api.updateEscalation).toHaveBeenCalledWith("e1", { status: "ACKNOWLEDGED" }));
  });

  it("shows breached SLA hours as a negative remaining count", async () => {
    (api.getEscalations as any).mockResolvedValue({
      escalations: [esc({ title: "Breached item", slaHoursRemaining: -5 })],
    });
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText("Breached item")).toBeInTheDocument());
    await user.click(screen.getByText("Breached item"));
    expect(screen.getByText("5h breached")).toBeInTheDocument();
  });

  it("renders optional impact, recruiter and lead fields when present", async () => {
    (api.getEscalations as any).mockResolvedValue({
      escalations: [
        esc({
          title: "Full detail item",
          impact: "Client may churn",
          recruiterId: "rec-9",
          leadId: "lead-9",
          slaHoursRemaining: null,
        }),
      ],
    });
    const user = userEvent.setup();
    renderWithClient();
    await user.click(screen.getByRole("button", { name: /Escalated items/i }));
    await waitFor(() => expect(screen.getByText("Full detail item")).toBeInTheDocument());
    await user.click(screen.getByText("Full detail item"));
    expect(screen.getByText("Client may churn")).toBeInTheDocument();
    expect(screen.getByText("rec-9")).toBeInTheDocument();
    expect(screen.getByText("lead-9")).toBeInTheDocument();
  });
});
