import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "@server/middleware/errorHandler";

const { getTestUser, setTestUser } = vi.hoisted(() => {
  let user: { id: string; email: string; name: string; role: string } | null = {
    id: "user-1",
    email: "user@example.com",
    name: "User",
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
  verifyNeonIdentity: vi.fn(),
}));

vi.mock("@server/services/auth.service", () => ({
  AuthService: {
    findUserById: vi.fn(),
    linkOrCreateProfile: vi.fn(),
  },
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    user: { update: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { AuthService } from "@server/services/auth.service";
import { verifyNeonIdentity } from "@server/middleware/auth";
import { authRouter } from "@server/routes/auth.routes";

const mockFindUserById = AuthService.findUserById as unknown as ReturnType<typeof vi.fn>;
const mockLinkOrCreateProfile = AuthService.linkOrCreateProfile as unknown as ReturnType<typeof vi.fn>;
const mockVerifyNeonIdentity = verifyNeonIdentity as unknown as ReturnType<typeof vi.fn>;
const mockUserUpdate = prisma.user.update as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const baseProfileRow = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  role: "OWNER",
  emailVerified: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "user-1", email: "user@example.com", name: "User", role: "owner" });
  mockVerifyNeonIdentity.mockResolvedValue({
    neonUserId: "neon-1",
    email: "user@example.com",
    name: "User",
    emailVerified: true,
  });
});

describe("GET /api/auth/me", () => {
  it("returns the caller's profile with a lowercased role", async () => {
    mockFindUserById.mockResolvedValue(baseProfileRow);

    const res = await request(buildApp()).get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      role: "owner",
      emailVerified: true,
    });
    expect(mockFindUserById).toHaveBeenCalledWith("user-1");
  });

  it("404s with USER_NOT_FOUND when no profile row exists", async () => {
    mockFindUserById.mockResolvedValue(null);

    const res = await request(buildApp()).get("/api/auth/me");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("USER_NOT_FOUND");
  });

  it("500s when the lookup throws", async () => {
    mockFindUserById.mockRejectedValue(new Error("db down"));

    const res = await request(buildApp()).get("/api/auth/me");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
  });

  it("401s when there is no authenticated session", async () => {
    setTestUser(null);

    const res = await request(buildApp()).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(mockFindUserById).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/profile", () => {
  it("401s when the bearer token can't be verified", async () => {
    mockVerifyNeonIdentity.mockImplementation((_req: any, res: any) => {
      res.status(401).json({ error: "UNAUTHORIZED_NO_TOKEN", message: "Authentication required" });
      return Promise.resolve(null);
    });

    const res = await request(buildApp()).post("/api/auth/profile").send({ role: "recruiter" });

    expect(res.status).toBe(401);
    expect(mockLinkOrCreateProfile).not.toHaveBeenCalled();
  });

  it("creates a profile with the chosen role and returns 201", async () => {
    mockLinkOrCreateProfile.mockResolvedValue({
      id: "new-1",
      email: "user@example.com",
      name: "User",
      role: "RECRUITER",
      emailVerified: true,
    });

    const res = await request(buildApp()).post("/api/auth/profile").send({ name: "User", role: "recruiter" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("recruiter");
    expect(mockLinkOrCreateProfile).toHaveBeenCalledWith({
      neonAuthUserId: "neon-1",
      email: "user@example.com",
      name: "User",
      emailVerified: true,
      role: "recruiter",
    });
  });

  it("falls back to the Neon identity's name when the body omits it", async () => {
    mockLinkOrCreateProfile.mockResolvedValue(baseProfileRow);

    await request(buildApp()).post("/api/auth/profile").send({ role: "owner" });

    expect(mockLinkOrCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "User" })
    );
  });

  it("allows role to be omitted for a pre-invited email", async () => {
    mockLinkOrCreateProfile.mockResolvedValue(baseProfileRow);

    const res = await request(buildApp()).post("/api/auth/profile").send({});

    expect(res.status).toBe(201);
    expect(mockLinkOrCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ role: undefined })
    );
  });

  it("400s with ROLE_REQUIRED when there's no invite and no role was chosen", async () => {
    mockLinkOrCreateProfile.mockResolvedValue(null);

    const res = await request(buildApp()).post("/api/auth/profile").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ROLE_REQUIRED");
  });

  it("500s when the body fails schema validation (e.g. an invalid role enum)", async () => {
    const res = await request(buildApp()).post("/api/auth/profile").send({ role: "admin" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
    expect(mockLinkOrCreateProfile).not.toHaveBeenCalled();
  });

  it("500s when linkOrCreateProfile throws", async () => {
    mockLinkOrCreateProfile.mockRejectedValue(new Error("db down"));

    const res = await request(buildApp()).post("/api/auth/profile").send({ role: "owner" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
  });
});

describe("PATCH /api/auth/me", () => {
  it("updates the caller's name on the happy path", async () => {
    mockUserUpdate.mockResolvedValue({ ...baseProfileRow, name: "New Name" });

    const res = await request(buildApp()).patch("/api/auth/me").send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("New Name");
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { name: "New Name" } });
  });

  it("400s with MISSING_FIELDS when name is absent", async () => {
    const res = await request(buildApp()).patch("/api/auth/me").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_FIELDS");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("400s with INVALID_NAME when the name normalizes to empty", async () => {
    const res = await request(buildApp()).patch("/api/auth/me").send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_NAME");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("collapses internal whitespace before saving", async () => {
    mockUserUpdate.mockResolvedValue(baseProfileRow);

    await request(buildApp()).patch("/api/auth/me").send({ name: "Jane   Doe" });

    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { name: "Jane Doe" } });
  });

  it("500s when the update throws", async () => {
    mockUserUpdate.mockRejectedValue(new Error("db down"));

    const res = await request(buildApp()).patch("/api/auth/me").send({ name: "New Name" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
  });

  it("401s when there is no authenticated session", async () => {
    setTestUser(null);

    const res = await request(buildApp()).patch("/api/auth/me").send({ name: "New Name" });

    expect(res.status).toBe(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
