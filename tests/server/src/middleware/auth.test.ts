import { describe, it, expect, vi, beforeEach } from "vitest";

const { getVerifyResult, setVerifyResult } = vi.hoisted(() => {
  let result: any = { payload: { sub: "neon-1", email: "user@example.com", name: "User", emailVerified: true } };
  let shouldThrow: any = null;
  return {
    getVerifyResult: () => ({ result, shouldThrow }),
    setVerifyResult: (r: any, throwErr: any = null) => {
      result = r;
      shouldThrow = throwErr;
    },
  };
});

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async () => {
    const { result, shouldThrow } = getVerifyResult();
    if (shouldThrow) throw shouldThrow;
    return result;
  }),
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@server-root/prisma";
import { authenticateJwt, verifyNeonIdentity } from "@server/middleware/auth";

const mockFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.user.update as unknown as ReturnType<typeof vi.fn>;

function mockReqRes(authHeader?: string) {
  const req: any = { headers: authHeader ? { authorization: authHeader } : {} };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  setVerifyResult({ payload: { sub: "neon-1", email: "user@example.com", name: "User", emailVerified: true } });
});

describe("verifyNeonIdentity", () => {
  it("401s with no token when the Authorization header is missing", async () => {
    const { req, res } = mockReqRes();
    const result = await verifyNeonIdentity(req, res);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED_NO_TOKEN");
  });

  it("401s with no token when the header doesn't start with 'Bearer '", async () => {
    const { req, res } = mockReqRes("Basic abc123");
    const result = await verifyNeonIdentity(req, res);
    expect(result).toBeNull();
    expect(res.body.error).toBe("UNAUTHORIZED_NO_TOKEN");
  });

  it("returns the identity on a valid token", async () => {
    const { req, res } = mockReqRes("Bearer valid-token");
    const result = await verifyNeonIdentity(req, res);
    expect(result).toEqual({ neonUserId: "neon-1", email: "user@example.com", name: "User", emailVerified: true });
  });

  it("401s with a distinct error code for an expired token", async () => {
    setVerifyResult(null, { code: "ERR_JWT_EXPIRED" });
    const { req, res } = mockReqRes("Bearer expired-token");
    const result = await verifyNeonIdentity(req, res);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED_TOKEN_EXPIRED");
  });

  it("401s with a generic invalid-token code for any other verification failure", async () => {
    setVerifyResult(null, new Error("signature mismatch"));
    const { req, res } = mockReqRes("Bearer malformed-token");
    const result = await verifyNeonIdentity(req, res);
    expect(result).toBeNull();
    expect(res.body.error).toBe("UNAUTHORIZED_INVALID_TOKEN");
  });

  it("401s when the token verifies but is missing sub/email", async () => {
    setVerifyResult({ payload: { name: "No Sub Or Email" } });
    const { req, res } = mockReqRes("Bearer weird-token");
    const result = await verifyNeonIdentity(req, res);
    expect(result).toBeNull();
    expect(res.body.error).toBe("UNAUTHORIZED_INVALID_TOKEN");
  });
});

describe("authenticateJwt", () => {
  it("calls next() and sets req.user on a fully matched, active profile", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "app-user-1",
      email: "user@example.com",
      name: "User",
      role: "RECRUITER",
      isActive: true,
      neonAuthUserId: "neon-1",
    });

    const { req, res, next } = mockReqRes("Bearer valid-token");
    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: "app-user-1", email: "user@example.com", name: "User", role: "recruiter" });
  });

  it("does not call next() when the token itself is invalid (response already sent)", async () => {
    const { req, res, next } = mockReqRes();
    await authenticateJwt(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("falls back to email lookup and backfills neonAuthUserId on first login after signup", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // no match by neonAuthUserId yet
      .mockResolvedValueOnce({ id: "app-user-2", email: "user@example.com", name: "Old Name", role: "OWNER", isActive: true });
    mockUpdate.mockResolvedValueOnce({
      id: "app-user-2",
      email: "user@example.com",
      name: "User",
      role: "OWNER",
      isActive: true,
    });

    const { req, res, next } = mockReqRes("Bearer valid-token");
    await authenticateJwt(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "app-user-2" },
      data: { neonAuthUserId: "neon-1", name: "User" },
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.role).toBe("owner");
  });

  it("404s with NO_PROFILE for a verified identity with no app profile at all", async () => {
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const { req, res, next } = mockReqRes("Bearer valid-token");
    await authenticateJwt(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("NO_PROFILE");
    expect(next).not.toHaveBeenCalled();
  });

  it("403s ACCOUNT_DISABLED for a deactivated profile", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "app-user-3",
      email: "user@example.com",
      name: "User",
      role: "RECRUITER",
      isActive: false,
    });

    const { req, res, next } = mockReqRes("Bearer valid-token");
    await authenticateJwt(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ACCOUNT_DISABLED");
    expect(next).not.toHaveBeenCalled();
  });

  it("lowercases the role onto req.user regardless of the DB enum's casing", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "app-user-4",
      email: "user@example.com",
      name: "User",
      role: "CONTRACTOR",
      isActive: true,
    });

    const { req, res, next } = mockReqRes("Bearer valid-token");
    await authenticateJwt(req, res, next);

    expect(req.user?.role).toBe("contractor");
    expect(next).toHaveBeenCalled();
  });
});
