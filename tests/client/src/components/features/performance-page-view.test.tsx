import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PerformancePageView } from "@/components/features/performance-page-view";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  api: {
    getMyLeads: vi.fn(),
    getConversations: vi.fn(),
    getEmailQueue: vi.fn(),
    getRecruiterScore: vi.fn(),
    getRecruiterKpiSummary: vi.fn(),
    getKpiConfig: vi.fn(),
    recomputeRecruiterScore: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function renderWithClient(subjectId = "rec-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformancePageView subjectId={subjectId} />
    </QueryClientProvider>
  );
}

function lead(overrides: Partial<any> = {}) {
  return {
    id: "lead-1",
    status: "NEW",
    flags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getRecruiterScore as any).mockResolvedValue({ snapshot: null, metricSnapshots: [] });
  (api.getRecruiterKpiSummary as any).mockResolvedValue({ summary: null });
  (api.getKpiConfig as any).mockResolvedValue({ kpiConfig: [] });
});

describe("PerformancePageView", () => {
  it("uses the authenticated user's name as subject name and computes pipeline tiles", async () => {
    (useAuth as any).mockReturnValue({ user: { name: "Jamie Lee", email: "jamie@x.com" } });
    (api.getMyLeads as any).mockResolvedValue({
      leads: [
        lead({ id: "l1", status: "NEW", flags: [] }),
        lead({ id: "l2", status: "CLOSED", flags: ["DNC"] }),
        lead({ id: "l3", status: "REPLIED", flags: [] }),
        lead({ id: "l4", status: "PLACED", flags: [] }),
      ],
    });
    (api.getConversations as any).mockResolvedValue({
      conversations: [{ id: "c1", unread: true }, { id: "c2", unread: false }],
    });
    (api.getEmailQueue as any).mockResolvedValue({
      items: [{ id: "e1", status: "FOLLOW_UP" }, { id: "e2", status: "REVIEW_NEEDED" }, { id: "e3", status: "SENT" }],
    });

    renderWithClient();

    await waitFor(() => expect(screen.getByText("Jamie Lee")).toBeInTheDocument());
    // assigned = 4, active = 2 (NEW + REPLIED, excluding CLOSED/PLACED), activePct = 50%
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("50% of assigned")).toBeInTheDocument();
    expect(screen.getByText("awaiting your reply")).toBeInTheDocument(); // unread conversations = 1
    // follow-ups pending: FOLLOW_UP + REVIEW_NEEDED = 2
    expect(screen.getByText("in email queue")).toBeInTheDocument();
    // DNC count = 1
    expect(screen.getByText("DNC count")).toBeInTheDocument();
    expect(screen.getByText("opted out / bounced")).toBeInTheDocument();
  });

  it("falls back to email prefix when user has no name, and to roleLabel with no user", async () => {
    (useAuth as any).mockReturnValue({ user: { email: "casey@example.com" } });
    (api.getMyLeads as any).mockResolvedValue({ leads: [] });
    (api.getConversations as any).mockResolvedValue({ conversations: [] });
    (api.getEmailQueue as any).mockResolvedValue({ items: [] });

    renderWithClient();
    await waitFor(() => expect(screen.getByText("casey")).toBeInTheDocument());
  });

  it("falls back to roleLabel when there is no user at all", async () => {
    (useAuth as any).mockReturnValue({ user: null });
    (api.getMyLeads as any).mockResolvedValue({ leads: [] });
    (api.getConversations as any).mockResolvedValue({ conversations: [] });
    (api.getEmailQueue as any).mockResolvedValue({ items: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PerformancePageView subjectId="rec-1" roleLabel="Contractor" />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getAllByText("Contractor").length).toBeGreaterThan(0));
  });

  it("renders zeroed tiles with no assigned leads (avoids divide-by-zero)", async () => {
    (useAuth as any).mockReturnValue({ user: { name: "Empty User", email: "empty@x.com" } });
    (api.getMyLeads as any).mockResolvedValue({ leads: [] });
    (api.getConversations as any).mockResolvedValue({ conversations: [] });
    (api.getEmailQueue as any).mockResolvedValue({ items: [] });

    renderWithClient();
    await waitFor(() => expect(screen.getByText("Empty User")).toBeInTheDocument());
    expect(screen.getByText("0% of assigned")).toBeInTheDocument();
  });
});
