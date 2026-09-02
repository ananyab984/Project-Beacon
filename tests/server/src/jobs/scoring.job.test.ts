import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server-root/prisma", () => ({
  prisma: {
    kpiConfig: { findMany: vi.fn(), create: vi.fn() },
    interactionEvent: { count: vi.fn(), findMany: vi.fn() },
    lead: { count: vi.fn(), findMany: vi.fn() },
    stageHistory: { findMany: vi.fn(), count: vi.fn() },
    leadFlagEvent: { findMany: vi.fn() },
    manualActivityLog: { count: vi.fn() },
    requirement: { findMany: vi.fn() },
    recruiterScoreSnapshot: { findFirst: vi.fn(), upsert: vi.fn() },
    recruiterMetricSnapshot: { upsert: vi.fn() },
    recruiterKpiSummary: { upsert: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@server-root/prisma";
import {
  RUBRIC,
  calculateNormalizedMetricScore,
  calculateWeightedContribution,
  getBandLabel,
  computeRecruiterScoreSnapshot,
  runMonthlyScoring,
} from "@server/jobs/scoring.job";

const p: any = prisma;

beforeEach(() => {
  vi.clearAllMocks();
  p.$transaction.mockImplementation((arr: Promise<any>[]) => Promise.all(arr));
  p.kpiConfig.findMany.mockResolvedValue([]);
  p.kpiConfig.create.mockResolvedValue({});
  p.interactionEvent.count.mockResolvedValue(0);
  p.interactionEvent.findMany.mockResolvedValue([]);
  p.lead.count.mockResolvedValue(0);
  p.lead.findMany.mockResolvedValue([]);
  p.stageHistory.findMany.mockResolvedValue([]);
  p.stageHistory.count.mockResolvedValue(0);
  p.leadFlagEvent.findMany.mockResolvedValue([]);
  p.manualActivityLog.count.mockResolvedValue(0);
  p.requirement.findMany.mockResolvedValue([]);
  p.recruiterScoreSnapshot.findFirst.mockResolvedValue(null);
  p.recruiterScoreSnapshot.upsert.mockResolvedValue({ id: "snap-1" });
  p.recruiterMetricSnapshot.upsert.mockResolvedValue({});
  p.recruiterKpiSummary.upsert.mockResolvedValue({});
  p.user.findMany.mockResolvedValue([]);
});

describe("calculateNormalizedMetricScore", () => {
  it("returns 0 when actual is zero or negative", () => {
    expect(calculateNormalizedMetricScore(0, 100)).toBe(0);
    expect(calculateNormalizedMetricScore(-5, 100)).toBe(0);
  });

  it("returns 0 when target is missing or non-positive", () => {
    expect(calculateNormalizedMetricScore(50, 0)).toBe(0);
    expect(calculateNormalizedMetricScore(50, -10)).toBe(0);
  });

  it("higher-is-better: caps at 100 once actual meets or exceeds target", () => {
    expect(calculateNormalizedMetricScore(420, 420, "HIGHER_IS_BETTER")).toBe(100);
    expect(calculateNormalizedMetricScore(500, 420, "HIGHER_IS_BETTER")).toBe(100);
  });

  it("higher-is-better: scales proportionally below target", () => {
    expect(calculateNormalizedMetricScore(210, 420, "HIGHER_IS_BETTER")).toBe(50);
  });

  it("lower-is-better: scores 100 when actual is at or under target", () => {
    expect(calculateNormalizedMetricScore(1, 1, "LOWER_IS_BETTER")).toBe(100);
    expect(calculateNormalizedMetricScore(0.5, 1, "LOWER_IS_BETTER")).toBe(100);
  });

  it("lower-is-better: scales down as actual exceeds target", () => {
    expect(calculateNormalizedMetricScore(2, 1, "LOWER_IS_BETTER")).toBe(50);
  });

  it("defaults to HIGHER_IS_BETTER when no direction is given", () => {
    expect(calculateNormalizedMetricScore(50, 100)).toBe(50);
  });
});

describe("calculateWeightedContribution", () => {
  it("contributes 0 for an unscored (signal-only) metric regardless of performance", () => {
    expect(calculateWeightedContribution(100, 10, 30, false)).toBe(0);
  });

  it("contributes 0 when weight is zero or negative", () => {
    expect(calculateWeightedContribution(100, 10, 0, true)).toBe(0);
  });

  it("scales the normalized score by weight/100", () => {
    expect(calculateWeightedContribution(210, 420, 30, true, "HIGHER_IS_BETTER")).toBe(15);
  });
});

describe("getBandLabel", () => {
  it("maps score ranges to the documented band labels", () => {
    expect(getBandLabel(85)).toBe("Strong");
    expect(getBandLabel(100)).toBe("Strong");
    expect(getBandLabel(70)).toBe("Solid");
    expect(getBandLabel(84)).toBe("Solid");
    expect(getBandLabel(50)).toBe("Coaching");
    expect(getBandLabel(69)).toBe("Coaching");
    expect(getBandLabel(49)).toBe("Review");
    expect(getBandLabel(0)).toBe("Review");
  });
});

describe("computeRecruiterScoreSnapshot", () => {
  it("bootstraps missing KpiConfig rows on first run", async () => {
    p.kpiConfig.findMany.mockResolvedValue([]);
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    expect(p.kpiConfig.create).toHaveBeenCalledTimes(RUBRIC.length);
  });

  it("skips seeding once every metric already has a KpiConfig row", async () => {
    p.kpiConfig.findMany.mockResolvedValue(
      RUBRIC.map((r) => ({ metricKey: r.metricKey, effectiveDate: new Date("2026-01-01") }))
    );
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    expect(p.kpiConfig.create).not.toHaveBeenCalled();
  });

  it("scores a recruiter with zero activity as band 'New' with a zero overall score", async () => {
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const data = p.recruiterScoreSnapshot.upsert.mock.calls[0][0];
    expect(data.create.overallScore).toBe(0);
    expect(data.create.bandLabel).toBe("New");
  });

  it("computes a non-zero overall score once real outreach activity exists", async () => {
    p.interactionEvent.count.mockResolvedValue(420); // outreachVolume, then repliedInteractions reuses same mock
    p.lead.count.mockResolvedValue(34); // proactiveSourcing
    p.lead.findMany.mockResolvedValue([
      { id: "lead-1", assignedAt: new Date("2026-06-01"), claimedAt: null, createdAt: new Date("2026-06-01"), stage: "CONTACTED", targetLanguage: "German", services: ["Subtitling"] },
    ]);

    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));

    const data = p.recruiterScoreSnapshot.upsert.mock.calls[0][0];
    expect(data.create.overallScore).toBeGreaterThan(0);
    expect(data.create.bandLabel).not.toBe("New");
  });

  it("marks isNew true only when there is no previous snapshot for this recruiter", async () => {
    p.recruiterScoreSnapshot.findFirst.mockResolvedValue({ overallScore: 72 });
    p.interactionEvent.count.mockResolvedValue(10);
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const data = p.recruiterScoreSnapshot.upsert.mock.calls[0][0];
    expect(data.create.isNew).toBe(false);
    expect(data.create.previousScore).toBe(72);
  });

  it("scales outreach_volume/proactive_sourcing/cold_lead_conversion targets by assigned headcount when demand exists", async () => {
    p.requirement.findMany.mockResolvedValue([{ headcountNeeded: 5 }, { headcountNeeded: 3 }]);
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));

    const kpiSnapshot = p.recruiterScoreSnapshot.upsert.mock.calls[0][0].create.kpiConfigSnapshot;
    const outreach = kpiSnapshot.find((k: any) => k.metricKey === "outreach_volume");
    const sourcing = kpiSnapshot.find((k: any) => k.metricKey === "proactive_sourcing");
    const coldConv = kpiSnapshot.find((k: any) => k.metricKey === "cold_lead_conversion");

    expect(outreach.target).toBe(Math.round(8 * 42));
    expect(sourcing.target).toBe(Math.round(8 * 3.4));
    expect(coldConv.target).toBe(Math.round(8 * 1.8));
  });

  it("leaves targets at their static RUBRIC defaults when the recruiter has no assigned demand", async () => {
    p.requirement.findMany.mockResolvedValue([]);
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const kpiSnapshot = p.recruiterScoreSnapshot.upsert.mock.calls[0][0].create.kpiConfigSnapshot;
    const outreach = kpiSnapshot.find((k: any) => k.metricKey === "outreach_volume");
    expect(outreach.target).toBe(420);
  });

  it("prefers a versioned KpiConfig override from the DB over the static RUBRIC default", async () => {
    p.kpiConfig.findMany.mockResolvedValue([
      { metricKey: "outreach_volume", target: 999, goodBand: 999, weight: 50, scored: true, direction: "HIGHER_IS_BETTER", effectiveDate: new Date("2026-01-01") },
    ]);
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const kpiSnapshot = p.recruiterScoreSnapshot.upsert.mock.calls[0][0].create.kpiConfigSnapshot;
    const outreach = kpiSnapshot.find((k: any) => k.metricKey === "outreach_volume");
    expect(outreach.target).toBe(999);
    expect(outreach.weight).toBe(50);
  });

  it("reason_logged_rate falls back to 100 when there were no closures to log a reason for but the recruiter was otherwise active", async () => {
    p.interactionEvent.count.mockResolvedValue(5);
    p.lead.findMany.mockResolvedValue([
      { id: "lead-1", assignedAt: new Date("2026-06-01"), claimedAt: null, createdAt: new Date("2026-06-01"), stage: "CONTACTED", targetLanguage: "German", services: ["Subtitling"] },
    ]);
    p.interactionEvent.findMany.mockResolvedValue([{ leadId: "lead-1", occurredAt: new Date("2026-06-02") }]);
    p.stageHistory.findMany.mockResolvedValue([]);
    p.leadFlagEvent.findMany.mockResolvedValue([]);

    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));

    const metricUpsertCalls = p.recruiterMetricSnapshot.upsert.mock.calls;
    const reasonMetric = metricUpsertCalls.find((c: any) => c[0].create.metricKey === "reason_logged_rate");
    expect(reasonMetric[0].create.currentValue).toBe(100);
  });

  it("reason_logged_rate is 0 with no closures and no touched leads at all", async () => {
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const metricUpsertCalls = p.recruiterMetricSnapshot.upsert.mock.calls;
    const reasonMetric = metricUpsertCalls.find((c: any) => c[0].create.metricKey === "reason_logged_rate");
    expect(reasonMetric[0].create.currentValue).toBe(0);
  });

  it("classifies each metric's status by its normalized score (STRONG/SOLID/NEEDS_ATTENTION)", async () => {
    p.interactionEvent.count.mockResolvedValue(420);
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const outreachMetric = p.recruiterMetricSnapshot.upsert.mock.calls.find(
      (c: any) => c[0].create.metricKey === "outreach_volume"
    );
    expect(outreachMetric[0].create.normalized).toBe(100);
    expect(outreachMetric[0].create.metricStatus).toBe("STRONG");
  });

  it("writes the recruiterKpiSummary roster cache with 0 rates when there's no outbound activity", async () => {
    await computeRecruiterScoreSnapshot("rec-1", new Date("2026-06-15"));
    const summary = p.recruiterKpiSummary.upsert.mock.calls[0][0].create;
    expect(summary.outreachEffectiveness).toBe(0);
    expect(summary.responseRate).toBe(0);
  });
});

describe("runMonthlyScoring", () => {
  it("does nothing when there are no active recruiters", async () => {
    p.user.findMany.mockResolvedValue([]);
    await runMonthlyScoring(new Date("2026-06-15"));
    expect(p.recruiterScoreSnapshot.upsert).not.toHaveBeenCalled();
  });

  it("scores every active recruiter and continues past an individual failure", async () => {
    p.user.findMany.mockResolvedValue([{ id: "good-1" }, { id: "bad-1" }, { id: "good-2" }]);
    p.interactionEvent.count.mockImplementation(({ where }: any) => {
      if (where.recruiterId === "bad-1" && where.direction === "OUTBOUND") {
        return Promise.reject(new Error("db exploded"));
      }
      return Promise.resolve(0);
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runMonthlyScoring(new Date("2026-06-15"));

    expect(p.recruiterScoreSnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("bad-1"), expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("only queries active recruiters", async () => {
    await runMonthlyScoring(new Date("2026-06-15"));
    expect(p.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "RECRUITER", isActive: true } })
    );
  });
});
