import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "@server/middleware/errorHandler";

const { getTestUser, setTestUser } = vi.hoisted(() => {
  let user: { id: string; email: string; name: string; role: string } | null = {
    id: "owner-1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
  };
  return {
    getTestUser: () => user,
    setTestUser: (u: typeof user) => {
      user = u;
    },
  };
});

vi.mock("@server/middleware/auth", () => ({
  authenticateJwt: (req: any, res: any, next: any) => {
    const user = getTestUser();
    if (!user) {
      return res.status(401).json({ error: "UNAUTHORIZED_NO_TOKEN", message: "Authentication required" });
    }
    req.user = user;
    next();
  },
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractorAssignment: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@server-root/prisma";
import { userRouter } from "@server/routes/user.routes";

const mockFindMany = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.user.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.user.update as unknown as ReturnType<typeof vi.fn>;
const mockAssignmentFindMany = prisma.contractorAssignment.findMany as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = prisma.contractorAssignment.upsert as unknown as ReturnType<typeof vi.fn>;
const mockDeleteMany = prisma.contractorAssignment.deleteMany as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/users", userRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const ownerUser = { id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" };
const recruiterUser = { id: "recruiter-1", email: "recruiter@example.com", name: "Recruiter", role: "recruiter" };
const contractorUser = { id: "contractor-1", email: "contractor@example.com", name: "Contractor", role: "contractor" };

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ ...ownerUser });
  mockAssignmentFindMany.mockResolvedValue([]);
});

describe("GET /api/users", () => {
  it("lets an owner list recruiters", async () => {
    mockFindMany.mockResolvedValue([{ id: "r1", name: "Rec" }]);

    const res = await request(buildApp()).get("/api/users?role=RECRUITER");

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([{ id: "r1", name: "Rec" }]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "RECRUITER" } })
    );
  });

  it("lets a recruiter list the recruiter roster too", async () => {
    setTestUser({ ...recruiterUser });
    mockFindMany.mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/users?role=RECRUITER");

    expect(res.status).toBe(200);
  });

  it("403s a contractor trying to list the roster", async () => {
    setTestUser({ ...contractorUser });

    const res = await request(buildApp()).get("/api/users?role=RECRUITER");

    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("enriches contractor results with their managing recruiter id", async () => {
    mockFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mockAssignmentFindMany.mockResolvedValue([{ contractorId: "c1", recruiterId: "recruiter-1" }]);

    const res = await request(buildApp()).get("/api/users?role=CONTRACTOR");

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([
      { id: "c1", managingRecruiterId: "recruiter-1" },
      { id: "c2", managingRecruiterId: null },
    ]);
  });

  it("400s on a missing/invalid role query param", async () => {
    const res = await request(buildApp()).get("/api/users");

    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("401s when there is no authenticated session", async () => {
    setTestUser(null);

    const res = await request(buildApp()).get("/api/users?role=RECRUITER");

    expect(res.status).toBe(401);
  });
});

describe("POST /api/users", () => {
  const validBody = { name: "New Person", email: "new@example.com", role: "RECRUITER" };

  beforeEach(() => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: "new-1", ...data }));
  });

  it("creates a user on the happy path", async () => {
    const res = await request(buildApp()).post("/api/users").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("new@example.com");
  });

  it("defaults workStatus to PERMANENT and languages to [] when omitted", async () => {
    await request(buildApp()).post("/api/users").send(validBody);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workStatus: "PERMANENT", languages: [] }) })
    );
  });

  it("403s a recruiter attempting to create a user (owner-only)", async () => {
    setTestUser({ ...recruiterUser });

    const res = await request(buildApp()).post("/api/users").send(validBody);

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400s INVALID_EMAIL for an email that's absurdly long", async () => {
    const longEmail = `${"a".repeat(250)}@ex.com`;
    const res = await request(buildApp()).post("/api/users").send({ ...validBody, email: longEmail });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_EMAIL");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400s INVALID_NAME when the name normalizes to empty", async () => {
    const res = await request(buildApp()).post("/api/users").send({ ...validBody, name: " " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_NAME");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("409s USER_EXISTS when the email is already taken", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing-1" });

    const res = await request(buildApp()).post("/api/users").send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("USER_EXISTS");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400s on an invalid role enum", async () => {
    const res = await request(buildApp()).post("/api/users").send({ ...validBody, role: "ADMIN" });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/users/:id", () => {
  it("soft-deletes on the happy path (owner only)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", isActive: true });
    mockUpdate.mockResolvedValue({ id: "u1", isActive: false });

    const res = await request(buildApp()).delete("/api/users/u1");

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" }, data: { isActive: false } })
    );
  });

  it("404s when the user doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(buildApp()).delete("/api/users/nope");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("USER_NOT_FOUND");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("403s a recruiter (owner-only route)", async () => {
    setTestUser({ ...recruiterUser });

    const res = await request(buildApp()).delete("/api/users/u1");

    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users/:id/languages", () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue({ id: "target-1" });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: "target-1", ...data }));
  });

  it("lets an owner update anyone's languages", async () => {
    const res = await request(buildApp()).patch("/api/users/target-1/languages").send({ languages: ["EN"] });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target-1" }, data: { languages: ["EN"] } })
    );
  });

  it("lets a user update their own languages", async () => {
    setTestUser({ ...recruiterUser, id: "target-1" });

    const res = await request(buildApp()).patch("/api/users/target-1/languages").send({ languages: ["FR"] });

    expect(res.status).toBe(200);
  });

  it("403s a non-owner updating someone else's languages", async () => {
    setTestUser({ ...recruiterUser });

    const res = await request(buildApp()).patch("/api/users/target-1/languages").send({ languages: ["FR"] });

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s when the target user doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(buildApp()).patch("/api/users/target-1/languages").send({ languages: ["EN"] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("USER_NOT_FOUND");
  });

  it("400s when languages isn't an array", async () => {
    const res = await request(buildApp()).patch("/api/users/target-1/languages").send({ languages: "EN" });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/users/:id/contractor-assignment", () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue({ id: "contractor-1", role: "CONTRACTOR" });
    mockUpsert.mockImplementation(({ create }: any) => Promise.resolve({ id: "assign-1", ...create }));
  });

  it("assigns a contractor to the calling recruiter by default", async () => {
    setTestUser({ ...recruiterUser });

    const res = await request(buildApp()).post("/api/users/contractor-1/contractor-assignment").send({});

    expect(res.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contractorId: "contractor-1" },
        create: { contractorId: "contractor-1", recruiterId: "recruiter-1" },
      })
    );
  });

  it("ignores a recruiterId in the body when the caller is a recruiter (self-assign only)", async () => {
    setTestUser({ ...recruiterUser });

    await request(buildApp())
      .post("/api/users/contractor-1/contractor-assignment")
      .send({ recruiterId: "11111111-1111-4111-8111-111111111111" });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ recruiterId: "recruiter-1" }) })
    );
  });

  it("lets an owner assign a contractor to an explicit recruiterId", async () => {
    const explicitRecruiterId = "11111111-1111-4111-8111-111111111111";

    await request(buildApp())
      .post("/api/users/contractor-1/contractor-assignment")
      .send({ recruiterId: explicitRecruiterId });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ recruiterId: explicitRecruiterId }) })
    );
  });

  it("falls back to the owner's own id when no recruiterId is given", async () => {
    await request(buildApp()).post("/api/users/contractor-1/contractor-assignment").send({});

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ recruiterId: "owner-1" }) })
    );
  });

  it("404s CONTRACTOR_NOT_FOUND when the target isn't a contractor", async () => {
    mockFindUnique.mockResolvedValue({ id: "contractor-1", role: "RECRUITER" });

    const res = await request(buildApp()).post("/api/users/contractor-1/contractor-assignment").send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CONTRACTOR_NOT_FOUND");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("403s a contractor attempting to assign", async () => {
    setTestUser({ ...contractorUser });

    const res = await request(buildApp()).post("/api/users/contractor-1/contractor-assignment").send({});

    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/users/:id/contractor-assignment", () => {
  it("unassigns on the happy path", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp()).delete("/api/users/contractor-1/contractor-assignment");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Contractor unassigned");
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { contractorId: "contractor-1" } });
  });

  it("403s a contractor attempting to unassign", async () => {
    setTestUser({ ...contractorUser });

    const res = await request(buildApp()).delete("/api/users/contractor-1/contractor-assignment");

    expect(res.status).toBe(403);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
