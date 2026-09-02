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
    escalation: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { escalationRouter } from "@server/routes/escalation.routes";

const mockFindMany = prisma.escalation.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.escalation.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.escalation.update as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/escalations", escalationRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
});

describe("GET /api/escalations", () => {
  it("returns all escalations for an owner", async () => {
    mockFindMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    const res = await request(buildApp()).get("/api/escalations");
    expect(res.status).toBe(200);
    expect(res.body.escalations).toHaveLength(2);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("scopes results to only the recruiter's own escalations", async () => {
    setTestUser({ id: "rec-1", email: "r@example.com", name: "R", role: "recruiter" });
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/escalations");
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recruiterId: "rec-1" } }));
  });

  it("orders P1 first then by createdAt desc", async () => {
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/escalations");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ priority: "asc" }, { createdAt: "desc" }] })
    );
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/escalations");
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/escalations/:id", () => {
  it("404s when the escalation doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/escalations/nope").send({ status: "ACKNOWLEDGED" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("ESCALATION_NOT_FOUND");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates status on the happy path (owner, any escalation)", async () => {
    mockFindUnique.mockResolvedValue({ id: "e1", recruiterId: "rec-1" });
    mockUpdate.mockResolvedValue({ id: "e1", status: "ACKNOWLEDGED" });

    const res = await request(buildApp()).patch("/api/escalations/e1").send({ status: "ACKNOWLEDGED" });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1" }, data: { status: "ACKNOWLEDGED" } })
    );
  });

  it("403s a recruiter updating an escalation that isn't theirs", async () => {
    setTestUser({ id: "rec-1", email: "r@example.com", name: "R", role: "recruiter" });
    mockFindUnique.mockResolvedValue({ id: "e1", recruiterId: "rec-2" });

    const res = await request(buildApp()).patch("/api/escalations/e1").send({ status: "ACKNOWLEDGED" });

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("allows a recruiter to update their own escalation", async () => {
    setTestUser({ id: "rec-1", email: "r@example.com", name: "R", role: "recruiter" });
    mockFindUnique.mockResolvedValue({ id: "e1", recruiterId: "rec-1" });
    mockUpdate.mockResolvedValue({ id: "e1", status: "IN_PROGRESS" });

    const res = await request(buildApp()).patch("/api/escalations/e1").send({ status: "IN_PROGRESS" });

    expect(res.status).toBe(200);
  });

  it("sets ownerUserId to the caller when assignToMe is true", async () => {
    mockFindUnique.mockResolvedValue({ id: "e1", recruiterId: "rec-1" });
    mockUpdate.mockResolvedValue({ id: "e1" });

    await request(buildApp()).patch("/api/escalations/e1").send({ assignToMe: true });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ownerUserId: "owner-1" } })
    );
  });

  it("combines status and assignToMe in a single update", async () => {
    mockFindUnique.mockResolvedValue({ id: "e1", recruiterId: "rec-1" });
    mockUpdate.mockResolvedValue({ id: "e1" });

    await request(buildApp()).patch("/api/escalations/e1").send({ status: "OPEN", assignToMe: true });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "OPEN", ownerUserId: "owner-1" } })
    );
  });

  it("sends an empty data patch when neither status nor assignToMe is given", async () => {
    mockFindUnique.mockResolvedValue({ id: "e1", recruiterId: "rec-1" });
    mockUpdate.mockResolvedValue({ id: "e1" });

    await request(buildApp()).patch("/api/escalations/e1").send({});

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
  });

  it("rejects with 400 for an invalid status enum value", async () => {
    const res = await request(buildApp()).patch("/api/escalations/e1").send({ status: "CLOSED" });
    expect(res.status).toBe(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).patch("/api/escalations/e1").send({ status: "OPEN" });
    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
