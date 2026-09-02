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
    conversation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    conversationMessage: { findFirst: vi.fn() },
    lead: { findUnique: vi.fn() },
    unipileWebhookEvent: { findFirst: vi.fn() },
    emailQueueItem: { findFirst: vi.fn() },
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

import { prisma } from "@server-root/prisma";
import { UnipileService } from "@server/services/unipile.service";
import { getDraftingOrchestrator } from "@server/drafting/instance";
import { conversationRouter } from "@server/routes/conversation.routes";

const mockFindMany = prisma.conversation.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.conversation.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.conversation.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.conversation.create as unknown as ReturnType<typeof vi.fn>;
const mockMessageFindFirst = prisma.conversationMessage.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockLeadFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockWebhookFindFirst = prisma.unipileWebhookEvent.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockQueueFindFirst = prisma.emailQueueItem.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockSendLinkedIn = UnipileService.sendLinkedInMessage as unknown as ReturnType<typeof vi.fn>;
const mockSendEmail = UnipileService.sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockGetOrchestrator = getDraftingOrchestrator as unknown as ReturnType<typeof vi.fn>;
const mockProcessDraft = vi.fn();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", conversationRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const leadRow = {
  id: "lead-1",
  fullName: "Jane Doe",
  displayName: null,
  profileLink: "https://linkedin.com/in/jane",
  email: "jane@example.com",
  source: "LINKEDIN",
  services: ["Dubbing"],
  targetLanguage: "German",
  firstName: "Jane",
  country: null,
  sourceLanguage: null,
  secondaryLanguages: [],
  yearsOfExperience: null,
  vendorExperience: null,
  enrichmentStatus: null,
  headline: null,
  aboutSnippet: null,
  currentTitle: null,
  toolsSoftware: [],
  certifications: [],
  clayData: null,
  rawScrapeData: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "recruiter-1", email: "r@example.com", name: "R", role: "recruiter" });
  mockFindMany.mockResolvedValue([]);
  mockFindFirst.mockResolvedValue(null);
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "conv-1" });
  mockMessageFindFirst.mockResolvedValue({ id: "msg-1", text: "hi" });
  mockLeadFindUnique.mockResolvedValue(leadRow);
  mockWebhookFindFirst.mockResolvedValue(null);
  mockQueueFindFirst.mockResolvedValue(null);
  mockSendLinkedIn.mockResolvedValue({ success: true });
  mockSendEmail.mockResolvedValue({ success: true });
  mockGetOrchestrator.mockReturnValue({ processDraft: mockProcessDraft });
  mockProcessDraft.mockResolvedValue({ subject: "Hi", body: "Hello Jane", verdict: "SEND", flags: [] });
});

describe("role gate", () => {
  it("403s a role outside owner/recruiter/contractor", async () => {
    setTestUser({ id: "u-1", email: "u@example.com", name: "U", role: "guest" });
    const res = await request(buildApp()).get("/api/conversations");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/conversations", () => {
  it("scopes a recruiter to their own conversations", async () => {
    mockFindMany.mockResolvedValue([{ id: "c1" }]);
    const res = await request(buildApp()).get("/api/conversations");
    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([{ id: "c1" }]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recruiterId: "recruiter-1" } })
    );
  });

  it("gives an owner every conversation, unscoped", async () => {
    setTestUser({ id: "owner-1", email: "o@example.com", name: "O", role: "owner" });
    await request(buildApp()).get("/api/conversations");
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe("GET /api/conversations/by-lead/:leadId", () => {
  it("returns null conversation + empty messages when none exists", async () => {
    const res = await request(buildApp()).get("/api/conversations/by-lead/lead-1");
    expect(res.status).toBe(200);
    expect(res.body.conversation).toBeNull();
    expect(res.body.messages).toEqual([]);
  });

  it("filters by channel query param when provided", async () => {
    mockFindFirst.mockResolvedValue({ id: "c1", messages: [{ id: "m1" }] });
    const res = await request(buildApp()).get("/api/conversations/by-lead/lead-1?channel=email");
    expect(res.status).toBe(200);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leadId: "lead-1", channel: "EMAIL" }) })
    );
    expect(res.body.messages).toEqual([{ id: "m1" }]);
  });

  it("scopes a non-owner to their own recruiterId", async () => {
    await request(buildApp()).get("/api/conversations/by-lead/lead-1");
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ recruiterId: "recruiter-1" }) })
    );
  });

  it("does not scope an owner by recruiterId", async () => {
    setTestUser({ id: "owner-1", email: "o@example.com", name: "O", role: "owner" });
    await request(buildApp()).get("/api/conversations/by-lead/lead-1");
    const whereArg = mockFindFirst.mock.calls[0][0].where;
    expect(whereArg).not.toHaveProperty("recruiterId");
  });
});

describe("GET /api/conversations/:id", () => {
  it("404s when the conversation doesn't exist", async () => {
    const res = await request(buildApp()).get("/api/conversations/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CONVERSATION_NOT_FOUND");
  });

  it("403s a recruiter viewing another recruiter's conversation", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", recruiterId: "someone-else" });
    const res = await request(buildApp()).get("/api/conversations/c1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("returns the conversation on the happy path", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", recruiterId: "recruiter-1" });
    const res = await request(buildApp()).get("/api/conversations/c1");
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe("c1");
  });

  it("lets an owner view any recruiter's conversation", async () => {
    setTestUser({ id: "owner-1", email: "o@example.com", name: "O", role: "owner" });
    mockFindUnique.mockResolvedValue({ id: "c1", recruiterId: "someone-else" });
    const res = await request(buildApp()).get("/api/conversations/c1");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/conversations", () => {
  it("400s a malformed leadId", async () => {
    const res = await request(buildApp()).post("/api/conversations").send({ leadId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("404s when the lead doesn't exist", async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/conversations")
      .send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("LEAD_NOT_FOUND");
  });

  it("400s a lead whose source isn't LINKEDIN", async () => {
    mockLeadFindUnique.mockResolvedValue({ ...leadRow, source: "PROZ" });
    const res = await request(buildApp())
      .post("/api/conversations")
      .send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("LEAD_NOT_LINKEDIN");
  });

  it("400s a LINKEDIN-sourced lead whose profileLink isn't actually a linkedin.com URL", async () => {
    mockLeadFindUnique.mockResolvedValue({ ...leadRow, profileLink: "https://proz.com/profile/jane" });
    const res = await request(buildApp())
      .post("/api/conversations")
      .send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("LEAD_NOT_LINKEDIN");
  });

  it("returns the existing LinkedIn conversation instead of creating a duplicate", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing-conv" });
    const res = await request(buildApp())
      .post("/api/conversations")
      .send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe("existing-conv");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a new LinkedIn conversation on the happy path", async () => {
    const res = await request(buildApp())
      .post("/api/conversations")
      .send({ leadId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: "lead-1", recruiterId: "recruiter-1", channel: "LINKEDIN" }),
      })
    );
  });
});

describe("POST /api/conversations/:id/generate-draft", () => {
  it("404s when the conversation doesn't exist for this recruiter", async () => {
    const res = await request(buildApp()).post("/api/conversations/c1/generate-draft");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CONVERSATION_NOT_FOUND");
  });

  it("returns the drafted body on the happy path", async () => {
    mockFindFirst.mockResolvedValue({ id: "c1", recruiterId: "recruiter-1", lead: leadRow });
    const res = await request(buildApp()).post("/api/conversations/c1/generate-draft");
    expect(res.status).toBe(200);
    expect(res.body.draft.body).toBe("Hello Jane");
    expect(mockProcessDraft).toHaveBeenCalledWith(expect.any(Object), "linkedin");
  });

  it("422s when the orchestrator marks the lead ineligible", async () => {
    mockFindFirst.mockResolvedValue({ id: "c1", recruiterId: "recruiter-1", lead: leadRow });
    mockProcessDraft.mockResolvedValue({ subject: null, body: "", verdict: "INELIGIBLE", flags: ["missing headline"] });
    const res = await request(buildApp()).post("/api/conversations/c1/generate-draft");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("LEAD_NOT_DRAFT_ELIGIBLE");
    expect(res.body.message).toContain("missing headline");
  });

  it("502s when the orchestrator throws", async () => {
    mockFindFirst.mockResolvedValue({ id: "c1", recruiterId: "recruiter-1", lead: leadRow });
    mockProcessDraft.mockRejectedValue(new Error("network blip"));
    const res = await request(buildApp()).post("/api/conversations/c1/generate-draft");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("DRAFTING_FAILED");
  });
});

describe("POST /api/conversations/:id/messages", () => {
  it("400s an empty text body", async () => {
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "" });
    expect(res.status).toBe(400);
  });

  it("404s when the conversation doesn't exist", async () => {
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CONVERSATION_NOT_FOUND");
  });

  it("403s a recruiter replying in another recruiter's conversation", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", recruiterId: "someone-else", channel: "LINKEDIN", lead: leadRow });
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(403);
  });

  it("400s an unsupported channel", async () => {
    mockFindUnique.mockResolvedValue({ id: "c1", recruiterId: "recruiter-1", channel: "INSTAGRAM", lead: leadRow });
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("UNSUPPORTED_CHANNEL");
  });

  it("sends a LinkedIn reply and returns the row syncToConversation wrote", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "LINKEDIN",
      lead: leadRow,
    });
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(201);
    expect(mockSendLinkedIn).toHaveBeenCalledWith("recruiter-1", "lead-1", leadRow.profileLink, "hi", undefined);
    expect(res.body.message).toEqual({ id: "msg-1", text: "hi" });
  });

  it("400s a LinkedIn reply when the lead has no profile link and none was supplied", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "LINKEDIN",
      lead: { ...leadRow, profileLink: null },
    });
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_LINKEDIN_PROFILE");
    expect(mockSendLinkedIn).not.toHaveBeenCalled();
  });

  it("400s an email reply when the lead has no email and none was supplied", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "EMAIL",
      lead: { ...leadRow, email: null },
    });
    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_EMAIL");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("prefers the webhook event's original subject when replyToMessageId matches one", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "EMAIL",
      candidateName: "Jane Doe",
      lead: leadRow,
    });
    mockWebhookFindFirst.mockResolvedValue({ payload: { subject: "Original Subject", email_id: "em-1" } });

    const res = await request(buildApp())
      .post("/api/conversations/c1/messages")
      .send({ text: "hi", replyToMessageId: "em-1" });

    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "recruiter-1",
      "lead-1",
      leadRow.email,
      "Re: Original Subject",
      "hi",
      undefined,
      "em-1"
    );
    expect(mockQueueFindFirst).not.toHaveBeenCalled();
  });

  it("does not double-prefix a subject that already starts with Re:", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "EMAIL",
      candidateName: "Jane Doe",
      lead: leadRow,
    });
    mockWebhookFindFirst.mockResolvedValue({ payload: { subject: "Re: Original Subject", email_id: "em-1" } });

    const res = await request(buildApp())
      .post("/api/conversations/c1/messages")
      .send({ text: "hi", replyToMessageId: "em-1" });

    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "recruiter-1",
      "lead-1",
      leadRow.email,
      "Re: Original Subject",
      "hi",
      undefined,
      "em-1"
    );
  });

  it("falls back to the latest EmailQueueItem subject when no webhook match exists", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "EMAIL",
      candidateName: "Jane Doe",
      lead: leadRow,
    });
    mockQueueFindFirst.mockResolvedValue({ subject: "Queue Subject" });

    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });

    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "recruiter-1",
      "lead-1",
      leadRow.email,
      "Re: Queue Subject",
      "hi",
      undefined,
      undefined
    );
  });

  it("falls back to the conversation's candidateName when there's no webhook match or queue item", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "EMAIL",
      candidateName: "Jane Doe",
      lead: leadRow,
    });

    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });

    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "recruiter-1",
      "lead-1",
      leadRow.email,
      "Re: Jane Doe",
      "hi",
      undefined,
      undefined
    );
  });

  it("propagates a mapped error when the Unipile send fails, without writing a message", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "recruiter-1",
      leadId: "lead-1",
      channel: "LINKEDIN",
      lead: leadRow,
    });
    mockSendLinkedIn.mockRejectedValue({ statusCode: 409, code: "ACCOUNT_NOT_CONNECTED", message: "not connected" });

    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ACCOUNT_NOT_CONNECTED");
    expect(mockMessageFindFirst).not.toHaveBeenCalled();
  });

  it("lets an owner reply in another recruiter's conversation", async () => {
    setTestUser({ id: "owner-1", email: "o@example.com", name: "O", role: "owner" });
    mockFindUnique.mockResolvedValue({
      id: "c1",
      recruiterId: "someone-else",
      leadId: "lead-1",
      channel: "LINKEDIN",
      lead: leadRow,
    });

    const res = await request(buildApp()).post("/api/conversations/c1/messages").send({ text: "hi" });
    expect(res.status).toBe(201);
  });
});
