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

// $transaction just invokes the callback with a mock `tx` exposing the same
// three models the route touches -- lets tests assert exactly what was
// created inside the transaction without a real database.
const mockTx = {
  client: { findFirst: vi.fn(), create: vi.fn() },
  clientDemand: { create: vi.fn() },
  requirement: { create: vi.fn() },
};

vi.mock("@server-root/prisma", () => ({
  prisma: {
    clientDemand: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn((cb: any) => cb(mockTx)),
  },
}));

import { prisma } from "@server-root/prisma";
import { clientDemandRouter } from "@server/routes/client-demand.routes";

const mockFindMany = prisma.clientDemand.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.clientDemand.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.clientDemand.update as unknown as ReturnType<typeof vi.fn>;
const mockDelete = prisma.clientDemand.delete as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/client-demands", clientDemandRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const validBody = {
  clientName: "Acme Studios",
  language: "German",
  services: [
    { service: "Dubbing", needed: 2 },
    { service: "Subtitling", needed: 1 },
  ],
  priority: "HIGH",
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
  mockTx.client.findFirst.mockResolvedValue(null);
  mockTx.client.create.mockResolvedValue({ id: "client-1", name: "Acme Studios" });
  mockTx.clientDemand.create.mockResolvedValue({ id: "demand-1", clientId: "client-1", serviceBreakdown: [] });
  mockTx.requirement.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `req-${data.service}`, ...data }));
});

describe("GET /api/client-demands", () => {
  it("lists demands on the happy path", async () => {
    mockFindMany.mockResolvedValue([{ id: "d1" }]);
    const res = await request(buildApp()).get("/api/client-demands");
    expect(res.status).toBe(200);
    expect(res.body.clientDemands).toEqual([{ id: "d1" }]);
  });

  it("allows a contractor to read (read-only aggregate view)", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    mockFindMany.mockResolvedValue([]);
    const res = await request(buildApp()).get("/api/client-demands");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/client-demands", () => {
  it("creates one ClientDemand AND one Requirement per service, in a transaction", async () => {
    const res = await request(buildApp()).post("/api/client-demands").send(validBody);

    expect(res.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.requirement.create).toHaveBeenCalledTimes(2); // one per service -- the two-model-divergence fix
    expect(res.body.requirements).toHaveLength(2);
  });

  it("computes headcountNeeded as the sum of every service's needed count", async () => {
    await request(buildApp()).post("/api/client-demands").send(validBody);
    expect(mockTx.clientDemand.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ headcountNeeded: 3, filled: 0, gap: 3 }) })
    );
  });

  it("finds-and-reuses an existing client by case-insensitive name instead of creating a duplicate", async () => {
    mockTx.client.findFirst.mockResolvedValue({ id: "existing-client", name: "Acme Studios" });

    await request(buildApp()).post("/api/client-demands").send({ ...validBody, clientName: "acme studios" });

    expect(mockTx.client.create).not.toHaveBeenCalled();
    expect(mockTx.clientDemand.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: "existing-client" }) })
    );
  });

  it("accepts a plain YYYY-MM-DD deadline (what a real <input type=date> sends), not just a full ISO timestamp", async () => {
    const res = await request(buildApp()).post("/api/client-demands").send({ ...validBody, deadline: "2026-12-01" });
    expect(res.status).toBe(201);
  });

  it("rejects with 400 for a genuinely invalid deadline string", async () => {
    const res = await request(buildApp()).post("/api/client-demands").send({ ...validBody, deadline: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("rejects with 400 when services array is empty", async () => {
    const res = await request(buildApp()).post("/api/client-demands").send({ ...validBody, services: [] });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects with 400 for an invalid priority enum value", async () => {
    const res = await request(buildApp()).post("/api/client-demands").send({ ...validBody, priority: "URGENT" });
    expect(res.status).toBe(400);
  });

  it("403s a contractor attempting to create a demand", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).post("/api/client-demands").send(validBody);
    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("GET /api/client-demands/:id", () => {
  it("404s when the demand doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/client-demands/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("DEMAND_NOT_FOUND");
  });
});

describe("PATCH /api/client-demands/:id", () => {
  it("recomputes gap when headcountNeeded is raised", async () => {
    mockFindUnique.mockResolvedValue({ id: "d1", headcountNeeded: 3, filled: 1 });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "d1", ...data }));

    const res = await request(buildApp()).patch("/api/client-demands/d1").send({ headcountNeeded: 5 });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ headcountNeeded: 5, gap: 4 }) }) // 5 - 1 filled
    );
  });

  it("clamps gap at 0 rather than going negative when headcount drops below filled count", async () => {
    mockFindUnique.mockResolvedValue({ id: "d1", headcountNeeded: 5, filled: 4 });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "d1", ...data }));

    await request(buildApp()).patch("/api/client-demands/d1").send({ headcountNeeded: 2 }); // 2 - 4 filled = -2

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gap: 0 }) })
    );
  });

  it("leaves headcountNeeded/gap untouched when the patch doesn't include headcountNeeded", async () => {
    mockFindUnique.mockResolvedValue({ id: "d1", headcountNeeded: 3, filled: 1 });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "d1", ...data }));

    await request(buildApp()).patch("/api/client-demands/d1").send({ notes: "just a note" });

    const callArg = mockUpdate.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty("headcountNeeded");
    expect(callArg.data).not.toHaveProperty("gap");
    expect(callArg.data.notes).toBe("just a note");
  });

  it("404s patching a demand that doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/client-demands/nope").send({ notes: "x" });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/client-demands/:id", () => {
  it("deletes on the happy path (owner only)", async () => {
    mockFindUnique.mockResolvedValue({ id: "d1" });
    mockDelete.mockResolvedValue({ id: "d1" });
    const res = await request(buildApp()).delete("/api/client-demands/d1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("403s a recruiter (owner-only route)", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    const res = await request(buildApp()).delete("/api/client-demands/d1");
    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
