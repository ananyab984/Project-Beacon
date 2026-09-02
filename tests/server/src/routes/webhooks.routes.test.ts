import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "@server/middleware/errorHandler";

vi.mock("@server/services/clay.service", () => ({
  ClayService: { handleWebhookEvent: vi.fn() },
}));

import { ClayService } from "@server/services/clay.service";
import { webhooksRouter } from "@server/routes/webhooks.routes";

const mockHandleWebhookEvent = ClayService.handleWebhookEvent as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", webhooksRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/clay/:token", () => {
  it("returns 200 with the service result on the happy path", async () => {
    mockHandleWebhookEvent.mockResolvedValue({ status: "updated" });

    const res = await request(buildApp())
      .post("/api/webhooks/clay/tok-1")
      .set("x-g3-webhook-secret", "secret-1")
      .send({ source_row_index: "https://linkedin.com/in/x", linkedin_enrichment: {} });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", result: { status: "updated" } });
  });

  it("passes the path token, secret header, and body through to the service", async () => {
    mockHandleWebhookEvent.mockResolvedValue({ status: "ok" });

    await request(buildApp())
      .post("/api/webhooks/clay/tok-abc")
      .set("x-g3-webhook-secret", "secret-xyz")
      .send({ source_row_index: "id-1", linkedin_enrichment: { foo: "bar" } });

    expect(mockHandleWebhookEvent).toHaveBeenCalledWith(
      "tok-abc",
      "secret-xyz",
      expect.objectContaining({ source_row_index: "id-1", linkedin_enrichment: { foo: "bar" } })
    );
  });

  it("passes undefined when the secret header is missing", async () => {
    mockHandleWebhookEvent.mockResolvedValue({ status: "ok" });

    await request(buildApp()).post("/api/webhooks/clay/tok-1").send({});

    expect(mockHandleWebhookEvent).toHaveBeenCalledWith("tok-1", undefined, {});
  });

  it("returns the thrown statusCode and message when the service rejects", async () => {
    mockHandleWebhookEvent.mockRejectedValue({ statusCode: 401, message: "Invalid webhook secret header" });

    const res = await request(buildApp()).post("/api/webhooks/clay/tok-1").send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "WEBHOOK_FAILED", message: "Invalid webhook secret header" });
  });

  it("defaults to 400 when the thrown error has no statusCode", async () => {
    mockHandleWebhookEvent.mockRejectedValue(new Error("bad payload"));

    const res = await request(buildApp()).post("/api/webhooks/clay/tok-1").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "WEBHOOK_FAILED", message: "bad payload" });
  });
});
