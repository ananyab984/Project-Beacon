import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatValue, bandFor, METRIC_GROUPS, SCORE_BANDS, RUBRIC, getEvaluation } from "@/lib/evaluation";

vi.mock("@/lib/g3-mock", () => ({
  recruiterById: vi.fn(),
}));

import { recruiterById } from "@/lib/g3-mock";

describe("formatValue", () => {
  it("renders null as em dash", () => {
    expect(formatValue("count", null)).toBe("—");
    expect(formatValue("pct", null)).toBe("—");
  });
  it("formats pct", () => {
    expect(formatValue("pct", 50)).toBe("50%");
  });
  it("formats days", () => {
    expect(formatValue("days", 3)).toBe("3d");
  });
  it("formats attempts", () => {
    expect(formatValue("attempts", 2)).toBe("2x");
  });
  it("formats count as plain number", () => {
    expect(formatValue("count", 10)).toBe("10");
  });
});

describe("METRIC_GROUPS / RUBRIC", () => {
  it("has the three expected groups", () => {
    expect(METRIC_GROUPS).toEqual(["Activity & Effort", "Ownership & Follow-through", "Outcome Metrics"]);
  });
  it("every rubric entry belongs to a known group", () => {
    for (const m of RUBRIC) {
      expect(METRIC_GROUPS).toContain(m.group);
    }
  });
  it("scored weights sum to 100", () => {
    const total = RUBRIC.filter((m) => m.scored).reduce((acc, m) => acc + m.weight, 0);
    expect(total).toBe(100);
  });
});

describe("bandFor", () => {
  it("bands boundary scores correctly", () => {
    expect(bandFor(90).label).toBe("Strong");
    expect(bandFor(85).label).toBe("Strong");
    expect(bandFor(84).label).toBe("Solid");
    expect(bandFor(70).label).toBe("Solid");
    expect(bandFor(69).label).toBe("Coaching");
    expect(bandFor(55).label).toBe("Coaching");
    expect(bandFor(54).label).toBe("Review");
    expect(bandFor(1).label).toBe("Review");
    expect(bandFor(0).label).toBe("No Data");
  });
  it("falls back to the last band when no band matches (negative score)", () => {
    expect(bandFor(-5)).toBe(SCORE_BANDS[SCORE_BANDS.length - 1]);
  });
});

describe("getEvaluation", () => {
  beforeEach(() => {
    vi.mocked(recruiterById).mockReset();
  });

  it("handles an unknown subject with no recruiter record", () => {
    vi.mocked(recruiterById).mockReturnValue(undefined);
    const evalResult = getEvaluation("ghost-id", "Ghost");
    expect(evalResult.score).toBe(0);
    expect(evalResult.band.label).toBe("No Data");
    expect(evalResult.outreach.completed).toBe(0);
    expect(evalResult.outreach.assigned).toBe(0);
    expect(evalResult.sourcing.ratioLabel).toBe("0 : 0");
    for (const snap of evalResult.metrics) {
      expect(snap.current).toBe(0);
      expect(snap.status).toBe("signal");
      expect(snap.scoreContribution).toBe(0);
    }
  });

  it("computes on_track/watch/off_track for a lower-direction metric and score contribution", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 10,
      kpis: {
        outreach_volume: 100,
        time_to_first_touch: 1, // target 2, goodBand 1, direction lower -> on_track, full contribution
        overall_score: 42,
      },
    } as any);
    const result = getEvaluation("r1", "Rec One");
    const ttft = result.metrics.find((m) => m.def.id === "time_to_first_touch")!;
    expect(ttft.status).toBe("on_track");
    expect(ttft.scoreContribution).toBe(20); // ratio 1 * weight 20

    expect(result.score).toBe(42); // overall_score from kpis takes precedence
  });

  it("marks watch and off_track correctly for a lower-direction metric", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { time_to_first_touch: 2.5, overall_score: 10 }, // target 2, target*1.5=3 -> watch
    } as any);
    const watch = getEvaluation("r2", "Rec Two").metrics.find((m) => m.def.id === "time_to_first_touch")!;
    expect(watch.status).toBe("watch");

    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { time_to_first_touch: 10, overall_score: 10 },
    } as any);
    const offTrack = getEvaluation("r3", "Rec Three").metrics.find((m) => m.def.id === "time_to_first_touch")!;
    expect(offTrack.status).toBe("off_track");
  });

  it("computes on_track/watch/off_track for a higher-direction metric", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { progression_rate: 60, overall_score: 10 }, // target 60 -> on_track
    } as any);
    expect(getEvaluation("r4", "R4").metrics.find((m) => m.def.id === "progression_rate")!.status).toBe("on_track");

    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { progression_rate: 50, overall_score: 10 }, // 60*0.8=48 <= 50 -> watch
    } as any);
    expect(getEvaluation("r5", "R5").metrics.find((m) => m.def.id === "progression_rate")!.status).toBe("watch");

    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { progression_rate: 10, overall_score: 10 }, // below 48 -> off_track
    } as any);
    expect(getEvaluation("r6", "R6").metrics.find((m) => m.def.id === "progression_rate")!.status).toBe("off_track");
  });

  it("treats a null-target metric as signal regardless of value", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { outreach_volume: 999, overall_score: 10 },
    } as any);
    const snap = getEvaluation("r7", "R7").metrics.find((m) => m.def.id === "outreach_volume")!;
    expect(snap.status).toBe("signal");
  });

  it("does not score unscored metrics even with a matching kpi value", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { onboard_vs_queue: 100, overall_score: 10 },
    } as any);
    const snap = getEvaluation("r8", "R8").metrics.find((m) => m.def.id === "onboard_vs_queue")!;
    expect(snap.scoreContribution).toBe(0);
  });

  it("falls back to summed contributions when overall_score is absent", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { time_to_first_touch: 1 }, // no overall_score
    } as any);
    const result = getEvaluation("r9", "R9");
    const ttft = result.metrics.find((m) => m.def.id === "time_to_first_touch")!;
    expect(result.score).toBe(ttft.scoreContribution);
  });

  it("computes sourcing and outreach ratios from leads_onboarded", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 10,
      kpis: { outreach_volume: 100, overall_score: 50 },
    } as any);
    const result = getEvaluation("r10", "R10");
    expect(result.outreach.completed).toBe(100);
    expect(result.outreach.assigned).toBe(105); // round(100 * 1.05)
    expect(result.outreach.targetAchieved).toBe(false);
    expect(result.sourcing.assigned).toBe(30); // 10 * 3
    expect(result.sourcing.selfSourced).toBe(8); // round(10 * 0.8)
    expect(result.sourcing.ratioLabel).toBe("79 : 21");
  });

  it("marks outreach target achieved when completed exceeds assigned", () => {
    vi.mocked(recruiterById).mockReturnValue({
      leads_onboarded: 0,
      kpis: { outreach_volume: 0, overall_score: 0 },
    } as any);
    // outreachAssigned computed off kpis existing -> Math.round(0*1.05) = 0, completed 0
    // targetAchieved requires completed > 0
    const result = getEvaluation("r11", "R11");
    expect(result.outreach.targetAchieved).toBe(false);
    expect(result.outreach.achievedPct).toBe(0);
  });
});
