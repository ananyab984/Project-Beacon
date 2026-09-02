import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "@server/middleware/errorHandler";

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

vi.mock("@server-root/prisma", () => ({
  prisma: {
    emailQueueItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversation: { findMany: vi.fn() },
    lead: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@server/services/unipile.service", () => ({
  UnipileService: {
    sendLinkedInMessage: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

vi.mock("@server/drafting/instance", () => ({
  getDraftingOrchestrator: vi.fn(),
}));

vi.mock("@server/lib/draftLeadPayload", () => ({
  buildDraftLeadPayload: vi.fn().mockReturnValue({ First_Name: "Jane" }),
}));

import { prisma } from "@server-root/prisma";
import { UnipileService } from "@server/services/unipile.service";
import { getDraftingOrchestrator } from "@server/drafting/instance";
import { emailQueueRouter } from "@server/routes/email-queue.routes";

const mockFindMany = prisma.emailQueueItem.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.emailQueueItem.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.emailQueueItem.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.emailQueueItem.update as unknown as ReturnType<typeof vi.fn>;
const mockConversationFindMany = prisma.conversation.findMany as unknown as ReturnType<typeof vi.fn>;
const mockLeadFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockLeadUpdate = prisma.lead.update as unknown as ReturnType<typeof vi.fn>;
const mockSendLinkedIn = UnipileService.sendLinkedInMessage as unknown as ReturnType<typeof vi.fn>;
const mockSendEmail = UnipileService.sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockGetOrchestrator = getDraftingOrchestrator as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/email-queue", emailQueueRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const baseLead = {
  id: "lead-1",
  fullName: "Jane Doe",
  displayName: null,
  email: "jane@example.com",
  profileLink: "https://linkedin.com/in/jane",
  services: ["Dubbing"],
  targetLanguage: "German",
};

const baseItem = {
  id: "item-1",
  leadId: "lead-1",
  recruiterId: "recruiter-1",
  candidateName: "Jane Doe",
  candidateRole: "Dubbing",
  status: "REVIEW_NEEDED",
  subject: "",
  body: "",
  aiGenerated: false,
  lead: baseLead,
};

let mockProcessDraft: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "recruiter-1", email: "r@example.com", name: "R", role: "recruiter" });
  mockConversationFindMany.mockResolvedValue([]);
  mockProcessDraft = vi.fn();
  mockGetOrchestrator.mockReturnValue({ processDraft: mockProcessDraft });
});

describe("GET /api/email-queue", () => {
  it("lists the recruiter's own queue", async () => {
    mockFindMany.mockResolvedValue([{ ...baseItem, receivedAt: new Date("2026-01-01") }]);
    const res = await request(buildApp()).get("/api/email-queue");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recruiterId: "recruiter-1" } })
    );
  });

  it("sorts items by most recent activity (conversation lastMessageAt beats stale receivedAt)", async () => {
    const older = { ...baseItem, id: "item-old", leadId: "lead-old", receivedAt: new Date("2026-01-01") };
    const newer = { ...baseItem, id: "item-new", leadId: "lead-new", receivedAt: new Date("2020-01-01") };
    mockFindMany.mockResolvedValue([older, newer]);
    mockConversationFindMany.mockResolvedValue([{ leadId: "lead-new", lastMessageAt: new Date("2026-06-01") }]);

    const res = await request(buildApp()).get("/api/email-queue");

    expect(res.body.items.map((i: any) => i.id)).toEqual(["item-new", "item-old"]);
  });

  it("403s a role outside owner/recruiter/contractor", async () => {
    setTestUser({ id: "x", email: "x@example.com", name: "X", role: "guest" as any });
    const res = await request(buildApp()).get("/api/email-queue");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/email-queue", () => {
  it("404s when the lead doesn't exist", async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/email-queue").send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("LEAD_NOT_FOUND");
  });

  it("returns the existing item instead of creating a duplicate", async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockFindFirst.mockResolvedValue(baseItem);
    const res = await request(buildApp()).post("/api/email-queue").send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(200);
    expect(res.body.item).toEqual(baseItem);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a new item with empty subject/body, requiring an explicit draft generation", async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ ...baseItem });

    const res = await request(buildApp()).post("/api/email-queue").send({ leadId: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: "", body: "", aiGenerated: false, status: "REVIEW_NEEDED" }),
      })
    );
  });

  it("rejects an invalid leadId with 400", async () => {
    const res = await request(buildApp()).post("/api/email-queue").send({ leadId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/email-queue/:id", () => {
  it("autosaves subject/body/to on the happy path", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockUpdate.mockResolvedValue({ ...baseItem, subject: "Hi" });

    const res = await request(buildApp()).patch("/api/email-queue/item-1").send({ subject: "Hi" });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { subject: "Hi" } });
  });

  it("404s identically whether the item doesn't exist or isn't owned by this recruiter", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/email-queue/item-1").send({ subject: "Hi" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("EMAIL_QUEUE_ITEM_NOT_FOUND");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/email-queue/:id/generate-draft", () => {
  it("404s when the item doesn't exist for this recruiter", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});
    expect(res.status).toBe(404);
  });

  it("409s regenerating a draft for an already-sent item, so the real thread subject never drifts", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem, status: "SENT" });
    const res = await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_SENT");
    expect(mockProcessDraft).not.toHaveBeenCalled();
  });

  it("generates and stores a draft on the happy path", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockProcessDraft.mockResolvedValue({ subject: "Hello Jane", body: "Personalized body", verdict: "OK", flags: [] });
    mockUpdate.mockResolvedValue({ ...baseItem, subject: "Hello Jane", body: "Personalized body", aiGenerated: true });

    const res = await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { subject: "Hello Jane", body: "Personalized body", aiGenerated: true },
    });
  });

  it("falls back to the item's existing subject when the draft has no subject", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockProcessDraft.mockResolvedValue({ subject: null, body: "Body only", verdict: "OK", flags: [] });
    mockUpdate.mockResolvedValue({ ...baseItem });

    await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subject: baseItem.subject }) })
    );
  });

  it("422s with LEAD_NOT_DRAFT_ELIGIBLE when the pipeline verdict is INELIGIBLE", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockProcessDraft.mockResolvedValue({ subject: null, body: "", verdict: "INELIGIBLE", flags: ["no email on file"] });

    const res = await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("LEAD_NOT_DRAFT_ELIGIBLE");
    expect(res.body.message).toContain("no email on file");
  });

  it("422s when the draft body comes back blank even without an explicit INELIGIBLE verdict", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockProcessDraft.mockResolvedValue({ subject: "Hi", body: "   ", verdict: "OK", flags: [] });

    const res = await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});

    expect(res.status).toBe(422);
  });

  it("502s DRAFTING_FAILED when the orchestrator throws unexpectedly", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockProcessDraft.mockRejectedValue(new Error("service down"));

    const res = await request(buildApp()).post("/api/email-queue/item-1/generate-draft").send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("DRAFTING_FAILED");
  });

  it("fills in a manually-typed TO address on the lead only when the lead had no email yet", async () => {
    const leadNoEmail = { ...baseLead, email: null };
    mockFindFirst.mockResolvedValue({ ...baseItem, lead: leadNoEmail });
    mockProcessDraft.mockResolvedValue({ subject: "Hi", body: "Body", verdict: "OK", flags: [] });
    mockUpdate.mockResolvedValue({ ...baseItem });

    await request(buildApp())
      .post("/api/email-queue/item-1/generate-draft")
      .send({ to: "typed@example.com" });

    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { email: "typed@example.com" },
    });
  });

  it("does not overwrite an existing enriched email with a manually-typed one", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockProcessDraft.mockResolvedValue({ subject: "Hi", body: "Body", verdict: "OK", flags: [] });
    mockUpdate.mockResolvedValue({ ...baseItem });

    await request(buildApp())
      .post("/api/email-queue/item-1/generate-draft")
      .send({ to: "typed@example.com" });

    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it("ignores a malformed manually-typed email address", async () => {
    const leadNoEmail = { ...baseLead, email: null };
    mockFindFirst.mockResolvedValue({ ...baseItem, lead: leadNoEmail });
    mockProcessDraft.mockResolvedValue({ subject: "Hi", body: "Body", verdict: "OK", flags: [] });
    mockUpdate.mockResolvedValue({ ...baseItem });

    await request(buildApp())
      .post("/api/email-queue/item-1/generate-draft")
      .send({ to: "not-an-email" });

    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/email-queue/:id/send", () => {
  it("404s when the item doesn't exist for this recruiter", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "Hi", channel: "EMAIL" });
    expect(res.status).toBe(404);
  });

  it("sends over EMAIL and marks the item SENT with the address actually used", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockSendEmail.mockResolvedValue({});
    mockUpdate.mockResolvedValue({ ...baseItem, status: "SENT" });

    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "Hello", subject: "Subj", channel: "EMAIL" });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith("recruiter-1", "lead-1", "jane@example.com", "Subj", "Hello", undefined);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ to: "jane@example.com", status: "SENT", sentChannel: "EMAIL" }),
      })
    );
  });

  it("sends over LINKEDIN using the lead's profile link when no explicit target given", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockSendLinkedIn.mockResolvedValue({});
    mockUpdate.mockResolvedValue({ ...baseItem, status: "SENT" });

    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "Hello", channel: "LINKEDIN" });

    expect(res.status).toBe(200);
    expect(mockSendLinkedIn).toHaveBeenCalledWith("recruiter-1", "lead-1", baseLead.profileLink, "Hello", undefined);
  });

  it("400s MISSING_EMAIL when sending EMAIL and neither override nor lead has an address", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem, lead: { ...baseLead, email: null } });
    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "Hello", channel: "EMAIL" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_EMAIL");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("400s MISSING_LINKEDIN_PROFILE when sending LINKEDIN and the lead has no profile link", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem, lead: { ...baseLead, profileLink: null } });
    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "Hello", channel: "LINKEDIN" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_LINKEDIN_PROFILE");
  });

  it("normalizes a Unipile-side failure into a 502 UPSTREAM_SEND_FAILED rather than a generic 500", async () => {
    mockFindFirst.mockResolvedValue(baseItem);
    mockSendEmail.mockRejectedValue({ response: { status: 422, data: { message: "invalid address" } } });

    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "Hello", channel: "EMAIL" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("UPSTREAM_SEND_FAILED");
    expect(res.body.message).toContain("invalid address");
  });

  it("rejects an empty body with 400 validation error", async () => {
    const res = await request(buildApp())
      .post("/api/email-queue/item-1/send")
      .send({ body: "", channel: "EMAIL" });
    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/email-queue/batch-send", () => {
  it("sends each id best-effort, one failure not aborting the rest", async () => {
    mockFindFirst
      .mockResolvedValueOnce({ ...baseItem, id: "item-a" })
      .mockResolvedValueOnce(null);
    mockSendLinkedIn.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});

    const res = await request(buildApp())
      .post("/api/email-queue/batch-send")
      .send({ ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { id: "11111111-1111-4111-8111-111111111111", success: true },
      { id: "22222222-2222-4222-8222-222222222222", success: false, error: "EMAIL_QUEUE_ITEM_NOT_FOUND" },
    ]);
  });

  it("prefers LinkedIn over email when the lead has both", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem });
    mockSendLinkedIn.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});

    await request(buildApp())
      .post("/api/email-queue/batch-send")
      .send({ ids: ["11111111-1111-4111-8111-111111111111"] });

    expect(mockSendLinkedIn).toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("falls back to email when the lead has no LinkedIn profile link", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem, lead: { ...baseLead, profileLink: null } });
    mockSendEmail.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});

    await request(buildApp())
      .post("/api/email-queue/batch-send")
      .send({ ids: ["11111111-1111-4111-8111-111111111111"] });

    expect(mockSendEmail).toHaveBeenCalled();
  });

  it("reports NO_CONTACT_TARGET when the lead has neither profile link nor email", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem, lead: { ...baseLead, profileLink: null, email: null } });

    const res = await request(buildApp())
      .post("/api/email-queue/batch-send")
      .send({ ids: ["11111111-1111-4111-8111-111111111111"] });

    expect(res.body.results[0]).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      success: false,
      error: "NO_CONTACT_TARGET",
    });
  });

  it("catches a per-item send failure and reports its error code without aborting the batch", async () => {
    mockFindFirst.mockResolvedValue({ ...baseItem });
    mockSendLinkedIn.mockRejectedValue({ statusCode: 400, code: "BAD_REQUEST", message: "oops" });

    const res = await request(buildApp())
      .post("/api/email-queue/batch-send")
      .send({ ids: ["11111111-1111-4111-8111-111111111111"] });

    expect(res.body.results[0]).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      success: false,
      error: "BAD_REQUEST",
    });
  });

  it("rejects an empty ids array with 400", async () => {
    const res = await request(buildApp()).post("/api/email-queue/batch-send").send({ ids: [] });
    expect(res.status).toBe(400);
  });
});
