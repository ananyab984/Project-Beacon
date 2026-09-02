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
    lead: { findUnique: vi.fn() },
    emailQueueItem: { deleteMany: vi.fn() },
  },
}));

vi.mock("@server/services/unipile.service", () => ({
  UnipileService: {
    sendLinkedInMessage: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

import { prisma } from "@server-root/prisma";
import { UnipileService } from "@server/services/unipile.service";
import { outreachRouter } from "@server/routes/outreach.routes";

const mockFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockDeleteMany = prisma.emailQueueItem.deleteMany as unknown as ReturnType<typeof vi.fn>;
const mockSendLinkedIn = UnipileService.sendLinkedInMessage as unknown as ReturnType<typeof vi.fn>;
const mockSendEmail = UnipileService.sendEmail as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/outreach", outreachRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
  mockFindUnique.mockResolvedValue(null);
  mockDeleteMany.mockResolvedValue({ count: 1 });
  mockSendLinkedIn.mockResolvedValue({ success: true, mode: "direct_message" });
  mockSendEmail.mockResolvedValue({ success: true, mode: "email" });
});

describe("POST /api/outreach/send", () => {
  it("400s when leadId is missing", async () => {
    const res = await request(buildApp()).post("/api/outreach/send").send({ channel: "EMAIL", body: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_FIELDS");
  });

  it("400s when channel is missing", async () => {
    const res = await request(buildApp()).post("/api/outreach/send").send({ leadId: "lead-1", body: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_FIELDS");
  });

  it("400s when body is missing", async () => {
    const res = await request(buildApp()).post("/api/outreach/send").send({ leadId: "lead-1", channel: "EMAIL" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_FIELDS");
  });

  it("400s for an unrecognized channel", async () => {
    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "SMS", body: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_CHANNEL");
  });

  it("sends a LinkedIn message using the explicit `to` target without a lead lookup", async () => {
    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "linkedin", to: "https://linkedin.com/in/jane", body: "hi" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockSendLinkedIn).toHaveBeenCalledWith("owner-1", "lead-1", "https://linkedin.com/in/jane", "hi");
  });

  it("falls back to the lead's profileLink when `to` isn't given", async () => {
    mockFindUnique.mockResolvedValue({ profileLink: "https://linkedin.com/in/jane" });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "LINKEDIN", body: "hi" });

    expect(res.status).toBe(200);
    expect(mockSendLinkedIn).toHaveBeenCalledWith("owner-1", "lead-1", "https://linkedin.com/in/jane", "hi");
  });

  it("400s LinkedIn send when neither `to` nor the lead has a profile link", async () => {
    mockFindUnique.mockResolvedValue({ profileLink: null });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "LINKEDIN", body: "hi" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_LINKEDIN_PROFILE");
    expect(mockSendLinkedIn).not.toHaveBeenCalled();
  });

  it("sends an email using the explicit `to` target and provided subject", async () => {
    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", subject: "Hi", body: "hi" });

    expect(res.status).toBe(200);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith("owner-1", "lead-1", "jane@example.com", "Hi", "hi");
  });

  it("defaults the subject when none is given", async () => {
    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi" });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith("owner-1", "lead-1", "jane@example.com", "Outreach from Global3", "hi");
  });

  it("falls back to the lead's email when `to` isn't given", async () => {
    mockFindUnique.mockResolvedValue({ email: "lead@example.com" });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", body: "hi" });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith("owner-1", "lead-1", "lead@example.com", "Outreach from Global3", "hi");
  });

  it("400s email send when neither `to` nor the lead has an email address", async () => {
    mockFindUnique.mockResolvedValue({ email: null });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", body: "hi" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_EMAIL");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("deletes the referenced EmailQueueItem, scoped to the caller's recruiterId", async () => {
    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi", emailQueueId: "q-1" });

    expect(res.status).toBe(200);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: "q-1", recruiterId: "owner-1" } });
  });

  it("still succeeds if deleting the EmailQueueItem throws", async () => {
    mockDeleteMany.mockRejectedValue(new Error("db down"));

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi", emailQueueId: "q-1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("does not attempt a deleteMany when emailQueueId is absent", async () => {
    await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi" });

    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("converts a thrown Unipile error into the mapped status/code via toApiError", async () => {
    mockSendEmail.mockRejectedValue({ statusCode: 409, code: "ACCOUNT_NOT_CONNECTED", message: "not connected" });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ACCOUNT_NOT_CONNECTED");
  });

  it("403s a role outside owner/recruiter/contractor", async () => {
    setTestUser({ id: "u-1", email: "u@example.com", name: "U", role: "guest" });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi" });

    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("allows a contractor to send outreach", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });

    const res = await request(buildApp())
      .post("/api/outreach/send")
      .send({ leadId: "lead-1", channel: "EMAIL", to: "jane@example.com", body: "hi" });

    expect(res.status).toBe(200);
  });
});
