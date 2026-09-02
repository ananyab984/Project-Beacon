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
    faqEntry: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@server/drafting/draftGenerator", () => ({
  generateFaqReply: vi.fn(),
  generateFaqKeywords: vi.fn(),
}));

vi.mock("@server/drafting/claudeClient", () => ({
  ClaudeClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@server/drafting/config", () => ({
  loadDraftingConfig: vi.fn().mockReturnValue({ apiKey: "test-key" }),
}));

import { prisma } from "@server-root/prisma";
import { generateFaqReply, generateFaqKeywords } from "@server/drafting/draftGenerator";
import { faqRouter } from "@server/routes/faq.routes";

const mockFindMany = prisma.faqEntry.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.faqEntry.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.faqEntry.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.faqEntry.update as unknown as ReturnType<typeof vi.fn>;
const mockDelete = prisma.faqEntry.delete as unknown as ReturnType<typeof vi.fn>;
const mockQueryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const mockGenerateFaqReply = generateFaqReply as unknown as ReturnType<typeof vi.fn>;
const mockGenerateFaqKeywords = generateFaqKeywords as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/faq", faqRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const baseFaq = {
  id: "faq_1",
  category: "Pricing",
  question: "How much does dubbing cost?",
  answer: "It depends on the language pair and duration.",
  tags: ["pricing", "dubbing"],
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
});

describe("POST /api/faq/check", () => {
  it("400s MISSING_LEAD_MESSAGE when leadMessage is missing", async () => {
    const res = await request(buildApp()).post("/api/faq/check").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MISSING_LEAD_MESSAGE");
  });

  it("400s MISSING_LEAD_MESSAGE when leadMessage is blank whitespace", async () => {
    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "   " });
    expect(res.status).toBe(400);
  });

  it("returns match:false when no row clears the confidence floor", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "what languages do you support?" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ match: false });
    expect(mockGenerateFaqReply).not.toHaveBeenCalled();
  });

  it("returns match:false when rank clears the floor but similarity doesn't", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "1", question: "Q", answer: "A", rank: 0.5, sim: 0.1 }]);
    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "hi" });
    expect(res.body).toEqual({ match: false });
  });

  it("phrases and returns the matched answer when both thresholds are cleared", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "1", question: "How much?", answer: "Depends on X", rank: 0.5, sim: 0.6 }]);
    mockGenerateFaqReply.mockResolvedValue({ body: "It depends on X, roughly." });

    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "how much does it cost" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ match: true, answer: "It depends on X, roughly.", matchedQuestion: "How much?" });
  });

  it("502s FAQ_GENERATION_FAILED when phrasing throws", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "1", question: "Q", answer: "A", rank: 0.9, sim: 0.9 }]);
    mockGenerateFaqReply.mockRejectedValue(new Error("claude unreachable"));

    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "hi" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("FAQ_GENERATION_FAILED");
    expect(res.body.message).toContain("claude unreachable");
  });

  it("502s FAQ_GENERATION_FAILED when phrasing returns an empty body", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "1", question: "Q", answer: "A", rank: 0.9, sim: 0.9 }]);
    mockGenerateFaqReply.mockResolvedValue({ body: "   " });

    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "hi" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("FAQ_GENERATION_FAILED");
  });

  it("surfaces a thrown error's own status/code from the outer catch", async () => {
    mockQueryRaw.mockRejectedValue(Object.assign(new Error("db down"), { statusCode: 503, code: "DB_DOWN" }));

    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "hi" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("DB_DOWN");
  });

  it("defaults to 500 FAQ_CHECK_FAILED when the thrown error carries no status/code", async () => {
    mockQueryRaw.mockRejectedValue(new Error("boom"));

    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "hi" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("FAQ_CHECK_FAILED");
  });

  it("does not require authentication side effects beyond req.user being set (no role restriction on check)", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    mockQueryRaw.mockResolvedValue([]);
    const res = await request(buildApp()).post("/api/faq/check").send({ leadMessage: "hi" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/faq", () => {
  it("lists active FAQs newest first", async () => {
    mockFindMany.mockResolvedValue([baseFaq]);
    const res = await request(buildApp()).get("/api/faq");
    expect(res.status).toBe(200);
    expect(res.body.faqEntries).toEqual([baseFaq]);
    expect(mockFindMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
  });
});

describe("GET /api/faq/:id", () => {
  it("returns a single FAQ on the happy path", async () => {
    mockFindUnique.mockResolvedValue(baseFaq);
    const res = await request(buildApp()).get("/api/faq/faq_1");
    expect(res.status).toBe(200);
    expect(res.body.faqEntry).toEqual(baseFaq);
  });

  it("404s FAQ_NOT_FOUND when it doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/faq/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("FAQ_NOT_FOUND");
  });
});

describe("POST /api/faq", () => {
  const body = { category: "Pricing", question: "How much?", answer: "Depends." };

  it("creates an FAQ with auto-generated tags on the happy path", async () => {
    mockGenerateFaqKeywords.mockResolvedValue({ keywords: ["pricing", "cost"] });
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...data }));

    const res = await request(buildApp()).post("/api/faq").send(body);

    expect(res.status).toBe(201);
    expect(res.body.keywordsGenerated).toBe(true);
    expect(res.body.faqEntry.tags).toEqual(["pricing", "cost"]);
  });

  it("still creates the FAQ with no tags when keyword generation fails (best-effort)", async () => {
    mockGenerateFaqKeywords.mockRejectedValue(new Error("claude down"));
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...data }));

    const res = await request(buildApp()).post("/api/faq").send(body);

    expect(res.status).toBe(201);
    expect(res.body.keywordsGenerated).toBe(false);
    expect(res.body.faqEntry.tags).toEqual([]);
    expect(mockCreate).toHaveBeenCalled();
  });

  it("creates with keywordsGenerated:false when the generator returns an empty keyword list", async () => {
    mockGenerateFaqKeywords.mockResolvedValue({ keywords: [] });
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...data }));

    const res = await request(buildApp()).post("/api/faq").send(body);

    expect(res.body.keywordsGenerated).toBe(false);
  });

  it("rejects with 400 when a required field is missing", async () => {
    const res = await request(buildApp()).post("/api/faq").send({ category: "Pricing", question: "Q" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("403s a non-owner", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    const res = await request(buildApp()).post("/api/faq").send(body);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/faq/:id", () => {
  it("updates provided fields on the happy path", async () => {
    mockFindUnique.mockResolvedValue(baseFaq);
    mockUpdate.mockResolvedValue({ ...baseFaq, answer: "New answer" });

    const res = await request(buildApp()).patch("/api/faq/faq_1").send({ answer: "New answer" });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "faq_1" }, data: { answer: "New answer" } });
  });

  it("404s FAQ_NOT_FOUND when the row doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/faq/nope").send({ answer: "x" });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty patch body with 400 (no-op update guard)", async () => {
    const res = await request(buildApp()).patch("/api/faq/faq_1").send({});
    expect(res.status).toBe(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("403s a non-owner", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    const res = await request(buildApp()).patch("/api/faq/faq_1").send({ answer: "x" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/faq/:id", () => {
  it("deletes on the happy path", async () => {
    mockFindUnique.mockResolvedValue(baseFaq);
    mockDelete.mockResolvedValue(baseFaq);

    const res = await request(buildApp()).delete("/api/faq/faq_1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("404s FAQ_NOT_FOUND when the row doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).delete("/api/faq/nope");
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("403s a non-owner", async () => {
    setTestUser({ id: "r-1", email: "r@example.com", name: "R", role: "recruiter" });
    const res = await request(buildApp()).delete("/api/faq/faq_1");
    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
