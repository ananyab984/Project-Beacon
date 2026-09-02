import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockToken } = vi.hoisted(() => ({ mockToken: vi.fn() }));

vi.mock("@neondatabase/neon-js/auth", () => ({
  createAuthClient: () => ({ token: mockToken }),
}));
vi.mock("@neondatabase/neon-js/auth/react/adapters", () => ({
  BetterAuthReactAdapter: () => ({}),
}));

import { getNeonToken, getNeonTokenResult } from "@/lib/neon-auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getNeonTokenResult", () => {
  it("returns the token and no error on a bare { token } shape", async () => {
    mockToken.mockResolvedValue({ data: { token: "jwt-1" }, error: null });
    expect(await getNeonTokenResult()).toEqual({ token: "jwt-1" });
  });

  it("returns the token from a nested { session: { token } } shape", async () => {
    mockToken.mockResolvedValue({ data: { session: { token: "jwt-2" } }, error: null });
    expect(await getNeonTokenResult()).toEqual({ token: "jwt-2" });
  });

  it("tolerates a bare string response", async () => {
    mockToken.mockResolvedValue({ data: "jwt-3", error: null });
    expect(await getNeonTokenResult()).toEqual({ token: "jwt-3" });
  });

  it("returns an error detail (not the token) when the client call fails", async () => {
    mockToken.mockResolvedValue({ data: null, error: { status: 401, message: "expired" } });
    const result = await getNeonTokenResult();
    expect(result.token).toBeNull();
    expect(result.errorDetail).toContain("401");
    expect(result.errorDetail).toContain("expired");
  });

  it("returns an error detail when the response has no token in any known shape", async () => {
    mockToken.mockResolvedValue({ data: {}, error: null });
    const result = await getNeonTokenResult();
    expect(result.token).toBeNull();
    expect(result.errorDetail).toContain("empty response");
  });
});

describe("getNeonToken", () => {
  it("returns just the token string on success", async () => {
    mockToken.mockResolvedValue({ data: { token: "jwt-1" }, error: null });
    expect(await getNeonToken()).toBe("jwt-1");
  });

  it("returns null on failure", async () => {
    mockToken.mockResolvedValue({ data: null, error: { status: 500 } });
    expect(await getNeonToken()).toBeNull();
  });
});
