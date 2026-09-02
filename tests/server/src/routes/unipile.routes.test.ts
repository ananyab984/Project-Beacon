import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { getTestUser, setTestUser } = vi.hoisted(() => {
  let user = { id: "recruiter-1", email: "r@example.com", name: "R", role: "recruiter" };
  return { getTestUser: () => user, setTestUser: (u: typeof user) => (user = u) };
});

vi.mock("@server/middleware/auth", () => ({
  authenticateJwt: (req: any, _res: any, next: any) => {
    req.user = getTestUser();
    next();
  },
}));

vi.mock("@server/services/unipile.service", () => ({
  UnipileService: {
    mintHostedAuthLink: vi.fn(),
    cancelPendingAuthAttempt: vi.fn(),
    getUserConnectedAccounts: vi.fn(),
    disconnectAccount: vi.fn(),
    handleWebhookEvent: vi.fn(),
  },
}));

vi.mock("@server/services/processInboundMessage", () => ({
  processInboundMessage: vi.fn(),
}));

import { UnipileService } from "@server/services/unipile.service";
import { processInboundMessage } from "@server/services/processInboundMessage";
import { unipileRouter } from "@server/routes/unipile.routes";

const mockMint = UnipileService.mintHostedAuthLink as unknown as ReturnType<typeof vi.fn>;
const mockCancel = UnipileService.cancelPendingAuthAttempt as unknown as ReturnType<typeof vi.fn>;
const mockGetAccounts = UnipileService.getUserConnectedAccounts as unknown as ReturnType<typeof vi.fn>;
const mockDisconnect = UnipileService.disconnectAccount as unknown as ReturnType<typeof vi.fn>;
const mockWebhook = UnipileService.handleWebhookEvent as unknown as ReturnType<typeof vi.fn>;
const mockProcessInbound = processInboundMessage as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/unipile", unipileRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "recruiter-1", email: "r@example.com", name: "R", role: "recruiter" });
  mockProcessInbound.mockResolvedValue(undefined);
});

describe("POST /api/unipile/connect", () => {
  it("400s when provider is missing", async () => {
    const res = await request(buildApp()).post("/api/unipile/connect").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_PROVIDER");
    expect(mockMint).not.toHaveBeenCalled();
  });

  it("mints a hosted auth link on the happy path, deriving rolePath from the recruiter role", async () => {
    mockMint.mockResolvedValue({ url: "https://connect.example/x", nonce: "n1" });

    const res = await request(buildApp()).post("/api/unipile/connect").set("Origin", "https://app.example.com").send({ provider: "LINKEDIN" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, url: "https://connect.example/x", nonce: "n1" });
    expect(mockMint).toHaveBeenCalledWith("recruiter-1", "LINKEDIN", "create", "https://app.example.com", "/recruiter");
  });

  it("derives rolePath /owner for an owner", async () => {
    setTestUser({ id: "owner-1", email: "o@example.com", name: "O", role: "owner" });
    mockMint.mockResolvedValue({ url: "u", nonce: "n" });

    await request(buildApp()).post("/api/unipile/connect").send({ provider: "MAIL" });

    expect(mockMint).toHaveBeenCalledWith("owner-1", "MAIL", "create", undefined, "/owner");
  });

  it("derives clientUrl from the Referer header's origin when no Origin header is sent", async () => {
    mockMint.mockResolvedValue({ url: "u", nonce: "n" });

    await request(buildApp()).post("/api/unipile/connect").set("Referer", "https://ref.example.com/some/path").send({ provider: "MAIL" });

    expect(mockMint).toHaveBeenCalledWith("recruiter-1", "MAIL", "create", "https://ref.example.com", "/recruiter");
  });

  it("forwards the service's own code and detail for a 409 ALREADY_CONNECTED failure", async () => {
    mockMint.mockRejectedValue({ statusCode: 409, code: "ALREADY_CONNECTED", message: "already connected" });

    const res = await request(buildApp()).post("/api/unipile/connect").send({ provider: "LINKEDIN" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "ALREADY_CONNECTED", message: "already connected" });
  });

  it("forwards a 409 CONNECTION_PENDING failure", async () => {
    mockMint.mockRejectedValue({ statusCode: 409, code: "CONNECTION_PENDING", message: "pending" });

    const res = await request(buildApp()).post("/api/unipile/connect").send({ provider: "LINKEDIN" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "CONNECTION_PENDING", message: "pending" });
  });

  it("prefers axios response.data.detail over err.message when both are present", async () => {
    mockMint.mockRejectedValue({ response: { status: 422, data: { detail: "bad dsn" } }, message: "Request failed with status code 422" });

    const res = await request(buildApp()).post("/api/unipile/connect").send({ provider: "LINKEDIN" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "CONNECT_FAILED", message: "bad dsn" });
  });

  it("falls back to 500 CONNECT_FAILED with the raw error message for an unrecognized error", async () => {
    mockMint.mockRejectedValue(new Error("boom"));

    const res = await request(buildApp()).post("/api/unipile/connect").send({ provider: "LINKEDIN" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "CONNECT_FAILED", message: "boom" });
  });
});

describe("POST /api/unipile/reconnect", () => {
  it("400s when provider is missing", async () => {
    const res = await request(buildApp()).post("/api/unipile/reconnect").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_PROVIDER");
  });

  it("mints a reconnect link without clientUrl/rolePath args", async () => {
    mockMint.mockResolvedValue({ url: "u2", nonce: "n2" });

    const res = await request(buildApp()).post("/api/unipile/reconnect").send({ provider: "GOOGLE" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, url: "u2", nonce: "n2" });
    expect(mockMint).toHaveBeenCalledWith("recruiter-1", "GOOGLE", "reconnect");
  });

  it("maps a failure to RECONNECT_FAILED when the service gives no code", async () => {
    mockMint.mockRejectedValue({ statusCode: 404, message: "account not found" });

    const res = await request(buildApp()).post("/api/unipile/reconnect").send({ provider: "GOOGLE" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "RECONNECT_FAILED", message: "account not found" });
  });
});

describe("POST /api/unipile/cancel-pending", () => {
  it("400s when provider is missing", async () => {
    const res = await request(buildApp()).post("/api/unipile/cancel-pending").send({});
    expect(res.status).toBe(400);
  });

  it("succeeds idempotently on the happy path", async () => {
    mockCancel.mockResolvedValue(undefined);
    const res = await request(buildApp()).post("/api/unipile/cancel-pending").send({ provider: "LINKEDIN" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockCancel).toHaveBeenCalledWith("recruiter-1", "LINKEDIN");
  });

  it("500s with CANCEL_FAILED when the service throws", async () => {
    mockCancel.mockRejectedValue(new Error("db down"));
    const res = await request(buildApp()).post("/api/unipile/cancel-pending").send({ provider: "LINKEDIN" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "CANCEL_FAILED", message: "db down" });
  });
});

describe("GET /api/unipile/accounts", () => {
  it("returns the user's connected accounts", async () => {
    mockGetAccounts.mockResolvedValue([{ id: "acc-1", provider: "LINKEDIN" }]);
    const res = await request(buildApp()).get("/api/unipile/accounts");
    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([{ id: "acc-1", provider: "LINKEDIN" }]);
    expect(mockGetAccounts).toHaveBeenCalledWith("recruiter-1");
  });

  it("500s with FETCH_ACCOUNTS_FAILED on service failure", async () => {
    mockGetAccounts.mockRejectedValue(new Error("timeout"));
    const res = await request(buildApp()).get("/api/unipile/accounts");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "FETCH_ACCOUNTS_FAILED", message: "timeout" });
  });
});

describe("DELETE /api/unipile/accounts/:accountId", () => {
  it("disconnects on the happy path", async () => {
    mockDisconnect.mockResolvedValue(undefined);
    const res = await request(buildApp()).delete("/api/unipile/accounts/acc-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Account disconnected" });
    expect(mockDisconnect).toHaveBeenCalledWith("recruiter-1", "acc-1");
  });

  it("500s with DISCONNECT_FAILED and forwards the error message", async () => {
    mockDisconnect.mockRejectedValue({ statusCode: 409, code: "ACCOUNT_NOT_CONNECTED", message: "not connected" });
    const res = await request(buildApp()).delete("/api/unipile/accounts/acc-1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "DISCONNECT_FAILED", message: "not connected" });
  });
});

describe("POST /api/unipile/webhook/:token", () => {
  it("acks 200 and does not enqueue inbound processing when there is no inboundMessageId", async () => {
    mockWebhook.mockResolvedValue({ inboundMessageId: null });
    const res = await request(buildApp()).post("/api/unipile/webhook/path-token").send({ event: "x" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", result: { inboundMessageId: null } });
    await new Promise((r) => setImmediate(r));
    expect(mockProcessInbound).not.toHaveBeenCalled();
  });

  it("fires-and-forgets processInboundMessage after responding when an inboundMessageId is returned", async () => {
    mockWebhook.mockResolvedValue({ inboundMessageId: "msg-1" });
    const res = await request(buildApp()).post("/api/unipile/webhook/path-token").send({ event: "x" });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(mockProcessInbound).toHaveBeenCalledWith("msg-1");
  });

  it("logs but does not crash when the fire-and-forget processInboundMessage rejects", async () => {
    mockWebhook.mockResolvedValue({ inboundMessageId: "msg-2" });
    mockProcessInbound.mockRejectedValue(new Error("processing failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(buildApp()).post("/api/unipile/webhook/path-token").send({ event: "x" });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(consoleSpy).toHaveBeenCalledWith("[webhook] async processInboundMessage failed:", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("does not require authentication (public webhook route)", async () => {
    mockWebhook.mockResolvedValue({ inboundMessageId: null });
    const res = await request(buildApp()).post("/api/unipile/webhook/path-token").send({});
    expect(res.status).toBe(200);
    expect(mockWebhook).toHaveBeenCalledWith("path-token", undefined, {});
  });

  it("maps a thrown statusCode (e.g. bad webhook secret) to that status", async () => {
    mockWebhook.mockRejectedValue({ statusCode: 401, message: "Invalid webhook secret header" });
    const res = await request(buildApp()).post("/api/unipile/webhook/path-token").set("x-g3-webhook-secret", "wrong").send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "WEBHOOK_FAILED", message: "Invalid webhook secret header" });
  });

  it("defaults to 400 WEBHOOK_FAILED when the error carries no statusCode", async () => {
    mockWebhook.mockRejectedValue(new Error("malformed payload"));
    const res = await request(buildApp()).post("/api/unipile/webhook/path-token").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "WEBHOOK_FAILED", message: "malformed payload" });
  });
});
