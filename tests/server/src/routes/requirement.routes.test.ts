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

// POST / uses a callback-style transaction against `tx`; POST /:id/assign
// builds its updates as an array of already-invoked prisma calls -- support
// both shapes with one $transaction mock.
const mockTx = {
  requirement: { create: vi.fn() },
  requirementAssignment: { create: vi.fn() },
};

vi.mock("@server-root/prisma", () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    requirement: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    requirementAssignment: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(mockTx))),
  },
}));

import { prisma } from "@server-root/prisma";
import { requirementRouter } from "@server/routes/requirement.routes";

const mockClientFindUnique = prisma.client.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockReqFindMany = prisma.requirement.findMany as unknown as ReturnType<typeof vi.fn>;
const mockReqFindUnique = prisma.requirement.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockReqUpdate = prisma.requirement.update as unknown as ReturnType<typeof vi.fn>;
const mockReqDelete = prisma.requirement.delete as unknown as ReturnType<typeof vi.fn>;
const mockAssignmentFindMany = prisma.requirementAssignment.findMany as unknown as ReturnType<typeof vi.fn>;
const mockAssignmentCreate = prisma.requirementAssignment.create as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/requirements", requirementRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const validItem = {
  title: "Senior Dubbing Artist",
  language: "German",
  service: "Dubbing",
  headcountNeeded: 2,
  priority: "HIGH",
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
  mockTx.requirement.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `req-${data.title}`, ...data }));
  mockTx.requirementAssignment.create.mockResolvedValue({ id: "assign-1" });
});

describe("GET /api/requirements", () => {
  it("lists requirements on the happy path", async () => {
    mockReqFindMany.mockResolvedValue([{ id: "r1" }]);
    const res = await request(buildApp()).get("/api/requirements");
    expect(res.status).toBe(200);
    expect(res.body.requirements).toEqual([{ id: "r1" }]);
    expect(mockReqFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("builds a filtered where clause from query params", async () => {
    mockReqFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/requirements?clientId=c1&status=ACTIVE&priority=HIGH&q=dub");
    const callArg = mockReqFindMany.mock.calls[0][0];
    expect(callArg.where.clientId).toBe("c1");
    expect(callArg.where.status).toBe("ACTIVE");
    expect(callArg.where.priority).toBe("HIGH");
    expect(callArg.where.OR).toHaveLength(3);
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/requirements");
    expect(res.status).toBe(403);
    expect(mockReqFindMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/requirements", () => {
  it("404s when the client doesn't exist", async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/requirements").send({ clientId: "11111111-1111-4111-8111-111111111111", items: [validItem] });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CLIENT_NOT_FOUND");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates one requirement per item, ACTIVE + assignment when recruiterId given, UNASSIGNED otherwise", async () => {
    mockClientFindUnique.mockResolvedValue({ id: "client-1", name: "Acme" });
    const items = [
      { ...validItem, title: "Item A", recruiterId: "22222222-2222-4222-8222-222222222222" },
      { ...validItem, title: "Item B" },
    ];

    const res = await request(buildApp()).post("/api/requirements").send({ clientId: "11111111-1111-4111-8111-111111111111", items });

    expect(res.status).toBe(201);
    expect(mockTx.requirement.create).toHaveBeenCalledTimes(2);
    expect(mockTx.requirement.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE", gap: 2 }) }));
    expect(mockTx.requirement.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ status: "UNASSIGNED" }) }));
    expect(mockTx.requirementAssignment.create).toHaveBeenCalledTimes(1);
    expect(mockTx.requirementAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recruiterId: "22222222-2222-4222-8222-222222222222", assignedById: "owner-1" }) })
    );
    expect(res.body.requirements).toHaveLength(2);
  });

  it("400s when items is an empty array", async () => {
    const res = await request(buildApp()).post("/api/requirements").send({ clientId: "11111111-1111-4111-8111-111111111111", items: [] });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("400s on an invalid priority enum value", async () => {
    const res = await request(buildApp())
      .post("/api/requirements")
      .send({ clientId: "11111111-1111-4111-8111-111111111111", items: [{ ...validItem, priority: "URGENT" }] });
    expect(res.status).toBe(400);
  });

  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).post("/api/requirements").send({ clientId: "11111111-1111-4111-8111-111111111111", items: [validItem] });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/requirements/:id", () => {
  it("returns requirement detail on the happy path", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", title: "X" });
    const res = await request(buildApp()).get("/api/requirements/r1");
    expect(res.status).toBe(200);
    expect(res.body.requirement).toEqual({ id: "r1", title: "X" });
  });

  it("404s when not found", async () => {
    mockReqFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/requirements/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("REQUIREMENT_NOT_FOUND");
  });
});

describe("GET /api/requirements/:id/history", () => {
  it("returns the assignment audit trail", async () => {
    mockAssignmentFindMany.mockResolvedValue([{ id: "a1" }]);
    const res = await request(buildApp()).get("/api/requirements/r1/history");
    expect(res.status).toBe(200);
    expect(res.body.assignments).toEqual([{ id: "a1" }]);
  });
});

describe("PATCH /api/requirements/:id", () => {
  it("404s when the requirement doesn't exist", async () => {
    mockReqFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/requirements/nope").send({ notes: "x" });
    expect(res.status).toBe(404);
    expect(mockReqUpdate).not.toHaveBeenCalled();
  });

  it("recomputes gap from filled count when headcountNeeded changes", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", headcountNeeded: 3, filled: 1 });
    mockReqUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "r1", ...data }));

    const res = await request(buildApp()).patch("/api/requirements/r1").send({ headcountNeeded: 5 });

    expect(res.status).toBe(200);
    expect(mockReqUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ headcountNeeded: 5, gap: 4 }) })
    );
  });

  it("clamps gap at 0 rather than going negative", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", headcountNeeded: 5, filled: 4 });
    mockReqUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "r1", ...data }));

    await request(buildApp()).patch("/api/requirements/r1").send({ headcountNeeded: 2 });

    expect(mockReqUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ gap: 0 }) }));
  });

  it("leaves headcountNeeded/gap untouched when not included in the patch", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", headcountNeeded: 3, filled: 1 });
    mockReqUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "r1", ...data }));

    await request(buildApp()).patch("/api/requirements/r1").send({ notes: "just a note" });

    const callArg = mockReqUpdate.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty("headcountNeeded");
    expect(callArg.data).not.toHaveProperty("gap");
    expect(callArg.data.notes).toBe("just a note");
  });

  it("allows explicitly clearing a nullable field like region", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", headcountNeeded: 3, filled: 1 });
    mockReqUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "r1", ...data }));

    await request(buildApp()).patch("/api/requirements/r1").send({ region: null });

    expect(mockReqUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ region: null }) }));
  });

  it("applies title/language/service/priority/status patch fields when all are provided", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", headcountNeeded: 3, filled: 1 });
    mockReqUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "r1", ...data }));

    await request(buildApp())
      .patch("/api/requirements/r1")
      .send({ title: "New Title", language: "French", service: "Subtitling", priority: "CRITICAL", status: "PAUSED" });

    expect(mockReqUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "New Title",
          language: "French",
          service: "Subtitling",
          priority: "CRITICAL",
          status: "PAUSED",
        }),
      })
    );
  });

  it("400s on an invalid status enum value", async () => {
    const res = await request(buildApp()).patch("/api/requirements/r1").send({ status: "DONE" });
    expect(res.status).toBe(400);
    expect(mockReqFindUnique).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/requirements/:id", () => {
  it("deletes on the happy path (owner only)", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1" });
    mockReqDelete.mockResolvedValue({ id: "r1" });
    const res = await request(buildApp()).delete("/api/requirements/r1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("404s when the requirement doesn't exist", async () => {
    mockReqFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).delete("/api/requirements/nope");
    expect(res.status).toBe(404);
    expect(mockReqDelete).not.toHaveBeenCalled();
  });

  it("403s a recruiter (owner-only route)", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    const res = await request(buildApp()).delete("/api/requirements/r1");
    expect(res.status).toBe(403);
    expect(mockReqFindUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/requirements/:id/assign", () => {
  it("404s when the requirement doesn't exist", async () => {
    mockReqFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/requirements/nope/assign").send({ recruiterId: "22222222-2222-4222-8222-222222222222" });
    expect(res.status).toBe(404);
  });

  it("moves an UNASSIGNED requirement to ACTIVE when assigning a recruiter", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", status: "UNASSIGNED" });
    mockReqUpdate.mockResolvedValue({ id: "r1", status: "ACTIVE", recruiterId: "22222222-2222-4222-8222-222222222222" });

    const res = await request(buildApp()).post("/api/requirements/r1/assign").send({ recruiterId: "22222222-2222-4222-8222-222222222222", note: "reassigned" });

    expect(res.status).toBe(200);
    expect(mockReqUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { recruiterId: "22222222-2222-4222-8222-222222222222", status: "ACTIVE" } });
    expect(mockAssignmentCreate).toHaveBeenCalledWith({
      data: { requirementId: "r1", recruiterId: "22222222-2222-4222-8222-222222222222", assignedById: "owner-1", note: "reassigned" },
    });
    expect(res.body.requirement.status).toBe("ACTIVE");
  });

  it("keeps a non-UNASSIGNED status as-is when reassigning to a different recruiter", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", status: "PAUSED" });
    mockReqUpdate.mockResolvedValue({ id: "r1", status: "PAUSED" });

    await request(buildApp()).post("/api/requirements/r1/assign").send({ recruiterId: "22222222-2222-4222-8222-222222222222" });

    expect(mockReqUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { recruiterId: "22222222-2222-4222-8222-222222222222", status: "PAUSED" } });
  });

  it("sets status back to UNASSIGNED when unassigning (recruiterId: null)", async () => {
    mockReqFindUnique.mockResolvedValue({ id: "r1", status: "ACTIVE" });
    mockReqUpdate.mockResolvedValue({ id: "r1", status: "UNASSIGNED", recruiterId: null });

    const res = await request(buildApp()).post("/api/requirements/r1/assign").send({ recruiterId: null });

    expect(res.status).toBe(200);
    expect(mockReqUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { recruiterId: null, status: "UNASSIGNED" } });
    expect(mockAssignmentCreate).toHaveBeenCalledWith({
      data: { requirementId: "r1", recruiterId: null, assignedById: "owner-1", note: null },
    });
  });

  it("400s when recruiterId is present but not a UUID", async () => {
    const res = await request(buildApp()).post("/api/requirements/r1/assign").send({ recruiterId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mockReqFindUnique).not.toHaveBeenCalled();
  });
});
