import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "@server/middleware/errorHandler";

const { getTestUser, setTestUser } = vi.hoisted(() => {
  let user = { id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" };
  return { getTestUser: () => user, setTestUser: (u: typeof user) => (user = u) };
});

vi.mock("@server/middleware/auth", () => ({
  authenticateJwt: (req: any, _res: any, next: any) => {
    req.user = getTestUser();
    next();
  },
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    kpiConfig: { findMany: vi.fn(), create: vi.fn() },
    recruiterScoreSnapshot: { findFirst: vi.fn(), findUnique: vi.fn() },
    recruiterKpiSummary: { findUnique: vi.fn() },
  },
}));

vi.mock("@server/jobs/scoring.job", () => ({
  computeRecruiterScoreSnapshot: vi.fn(),
}));

import { prisma } from "@server-root/prisma";
import { computeRecruiterScoreSnapshot } from "@server/jobs/scoring.job";
import { evaluationRouter } from "@server/routes/evaluation.routes";

const mockFindMany = prisma.kpiConfig.findMany as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.kpiConfig.create as unknown as ReturnType<typeof vi.fn>;
const mockScoreFindFirst = prisma.recruiterScoreSnapshot.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockScoreFindUnique = prisma.recruiterScoreSnapshot.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockSummaryFindUnique = prisma.recruiterKpiSummary.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockCompute = computeRecruiterScoreSnapshot as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", evaluationRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
});

describe("GET /api/kpi-config", () => {
  it("collapses rows to the latest effectiveDate per metricKey", async () => {
    mockFindMany.mockResolvedValue([
      { metricKey: "a", effectiveDate: new Date("2026-02-01"), weight: 2 },
      { metricKey: "a", effectiveDate: new Date("2026-01-01"), weight: 1 },
      { metricKey: "b", effectiveDate: new Date("2026-01-15"), weight: 5 },
    ]);

    const res = await request(buildApp()).get("/api/kpi-config");

    expect(res.status).toBe(200);
    expect(res.body.kpiConfig).toHaveLength(2);
    expect(res.body.kpiConfig.find((r: any) => r.metricKey === "a").weight).toBe(2);
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/kpi-config");
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/kpi-config/:metricKey", () => {
  it("404s when no existing row for metricKey", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await request(buildApp()).patch("/api/kpi-config/nope").send({ weight: 3 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("METRIC_NOT_FOUND");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a new versioned row merging patch fields on top of the current row", async () => {
    mockFindMany.mockResolvedValue([
      { metricKey: "outreach_volume", group: "ACTIVITY_AND_EFFORT", label: "Outreach", unit: "COUNT", weight: 10, target: 5, goodBand: 3, direction: "HIGHER_IS_BETTER", scored: true, notes: "old" },
    ]);
    mockCreate.mockResolvedValue({ id: "kc-2", metricKey: "outreach_volume", weight: 20 });

    const res = await request(buildApp()).patch("/api/kpi-config/outreach_volume").send({ weight: 20 });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metricKey: "outreach_volume",
          weight: 20,
          label: "Outreach",
          direction: "HIGHER_IS_BETTER",
          scored: true,
          notes: "old",
        }),
      })
    );
    expect(res.body.kpiConfig).toEqual({ id: "kc-2", metricKey: "outreach_volume", weight: 20 });
  });

  it("falls through to undefined when neither the patch nor the base row has weight/target/goodBand/notes", async () => {
    mockFindMany.mockResolvedValue([
      { metricKey: "m", group: "ACTIVITY_AND_EFFORT", label: "M", unit: "COUNT", direction: "HIGHER_IS_BETTER", scored: true },
    ]);
    mockCreate.mockResolvedValue({ id: "kc-3" });

    await request(buildApp()).patch("/api/kpi-config/m").send({ scored: false });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ weight: undefined, target: undefined, goodBand: undefined, notes: undefined, scored: false }),
      })
    );
  });

  it("400s on an invalid direction enum value", async () => {
    const res = await request(buildApp()).patch("/api/kpi-config/x").send({ direction: "SIDEWAYS" });
    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("403s a recruiter (owner-only route)", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    const res = await request(buildApp()).patch("/api/kpi-config/x").send({ weight: 1 });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/recruiters/:id/score", () => {
  it("returns the existing snapshot split from its metricSnapshots", async () => {
    mockScoreFindFirst.mockResolvedValue({
      id: "snap-1",
      recruiterId: "rec-1",
      period: new Date("2026-08-01"),
      metricSnapshots: [{ id: "ms-1", metricKey: "a" }],
    });

    const res = await request(buildApp()).get("/api/recruiters/rec-1/score");

    expect(res.status).toBe(200);
    expect(res.body.snapshot).toEqual({ id: "snap-1", recruiterId: "rec-1", period: "2026-08-01T00:00:00.000Z" });
    expect(res.body.metricSnapshots).toEqual([{ id: "ms-1", metricKey: "a" }]);
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it("auto-computes and re-fetches when no snapshot exists yet", async () => {
    mockScoreFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "snap-2", recruiterId: "rec-1", metricSnapshots: [] });
    mockCompute.mockResolvedValue({ id: "snap-2" });

    const res = await request(buildApp()).get("/api/recruiters/rec-1/score");

    expect(mockCompute).toHaveBeenCalledWith("rec-1", expect.any(Date));
    expect(res.status).toBe(200);
    expect(res.body.snapshot.id).toBe("snap-2");
  });

  it("returns null snapshot when auto-compute fails and still nothing exists", async () => {
    mockScoreFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockCompute.mockRejectedValue(new Error("compute blew up"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await request(buildApp()).get("/api/recruiters/rec-1/score");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshot: null, metricSnapshots: [] });
    consoleSpy.mockRestore();
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/recruiters/rec-1/score");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/recruiters/:id/recompute-score", () => {
  it("recomputes and returns the full snapshot with metricSnapshots", async () => {
    mockCompute.mockResolvedValue({ id: "snap-3" });
    mockScoreFindUnique.mockResolvedValue({ id: "snap-3", metricSnapshots: [{ id: "ms-1" }] });

    const res = await request(buildApp()).post("/api/recruiters/rec-1/recompute-score");

    expect(mockCompute).toHaveBeenCalledWith("rec-1", expect.any(Date));
    expect(mockScoreFindUnique).toHaveBeenCalledWith({ where: { id: "snap-3" }, include: { metricSnapshots: true } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, snapshot: { id: "snap-3", metricSnapshots: [{ id: "ms-1" }] } });
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).post("/api/recruiters/rec-1/recompute-score");
    expect(res.status).toBe(403);
    expect(mockCompute).not.toHaveBeenCalled();
  });
});

describe("GET /api/recruiters/:id/kpi-summary", () => {
  it("returns the cached summary when it exists", async () => {
    mockSummaryFindUnique.mockResolvedValue({ recruiterId: "rec-1", overallScore: 88 });
    const res = await request(buildApp()).get("/api/recruiters/rec-1/kpi-summary");
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ recruiterId: "rec-1", overallScore: 88 });
  });

  it("returns null (not 404) when no summary exists yet", async () => {
    mockSummaryFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/recruiters/rec-1/kpi-summary");
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeNull();
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/recruiters/rec-1/kpi-summary");
    expect(res.status).toBe(403);
  });
});
