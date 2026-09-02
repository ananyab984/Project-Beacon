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
    client: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@server-root/prisma";
import { clientRouter } from "@server/routes/client.routes";

const mockFindMany = prisma.client.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.client.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.client.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.client.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.client.update as unknown as ReturnType<typeof vi.fn>;
const mockDelete = prisma.client.delete as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/clients", clientRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
});

describe("GET /api/clients", () => {
  it("lists clients on the happy path", async () => {
    mockFindMany.mockResolvedValue([{ id: "c1", name: "Acme" }]);
    const res = await request(buildApp()).get("/api/clients");
    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([{ id: "c1", name: "Acme" }]);
  });

  it("403s a contractor (not owner/recruiter)", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "Contractor", role: "contractor" });
    const res = await request(buildApp()).get("/api/clients");
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/clients/:id", () => {
  it("returns the client on the happy path", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", name: "Acme", demands: [], requirements: [] });
    const res = await request(buildApp()).get("/api/clients/c1");
    expect(res.status).toBe(200);
    expect(res.body.client.id).toBe("c1");
  });

  it("404s when the client doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/clients/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CLIENT_NOT_FOUND");
  });
});

describe("POST /api/clients", () => {
  it("creates a new client when no case-insensitive name match exists", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "c-new", name: "Acme Corp" });

    const res = await request(buildApp()).post("/api/clients").send({ name: "Acme Corp" });

    expect(res.status).toBe(201);
    expect(res.body.client.id).toBe("c-new");
    expect(mockCreate).toHaveBeenCalledWith({ data: { name: "Acme Corp" } });
  });

  it("finds-and-returns an existing client instead of creating a duplicate (case-insensitive)", async () => {
    mockFindFirst.mockResolvedValue({ id: "c-existing", name: "Acme Corp" });

    const res = await request(buildApp()).post("/api/clients").send({ name: "acme corp" });

    expect(res.status).toBe(200); // 200, not 201 -- confirms find-or-create, not a fresh insert
    expect(res.body.client.id).toBe("c-existing");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects with 400 when name is missing (validation failure)", async () => {
    const res = await request(buildApp()).post("/api/clients").send({ industry: "Media" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects with 400 for a malformed contactEmail", async () => {
    const res = await request(buildApp()).post("/api/clients").send({ name: "Acme", contactEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("403s a contractor creating a client", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "Contractor", role: "contractor" });
    const res = await request(buildApp()).post("/api/clients").send({ name: "Acme" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/clients/:id", () => {
  it("updates on the happy path", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", name: "Acme" });
    mockUpdate.mockResolvedValue({ id: "c1", name: "Acme Renamed" });

    const res = await request(buildApp()).patch("/api/clients/c1").send({ name: "Acme Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.client.name).toBe("Acme Renamed");
  });

  it("404s when patching a client that doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/clients/nope").send({ name: "X" });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects with 400 for an invalid partial field", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", name: "Acme" });
    const res = await request(buildApp()).patch("/api/clients/c1").send({ contactEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/clients/:id", () => {
  it("deletes on the happy path (owner only)", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", name: "Acme" });
    mockDelete.mockResolvedValue({ id: "c1" });

    const res = await request(buildApp()).delete("/api/clients/c1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("404s deleting a client that doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).delete("/api/clients/nope");
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("403s a recruiter attempting to delete (owner-only route)", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "Recruiter", role: "recruiter" });
    const res = await request(buildApp()).delete("/api/clients/c1");
    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
