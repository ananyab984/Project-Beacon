import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadKanbanBoard } from "@/components/features/lead-kanban-board";
import { api } from "@/lib/api";
import type { ApiLead, ApiUser, LeadTimelineEvent } from "@/lib/api-types";

vi.mock("@/lib/api", () => ({
  api: {
    getLead: vi.fn(),
  },
}));

// dnd-kit's pointer-sensor drag simulation is unreliable in jsdom (no real
// layout/pointer capture). Instead of simulating pointer events, capture the
// real `onDragEnd` handler DndContext is mounted with and invoke it directly
// with a synthetic DragEndEvent -- this exercises the component's actual
// handleDragEnd logic (COLD-reason prompt, same-stage no-op, unknown lead)
// rather than a reimplementation of it.
let capturedOnDragEnd: ((event: any) => void) | null = null;
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<any>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: any) => {
      capturedOnDragEnd = onDragEnd;
      return children;
    },
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
    useDroppable: () => ({
      setNodeRef: vi.fn(),
      isOver: false,
    }),
  };
});

function makeLead(overrides: Partial<ApiLead> = {}): ApiLead {
  return {
    id: "lead-1",
    createdByRecruiterId: null,
    createdByContractorId: null,
    assignedRecruiterId: "rec-1",
    assignedAt: null,
    isSelfSourced: false,
    claimedByRecruiterId: null,
    claimedAt: null,
    dupFlagged: false,
    dupFlaggedField: null,
    enrichmentStatus: "COMPLETE",
    promotedToGlobalAt: null,
    justEnrichedUntil: null,
    stage: "NEW",
    status: "NEW",
    priority: "P1",
    flags: [],
    closureReason: null,
    closureReasonLoggedAt: null,
    maskedLabel: null,
    identityResolved: true,
    displayName: "Jordan Rivera",
    firstName: "Jordan",
    fullName: "Jordan Rivera",
    profileLink: "https://linkedin.com/in/jordan",
    country: "Mexico",
    contactNumber: "+52 555 0100",
    email: "jordan@example.com",
    emailVerified: true,
    reachoutDate: null,
    applicationDate: null,
    services: ["Subtitling", "Dubbing", "QC"],
    sourceLanguage: "English",
    targetLanguage: "Spanish",
    secondaryLanguages: [],
    source: "LINKEDIN",
    yearsOfExperience: 5,
    vendorExperience: null,
    headline: null,
    aboutSnippet: null,
    currentTitle: null,
    toolsSoftware: [],
    certifications: [],
    fieldSources: null,
    clayData: null,
    availability: "AVAILABLE_NOW",
    availabilityFromDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    lastActivityAt: new Date(Date.now() - 3600_000).toISOString(),
    ...overrides,
  };
}

const recruiters: ApiUser[] = [
  {
    id: "rec-1",
    name: "Casey Owner",
    email: "casey@x.com",
    role: "RECRUITER",
    workStatus: "PERMANENT",
    languages: [],
    emailVerified: true,
    isActive: true,
    startDate: "2025-01-01",
    createdAt: "2025-01-01",
  },
];

function renderBoard(leads: ApiLead[], onStageChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LeadKanbanBoard leads={leads} recruiters={recruiters} onStageChange={onStageChange} />
    </QueryClientProvider>
  );
  return { ...utils, onStageChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LeadKanbanBoard", () => {
  it("shows a loading state", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <LeadKanbanBoard leads={[]} recruiters={recruiters} isLoading onStageChange={vi.fn()} />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Loading board/i)).toBeInTheDocument();
  });

  it("renders all stage columns with empty-state placeholders when there are no leads", () => {
    renderBoard([]);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Contacted")).toBeInTheDocument();
    expect(screen.getByText("Cold")).toBeInTheDocument();
    expect(screen.getAllByText("No leads").length).toBe(7);
  });

  it("buckets leads into the correct stage columns and truncates extra service badges", () => {
    renderBoard([
      makeLead({ id: "l1", stage: "NEW", displayName: "Jordan Rivera" }),
      makeLead({ id: "l2", stage: "NEGOTIATING", displayName: "Sam Cruz", services: ["Subtitling"] }),
    ]);
    expect(screen.getByText("Jordan Rivera")).toBeInTheDocument();
    expect(screen.getByText("Sam Cruz")).toBeInTheDocument();
    // 3 services -> 2 visible + "+1"
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getAllByText("Casey Owner").length).toBe(2);
  });

  it("shows Unassigned when a lead has no matching recruiter", () => {
    renderBoard([makeLead({ id: "l1", assignedRecruiterId: null })]);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("opens the lead detail dialog on card click and renders timeline events", async () => {
    (api.getLead as any).mockResolvedValue({
      lead: makeLead({ id: "l1" }),
      timeline: [
        { type: "STAGE_CHANGE", at: "2026-01-02T00:00:00Z", data: { fromStage: "NEW", toStage: "CONTACTED" } },
        { type: "FLAG", at: "2026-01-03T00:00:00Z", data: { action: "added", flag: "HIGH_PRIORITY", reason: "VIP client" } },
        { type: "INTERACTION", at: "2026-01-04T00:00:00Z", data: { direction: "OUTBOUND", channel: "EMAIL" } },
        { type: "MANUAL_ACTIVITY", at: "2026-01-05T00:00:00Z", data: { type: "CALL", purpose: "Intro", outcome: "Interested" } },
      ] as LeadTimelineEvent[],
    });
    const user = userEvent.setup();
    renderBoard([makeLead({ id: "l1", displayName: "Jordan Rivera" })]);

    await user.click(screen.getByText("Jordan Rivera"));
    expect(screen.getByText("Card details and full activity timeline.")).toBeInTheDocument();
    expect(screen.getByText("jordan@example.com")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Stage → Contacted")).toBeInTheDocument());
    expect(screen.getByText(/Flag added: HIGH_PRIORITY/)).toBeInTheDocument();
    expect(screen.getByText(/Outreach sent · EMAIL/)).toBeInTheDocument();
    expect(screen.getByText("CALL")).toBeInTheDocument();
    expect(screen.getByText(/Intro — Interested/)).toBeInTheDocument();
  });

  it("shows an empty timeline message when there is no activity", async () => {
    (api.getLead as any).mockResolvedValue({ lead: makeLead({ id: "l1" }), timeline: [] });
    const user = userEvent.setup();
    renderBoard([makeLead({ id: "l1", displayName: "Jordan Rivera" })]);
    await user.click(screen.getByText("Jordan Rivera"));
    await waitFor(() => expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument());
  });

  it("closes the detail dialog", async () => {
    (api.getLead as any).mockResolvedValue({ lead: makeLead({ id: "l1" }), timeline: [] });
    const user = userEvent.setup();
    renderBoard([makeLead({ id: "l1", displayName: "Jordan Rivera" })]);
    await user.click(screen.getByText("Jordan Rivera"));
    await waitFor(() => expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument());
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]);
    await waitFor(() => expect(screen.queryByText("Card details and full activity timeline.")).not.toBeInTheDocument());
  });
});

describe("LeadKanbanBoard drag-and-drop stage changes (real handleDragEnd)", () => {
  beforeEach(() => {
    capturedOnDragEnd = null;
  });

  it("calls onStageChange without a reason for a normal stage move", () => {
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    expect(capturedOnDragEnd).toBeTruthy();
    capturedOnDragEnd!({ active: { id: "l1" }, over: { id: "CONTACTED" } });
    expect(onStageChange).toHaveBeenCalledWith("l1", "CONTACTED");
  });

  it("is a no-op when there is no drop target", () => {
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    capturedOnDragEnd!({ active: { id: "l1" }, over: null });
    expect(onStageChange).not.toHaveBeenCalled();
  });

  it("is a no-op when dropped on the same stage", () => {
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    capturedOnDragEnd!({ active: { id: "l1" }, over: { id: "NEW" } });
    expect(onStageChange).not.toHaveBeenCalled();
  });

  it("is a no-op when the dragged lead can't be found", () => {
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    capturedOnDragEnd!({ active: { id: "unknown-lead" }, over: { id: "CONTACTED" } });
    expect(onStageChange).not.toHaveBeenCalled();
  });

  it("requires a reason when moving to COLD, and skips the call when the prompt is cancelled", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    capturedOnDragEnd!({ active: { id: "l1" }, over: { id: "COLD" } });
    expect(promptSpy).toHaveBeenCalledWith("Reason for marking this lead Cold?");
    expect(onStageChange).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("skips the call when the COLD prompt reason is only whitespace", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("   ");
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    capturedOnDragEnd!({ active: { id: "l1" }, over: { id: "COLD" } });
    expect(onStageChange).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("passes the trimmed reason when moving to COLD with a prompt answer", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("  Ghosted us  ");
    const { onStageChange } = renderBoard([makeLead({ id: "l1", stage: "NEW" })]);
    capturedOnDragEnd!({ active: { id: "l1" }, over: { id: "COLD" } });
    expect(onStageChange).toHaveBeenCalledWith("l1", "COLD", "Ghosted us");
    promptSpy.mockRestore();
  });
});
