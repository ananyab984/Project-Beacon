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
    interactionEvent: { count: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    recruiterScoreSnapshot: { findMany: vi.fn() },
    clientDemand: { findMany: vi.fn() },
    emailQueueItem: { count: vi.fn() },
    stageHistory: { findMany: vi.fn() },
    lead: { count: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { reportsRouter } from "@server/routes/reports.routes";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", reportsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const mocks = {
  interactionCount: prisma.interactionEvent.count as unknown as ReturnType<typeof vi.fn>,
  interactionFindMany: prisma.interactionEvent.findMany as unknown as ReturnType<typeof vi.fn>,
  userFindMany: prisma.user.findMany as unknown as ReturnType<typeof vi.fn>,
  snapshotFindMany: prisma.recruiterScoreSnapshot.findMany as unknown as ReturnType<typeof vi.fn>,
  demandFindMany: prisma.clientDemand.findMany as unknown as ReturnType<typeof vi.fn>,
  emailCount: prisma.emailQueueItem.count as unknown as ReturnType<typeof vi.fn>,
  stageFindMany: prisma.stageHistory.findMany as unknown as ReturnType<typeof vi.fn>,
  leadCount: prisma.lead.count as unknown as ReturnType<typeof vi.fn>,
  leadFindMany: prisma.lead.findMany as unknown as ReturnType<typeof vi.fn>,
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
  mocks.interactionCount.mockResolvedValue(0);
  mocks.interactionFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.snapshotFindMany.mockResolvedValue([]);
  mocks.demandFindMany.mockResolvedValue([]);
  mocks.emailCount.mockResolvedValue(0);
  mocks.stageFindMany.mockResolvedValue([]);
  mocks.leadCount.mockResolvedValue(0);
  mocks.leadFindMany.mockResolvedValue([]);
});

describe("GET /api/reports/analytics", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/reports/analytics");
    expect(res.status).toBe(403);
  });

  it("computes the full summary shape on the happy path", async () => {
    mocks.interactionCount.mockResolvedValue(12);
    mocks.userFindMany.mockResolvedValue([
      { id: "r1", name: "Rita", email: "rita@x.com" },
      { id: "r2", name: "Ravi", email: "ravi@x.com" },
    ]);
    mocks.snapshotFindMany.mockResolvedValue([
      { recruiterId: "r1", overallScore: 90, period: "2026-08" },
      { recruiterId: "r2", overallScore: 60, period: "2026-08" },
    ]);
    mocks.demandFindMany.mockResolvedValue([
      { headcountNeeded: 10, filled: 4, gap: 6, language: "Spanish", serviceBreakdown: [], client: { name: "Acme" } },
      { headcountNeeded: 5, filled: 5, gap: 0, language: "French", serviceBreakdown: [], client: { name: "Acme" } },
    ]);
    mocks.emailCount.mockResolvedValue(20);
    mocks.stageFindMany.mockResolvedValue([
      { changedByRecruiterId: "r1" },
      { changedByRecruiterId: "r1" },
      { changedByRecruiterId: "r2" },
    ]);

    const res = await request(buildApp()).get("/api/reports/analytics?range=7d");

    expect(res.status).toBe(200);
    expect(res.body.range).toBe("7d");
    expect(res.body.summary).toEqual({
      outreachVolume: 12,
      activeRecruitersCount: 2,
      teamAvgScore: 75, // avg(90,60) = 75
      totalDemand: 15,
      totalFilled: 9,
      fillRate: 60, // 9/15
      aiDraftsCount: 20,
      savedHours: 3, // round(20*9/60)
    });
    expect(res.body.languageBreakdown).toEqual([
      { language: "Spanish", needed: 10, filled: 4, gap: 6 },
      { language: "French", needed: 5, filled: 5, gap: 0 },
    ]);
    expect(res.body.recruiterThroughput).toEqual([
      { id: "r1", name: "Rita", leadsOnboarded: 2, score: 90 },
      { id: "r2", name: "Ravi", leadsOnboarded: 1, score: 60 },
    ]);
  });

  it("defaults teamAvgScore to 75 when there are no snapshots", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "r1", name: "Rita", email: "rita@x.com" }]);
    const res = await request(buildApp()).get("/api/reports/analytics");
    expect(res.body.summary.teamAvgScore).toBe(75);
    expect(res.body.recruiterThroughput[0].score).toBe(75);
  });

  it("defaults fillRate to 0 when there is no demand", async () => {
    const res = await request(buildApp()).get("/api/reports/analytics");
    expect(res.body.summary.fillRate).toBe(0);
    expect(res.body.summary.totalDemand).toBe(0);
  });

  it("handles a Decimal-like overallScore via toNumber()", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "r1", name: "Rita", email: "rita@x.com" }]);
    mocks.snapshotFindMany.mockResolvedValue([
      { recruiterId: "r1", overallScore: { toNumber: () => 88 }, period: "2026-08" },
    ]);
    const res = await request(buildApp()).get("/api/reports/analytics");
    expect(res.body.summary.teamAvgScore).toBe(88);
  });

  it("only keeps the latest (first, since ordered desc) snapshot per recruiter", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "r1", name: "Rita", email: "rita@x.com" }]);
    mocks.snapshotFindMany.mockResolvedValue([
      { recruiterId: "r1", overallScore: 95, period: "2026-08" },
      { recruiterId: "r1", overallScore: 10, period: "2026-07" },
    ]);
    const res = await request(buildApp()).get("/api/reports/analytics");
    expect(res.body.summary.teamAvgScore).toBe(95);
  });

  it.each(["7d", "30d", "90d", "ytd", "1y", "bogus"])("accepts range=%s without error", async (range) => {
    const res = await request(buildApp()).get(`/api/reports/analytics?range=${range}`);
    expect(res.status).toBe(200);
  });

  it("defaults range to 30d when omitted", async () => {
    const res = await request(buildApp()).get("/api/reports/analytics");
    expect(res.body.range).toBe("30d");
  });
});

describe("GET /api/reports/outreach-funnel", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/reports/outreach-funnel");
    expect(res.status).toBe(403);
  });

  it("scopes to the recruiter's own leads/interactions when not an owner", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    mocks.interactionFindMany.mockResolvedValue([]);
    mocks.leadCount.mockResolvedValue(0);

    await request(buildApp()).get("/api/reports/outreach-funnel");

    const outboundCall = mocks.interactionFindMany.mock.calls[0][0];
    expect(outboundCall.where.recruiterId).toBe("r-1");
    const negotiatingCall = mocks.leadCount.mock.calls[0][0];
    expect(negotiatingCall.where.OR).toEqual([
      { assignedRecruiterId: "r-1" },
      { claimedByRecruiterId: "r-1" },
      { createdByRecruiterId: "r-1" },
    ]);
  });

  it("does not scope to a recruiter for an owner", async () => {
    await request(buildApp()).get("/api/reports/outreach-funnel");
    const outboundCall = mocks.interactionFindMany.mock.calls[0][0];
    expect(outboundCall.where.recruiterId).toBeUndefined();
    const negotiatingCall = mocks.leadCount.mock.calls[0][0];
    expect(negotiatingCall.where.OR).toBeUndefined();
  });

  it("computes contacted/awaiting_reply/replied from distinct outbound vs inbound lead ids", async () => {
    mocks.interactionFindMany
      .mockResolvedValueOnce([{ leadId: "l1" }, { leadId: "l2" }, { leadId: "l3" }]) // outbound
      .mockResolvedValueOnce([{ leadId: "l1" }]); // inbound
    mocks.leadCount.mockResolvedValueOnce(4).mockResolvedValueOnce(2); // negotiating, dnc

    const res = await request(buildApp()).get("/api/reports/outreach-funnel");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      range: "30d",
      contacted: 3,
      awaiting_reply: 2,
      replied: 1,
      in_negotiation: 4,
      dnc: 2,
    });
  });
});

describe("GET /api/reports/data-health", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/reports/data-health");
    expect(res.status).toBe(403);
  });

  it("returns all zeroes when there are no leads", async () => {
    mocks.leadCount.mockResolvedValue(0);
    const res = await request(buildApp()).get("/api/reports/data-health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 0, enrichedPct: 0, verifiedEmailPct: 0, confirmedLanguagePairPct: 0, experienceDataPct: 0 });
  });

  it("computes percentages against the total lead count", async () => {
    mocks.leadCount
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(5) // enriched
      .mockResolvedValueOnce(8) // verifiedEmail
      .mockResolvedValueOnce(3) // confirmedLanguagePair
      .mockResolvedValueOnce(6); // experienceData

    const res = await request(buildApp()).get("/api/reports/data-health");

    expect(res.body).toEqual({
      total: 10,
      enrichedPct: 0.5,
      verifiedEmailPct: 0.8,
      confirmedLanguagePairPct: 0.3,
      experienceDataPct: 0.6,
    });
  });
});

describe("GET /api/reports/recent", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/reports/recent");
    expect(res.status).toBe(403);
  });

  it("lists the four fixed audit report entries", async () => {
    const res = await request(buildApp()).get("/api/reports/recent");
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(4);
    expect(res.body.reports.map((r: any) => r.id)).toEqual([
      "rep-monthly-recruiter-scorecard",
      "rep-market-demand-gap",
      "rep-outreach-activity-log",
      "rep-lead-stage-progression",
    ]);
  });
});

describe("GET /api/reports/export/:type", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/reports/export/recruiters.csv");
    expect(res.status).toBe(403);
  });

  it("exports recruiters.csv with score/band fallbacks when there is no snapshot", async () => {
    mocks.userFindMany.mockResolvedValue([
      { id: "r1", name: "Rita", email: "rita@x.com", scoreSnapshots: [] },
    ]);
    const res = await request(buildApp()).get("/api/reports/export/recruiters.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("Recruiter Name,Email,Overall Score,Band Label,Summary,Snapshot Period");
    expect(res.text).toContain('"Rita","rita@x.com",N/A,"No data","","N/A"');
  });

  it("exports the scorecard alias identically and escapes quotes in the summary", async () => {
    mocks.userFindMany.mockResolvedValue([
      {
        id: "r1",
        name: "Rita",
        email: "rita@x.com",
        scoreSnapshots: [
          { overallScore: 91, bandLabel: "Top", summary: 'Great "work" ethic', period: new Date("2026-08-01") },
        ],
      },
    ]);
    const res = await request(buildApp()).get("/api/reports/export/scorecard");
    expect(res.status).toBe(200);
    expect(res.text).toContain('"Rita","rita@x.com",91,"Top","Great ""work"" ethic","2026-08"');
  });

  it("exports demands.csv with joined service breakdown", async () => {
    mocks.demandFindMany.mockResolvedValue([
      {
        client: { name: "Acme" },
        language: "German",
        serviceBreakdown: [{ service: "Dubbing", needed: 2 }, { service: "Subtitling", needed: 1 }],
        headcountNeeded: 3,
        filled: 1,
        gap: 2,
        priority: "HIGH",
        status: "OPEN",
        projectName: "Project X",
      },
    ]);
    const res = await request(buildApp()).get("/api/reports/export/demands.csv");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Dubbing (2); Subtitling (1)");
    expect(res.text).toContain('"Acme","German"');
  });

  it("supports the market-demand alias", async () => {
    mocks.demandFindMany.mockResolvedValue([]);
    const res = await request(buildApp()).get("/api/reports/export/market-demand");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Client,Language,Services,Headcount Needed,Filled,Gap,Priority,Status,Project Name");
  });

  it("exports leads.csv with name/assignment fallbacks", async () => {
    mocks.leadFindMany.mockResolvedValue([
      {
        displayName: null,
        fullName: null,
        maskedLabel: "L***",
        email: null,
        targetLanguage: null,
        sourceLanguage: "Spanish",
        stage: "NEW",
        services: null,
        yearsOfExperience: null,
        vendorExperience: null,
        assignedTo: null,
        enrichmentStatus: "PENDING",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const res = await request(buildApp()).get("/api/reports/export/leads.csv");
    expect(res.status).toBe(200);
    expect(res.text).toContain('"L***","","Spanish","NEW","","","","Unassigned","PENDING"');
  });

  it("supports the leads-pipeline alias and prefers assignedTo name", async () => {
    mocks.leadFindMany.mockResolvedValue([
      {
        displayName: "Jane",
        fullName: "Jane Doe",
        maskedLabel: "J.D.",
        email: "jane@x.com",
        targetLanguage: "French",
        sourceLanguage: "English",
        stage: "CONTACTED",
        services: ["Dubbing"],
        yearsOfExperience: 5,
        vendorExperience: "Yes",
        assignedTo: { name: "Rita" },
        enrichmentStatus: "COMPLETE",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const res = await request(buildApp()).get("/api/reports/export/leads-pipeline");
    expect(res.status).toBe(200);
    expect(res.text).toContain('"Jane","jane@x.com","French","CONTACTED","Dubbing","5","Yes","Rita","COMPLETE"');
  });

  it("falls back to the executive summary CSV for an unrecognized type", async () => {
    mocks.demandFindMany.mockResolvedValue([
      { headcountNeeded: 10, filled: 4, gap: 6 },
      { headcountNeeded: 5, filled: 5, gap: 0 },
    ]);
    const res = await request(buildApp()).get("/api/reports/export/unknown-type");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Category,Metric,Value");
    expect(res.text).toContain("Pipeline,Total Demand Headcount,15");
    expect(res.text).toContain("Pipeline,Total Placed Seats,9");
    expect(res.text).toContain("Pipeline,Unfilled Gap,6");
  });
});
