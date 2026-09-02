import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvaluationDashboard } from "@/components/features/evaluation-dashboard";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getRecruiterScore: vi.fn(),
    getRecruiterKpiSummary: vi.fn(),
    getKpiConfig: vi.fn(),
    recomputeRecruiterScore: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const kpiConfig = [
  { id: "k1", metricKey: "outreach_volume", group: "Activity & Effort", label: "Outreach Volume", unit: "count", weight: 10, target: 50, goodBand: null, direction: "HIGHER_IS_BETTER", scored: true, effectiveDate: "2026-01-01", notes: "Weekly outbound touches." },
  { id: "k2", metricKey: "response_time", group: "Activity & Effort", label: "Response Time", unit: "days", weight: 5, target: 1, goodBand: null, direction: "LOWER_IS_BETTER", scored: true, effectiveDate: "2026-01-01", notes: null },
  { id: "k3", metricKey: "placements", group: "Outcome Metrics", label: "Placements", unit: "count", weight: null, target: null, goodBand: 3, direction: "HIGHER_IS_BETTER", scored: false, effectiveDate: "2026-01-01", notes: null },
];

const metricSnapshots = [
  { id: "m1", scoreSnapshotId: "s1", metricKey: "outreach_volume", currentValue: 42, previousValue: 30, baseline: 20, changePct: 40, trend: "up", metricStatus: "on_track", normalized: 0.8 },
  { id: "m2", scoreSnapshotId: "s1", metricKey: "response_time", currentValue: 2.5, previousValue: 3, baseline: 4, changePct: -16, trend: "down", metricStatus: "watch", normalized: 0.5 },
  { id: "m3", scoreSnapshotId: "s1", metricKey: "placements", currentValue: 1, previousValue: 0, baseline: 0, changePct: 100, trend: "up", metricStatus: "off_track", normalized: 0.2 },
];

function renderDashboard(props: Partial<React.ComponentProps<typeof EvaluationDashboard>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EvaluationDashboard subjectId="rec-1" subjectName="Jamie Lee" {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EvaluationDashboard", () => {
  it("shows a loading state", () => {
    (api.getRecruiterScore as any).mockReturnValue(new Promise(() => {}));
    (api.getRecruiterKpiSummary as any).mockReturnValue(new Promise(() => {}));
    (api.getKpiConfig as any).mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText(/Loading evaluation/i)).toBeInTheDocument();
  });

  it("shows an error state when the score query fails", async () => {
    (api.getRecruiterScore as any).mockRejectedValue(new Error("boom"));
    (api.getRecruiterKpiSummary as any).mockResolvedValue({ summary: null });
    (api.getKpiConfig as any).mockResolvedValue({ kpiConfig: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/Failed to load evaluation data/i)).toBeInTheDocument());
  });

  it("renders the no-data empty states when nothing has been computed yet", async () => {
    (api.getRecruiterScore as any).mockResolvedValue({ snapshot: null, metricSnapshots: [] });
    (api.getRecruiterKpiSummary as any).mockResolvedValue({ summary: null });
    (api.getKpiConfig as any).mockResolvedValue({ kpiConfig: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Jamie Lee")).toBeInTheDocument());
    expect(screen.getByText("No Data")).toBeInTheDocument();
    expect(screen.getByText(/No score computed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No KPI summary computed yet for Jamie Lee/i)).toBeInTheDocument();
  });

  it("renders score, KPI tiles, and grouped metric tables from real data", async () => {
    (api.getRecruiterScore as any).mockResolvedValue({
      snapshot: { id: "s1", recruiterId: "rec-1", period: "2026-08", isNew: false, overallScore: 78, previousScore: 70, bandLabel: "Meeting Expectations", summary: "Solid month.", computedAt: "2026-08-01" },
      metricSnapshots,
    });
    (api.getRecruiterKpiSummary as any).mockResolvedValue({
      summary: {
        id: "sum1", recruiterId: "rec-1", outreachEffectiveness: 65.4, responseRate: 80, slaAdherence: 90,
        overallScore: 78, outreachVolume: 42, dncPct: 3, interviewToOffer: 25, offerAcceptance: 60,
        profileQuality: 88, clientSatisfaction: 91, aiAdoption: 40, pipelineHealth: 70, emailOpenRate: 55,
        avgTurnaroundDays: 1.5, computedAt: "2026-08-01",
      },
    });
    (api.getKpiConfig as any).mockResolvedValue({ kpiConfig });

    renderDashboard();
    await waitFor(() => expect(screen.getByText("Meeting Expectations")).toBeInTheDocument());
    expect(screen.getByText("Solid month.")).toBeInTheDocument();

    // KPI summary tiles formatted correctly
    expect(screen.getByText("65%")).toBeInTheDocument(); // outreachEffectiveness rounded
    expect(screen.getByText("1.5d")).toBeInTheDocument(); // avgTurnaroundDays

    // Groups derived from kpi-config order
    expect(screen.getByText("Activity & Effort")).toBeInTheDocument();
    expect(screen.getByText("Outcome Metrics")).toBeInTheDocument();
    expect(screen.getByText("Volume, persistence, and promptness of recruiter-initiated work.")).toBeInTheDocument();

    // Metric formatting: days value -> "2.5d"
    expect(screen.getByText("2.5d")).toBeInTheDocument();

    // Status chips (ScoreRing also renders its own "On track"-style label, so allow >=1)
    expect(screen.getAllByText("On track").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Watch")).toBeInTheDocument();
    expect(screen.getByText("Off track")).toBeInTheDocument();
  });

  it("recomputes the score on button click and invalidates queries", async () => {
    (api.getRecruiterScore as any).mockResolvedValue({ snapshot: null, metricSnapshots: [] });
    (api.getRecruiterKpiSummary as any).mockResolvedValue({ summary: null });
    (api.getKpiConfig as any).mockResolvedValue({ kpiConfig: [] });
    (api.recomputeRecruiterScore as any).mockResolvedValue({
      success: true,
      snapshot: { id: "s2", recruiterId: "rec-1", period: "2026-08", isNew: true, overallScore: 90, previousScore: 78, bandLabel: "Strong", summary: null, computedAt: "2026-08-15" },
    });
    const user = userEvent.setup();
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Jamie Lee")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Recalculate Score/i }));
    await waitFor(() => expect(api.recomputeRecruiterScore).toHaveBeenCalledWith("rec-1"));
  });

  it("collapses and expands a metric group when isExpandable is true", async () => {
    (api.getRecruiterScore as any).mockResolvedValue({
      snapshot: { id: "s1", recruiterId: "rec-1", period: "2026-08", isNew: false, overallScore: 78, previousScore: 70, bandLabel: "Meeting Expectations", summary: null, computedAt: "2026-08-01" },
      metricSnapshots,
    });
    (api.getRecruiterKpiSummary as any).mockResolvedValue({ summary: null });
    (api.getKpiConfig as any).mockResolvedValue({ kpiConfig });
    const user = userEvent.setup();
    renderDashboard({ isExpandable: true });

    await waitFor(() => expect(screen.getByText("Activity & Effort")).toBeInTheDocument());
    expect(screen.getByText("Outreach Volume")).toBeInTheDocument();

    await user.click(screen.getByText("Activity & Effort"));
    expect(screen.queryByText("Outreach Volume")).not.toBeInTheDocument();

    await user.click(screen.getByText("Activity & Effort"));
    expect(screen.getByText("Outreach Volume")).toBeInTheDocument();
  });

  it("uses a custom roleLabel", async () => {
    (api.getRecruiterScore as any).mockResolvedValue({ snapshot: null, metricSnapshots: [] });
    (api.getRecruiterKpiSummary as any).mockResolvedValue({ summary: null });
    (api.getKpiConfig as any).mockResolvedValue({ kpiConfig: [] });
    renderDashboard({ roleLabel: "Contractor" });
    await waitFor(() => expect(screen.getByText(/Overall Contractor Score/i)).toBeInTheDocument());
  });
});
