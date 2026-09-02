import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { encodeLeadIdToken } from "../lib/onboarding/shortLink";

vi.mock("../prisma", () => ({
  prisma: { lead: { findUnique: vi.fn() } },
}));

import { prisma } from "../prisma";
import { onboardingShortLinkRouter } from "./onboardingShortLink.routes";

const findUniqueMock = vi.mocked(prisma.lead.findUnique);

function buildApp() {
  const app = express();
  app.use("/g", onboardingShortLinkRouter);
  return app;
}

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

function fakeDecimal(n: number) {
  return { toNumber: () => n } as any;
}

function fakeLead(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: LEAD_ID,
    firstName: "Ana",
    fullName: "Ana Silva",
    email: "ana@example.com",
    country: "Brazil",
    sourceLanguage: "English",
    targetLanguage: "Portuguese (Brazilian)",
    services: ["Subtitling"],
    yearsOfExperience: fakeDecimal(5),
    vendorExperience: null,
    profileLink: null,
    ...overrides,
  };
}

describe("GET /g/:token", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it("redirects to a freshly-built apply URL for a known lead", async () => {
    findUniqueMock.mockResolvedValue(fakeLead() as any);
    const token = encodeLeadIdToken(LEAD_ID);

    const res = await request(buildApp()).get(`/g/${token}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("first_name=Ana");
    expect(res.headers.location).toContain("callback_url=");
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: LEAD_ID } });
  });

  it("reflects the lead's CURRENT data at click time, not a stale snapshot", async () => {
    // Simulate the lead's country having been corrected after the message
    // was originally drafted -- the short link has no embedded data of its
    // own, so this must reflect what's true right now.
    findUniqueMock.mockResolvedValue(fakeLead({ country: "Portugal" }) as any);
    const token = encodeLeadIdToken(LEAD_ID);

    const res = await request(buildApp()).get(`/g/${token}`);

    expect(res.headers.location).toContain("address_country=PT");
  });

  it("returns a clean 404 for a malformed/tampered token, never an unhandled error", async () => {
    const res = await request(buildApp()).get("/g/not-a-valid-token");
    expect(res.status).toBe(404);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns a clean 404 when the token decodes but no such lead exists", async () => {
    findUniqueMock.mockResolvedValue(null);
    const token = encodeLeadIdToken("99999999-9999-9999-9999-999999999999");

    const res = await request(buildApp()).get(`/g/${token}`);
    expect(res.status).toBe(404);
  });

  it("responds with plain text, not JSON, for a human landing on a broken link in a browser", async () => {
    const res = await request(buildApp()).get("/g/not-a-valid-token");
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
  });
});
