import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { ApiError } from "../lib/apiError";
import { signLeadId } from "../lib/onboarding/callbackToken";
import { config } from "../config";

// The route's own job is request validation, auth, and response shape --
// markLeadOnboarded's internals (StageHistory/Requirement/ClientDemand
// sync) are that function's own concern, tested separately. Mocking it
// here means every fixture below is a synthetic request WE constructed,
// never a real call to G3 or a real database.
vi.mock("../services/lead.service", () => ({
  markLeadOnboarded: vi.fn(),
}));

// ClayService is imported by webhooks.routes.ts too (for the sibling /clay
// route) -- mock it so importing the router never needs a real Clay client.
vi.mock("../services/clay.service", () => ({
  ClayService: { handleWebhookEvent: vi.fn() },
}));

import { markLeadOnboarded } from "../services/lead.service";
import { webhooksRouter } from "./webhooks.routes";

const markLeadOnboardedMock = vi.mocked(markLeadOnboarded);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", webhooksRouter);
  return app;
}

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const PATH_TOKEN = config.onboardingWebhookPathToken;

function endpoint(overrides: { token?: string; leadId?: string; sig?: string } = {}) {
  const token = overrides.token ?? PATH_TOKEN;
  const leadId = "leadId" in overrides ? overrides.leadId : LEAD_ID;
  const sig = "sig" in overrides ? overrides.sig : leadId ? signLeadId(leadId) : undefined;
  const params = new URLSearchParams();
  if (leadId !== undefined) params.set("lead_id", leadId);
  if (sig !== undefined) params.set("sig", sig);
  return `/api/webhooks/onboarding-complete/${token}?${params.toString()}`;
}

describe("GET /api/webhooks/onboarding-complete/:token", () => {
  beforeEach(() => {
    markLeadOnboardedMock.mockReset();
  });

  it("accepted: valid payload for a known, still-open lead -> marks onboarded, responds 200 exactly once", async () => {
    markLeadOnboardedMock.mockResolvedValue({ lead: {} as any, alreadyOnboarded: false, stageHistorySkipped: false });

    const res = await request(buildApp()).get(endpoint());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", alreadyOnboarded: false });
    expect(markLeadOnboardedMock).toHaveBeenCalledTimes(1);
    expect(markLeadOnboardedMock).toHaveBeenCalledWith(LEAD_ID);
  });

  it("duplicate/retry: same call arriving twice is a no-op the second time, not a duplicate state change", async () => {
    markLeadOnboardedMock
      .mockResolvedValueOnce({ lead: {} as any, alreadyOnboarded: false, stageHistorySkipped: false })
      .mockResolvedValueOnce({ lead: {} as any, alreadyOnboarded: true, stageHistorySkipped: false });

    const app = buildApp();
    const first = await request(app).get(endpoint());
    const second = await request(app).get(endpoint());

    expect(first.status).toBe(200);
    expect(first.body.alreadyOnboarded).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.alreadyOnboarded).toBe(true);
    expect(markLeadOnboardedMock).toHaveBeenCalledTimes(2);
  });

  it("already onboarded when the call arrives: no-op, 200, not an error", async () => {
    markLeadOnboardedMock.mockResolvedValue({ lead: {} as any, alreadyOnboarded: true, stageHistorySkipped: false });

    const res = await request(buildApp()).get(endpoint());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", alreadyOnboarded: true });
  });

  it("unknown lead_id: rejected cleanly (404), never an unhandled error", async () => {
    markLeadOnboardedMock.mockRejectedValue(new ApiError(404, "LEAD_NOT_FOUND", "Lead not found"));

    const res = await request(buildApp()).get(endpoint({ leadId: "22222222-2222-2222-2222-222222222222" }));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("LEAD_NOT_FOUND");
  });

  it("malformed: missing lead_id is rejected with 400 before markLeadOnboarded is ever called", async () => {
    const res = await request(buildApp()).get(endpoint({ leadId: undefined as any, sig: "irrelevant" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MALFORMED_REQUEST");
    expect(markLeadOnboardedMock).not.toHaveBeenCalled();
  });

  it("malformed: missing sig is rejected with 400 before markLeadOnboarded is ever called", async () => {
    const res = await request(buildApp()).get(endpoint({ sig: undefined as any }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MALFORMED_REQUEST");
    expect(markLeadOnboardedMock).not.toHaveBeenCalled();
  });

  it("wrong lead_id / tampered signature: rejected with 401, never mutates state", async () => {
    // A signature that's valid for a DIFFERENT lead_id, replayed against this one.
    const sigForSomeoneElse = signLeadId("99999999-9999-9999-9999-999999999999");
    const res = await request(buildApp()).get(endpoint({ sig: sigForSomeoneElse }));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_SIGNATURE");
    expect(markLeadOnboardedMock).not.toHaveBeenCalled();
  });

  it("invalid path token: rejected with 401, never even reaches signature verification", async () => {
    const res = await request(buildApp()).get(endpoint({ token: "totally-wrong-token" }));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_TOKEN");
    expect(markLeadOnboardedMock).not.toHaveBeenCalled();
  });

  it("unexpected internal failure: surfaces as a clean 500, not an unhandled exception crashing the process", async () => {
    markLeadOnboardedMock.mockRejectedValue(new Error("db connection lost"));

    const res = await request(buildApp()).get(endpoint());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
  });

  it("is rate-limited: the 31st request within the window is rejected rather than processed", async () => {
    markLeadOnboardedMock.mockResolvedValue({ lead: {} as any, alreadyOnboarded: false, stageHistorySkipped: false });
    const app = buildApp();

    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(app).get(endpoint({ leadId: `lead-${i}`, sig: signLeadId(`lead-${i}`) }));
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
