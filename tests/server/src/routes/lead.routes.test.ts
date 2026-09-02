import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler, notFoundHandler } from "@server/middleware/errorHandler";

// Mutable test-controlled "logged in as" user, read fresh on every request --
// lets each test set a different role/id without re-importing the router.
const { getTestUser, setTestUser } = vi.hoisted(() => {
  let user: { id: string; email: string; name: string; role: string } = {
    id: "owner-1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
  };
  return {
    getTestUser: () => user,
    setTestUser: (u: typeof user) => {
      user = u;
    },
  };
});

vi.mock("@server/middleware/auth", () => ({
  authenticateJwt: (req: any, _res: any, next: any) => {
    req.user = getTestUser();
    next();
  },
}));

vi.mock("@server-root/prisma", () => ({
  prisma: {
    lead: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
      count: vi.fn(),
    },
    emailQueueItem: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    conversation: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    conversationMessage: { deleteMany: vi.fn().mockResolvedValue({}) },
    leadFlagEvent: { create: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}) },
    interactionEvent: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({}) },
    manualActivityLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    stageHistory: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    requirement: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
    clientDemand: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg)),
  },
}));

vi.mock("@server/services/lead.service", () => ({
  findDuplicateLead: vi.fn(),
  getLeadTimeline: vi.fn().mockResolvedValue([]),
  claimLead: vi.fn(),
  buildLeadWhere: vi.fn().mockReturnValue({}),
}));

// enrichLeadById is fire-and-forget (setImmediate) from every create path --
// mocked so no test ever waits on or depends on real enrichment behavior.
vi.mock("@server/jobs/enrichment.job", () => ({
  enrichLeadById: vi.fn().mockResolvedValue(undefined),
}));

// axios.get is only ever hit by POST /import-from-sheet's Google Sheet CSV
// fetch -- mocked so no test makes a real network call.
vi.mock("axios", () => ({
  default: { get: vi.fn() },
}));

import { prisma } from "@server-root/prisma";
import { findDuplicateLead, getLeadTimeline, claimLead, buildLeadWhere } from "@server/services/lead.service";
import { leadRouter, mapSheetRowsToLeads } from "@server/routes/lead.routes";
import axios from "axios";

const mockFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.lead.findMany as unknown as ReturnType<typeof vi.fn>;
const mockCreate = prisma.lead.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.lead.update as unknown as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.lead.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockFindDuplicateLead = findDuplicateLead as unknown as ReturnType<typeof vi.fn>;
const mockClaimLead = claimLead as unknown as ReturnType<typeof vi.fn>;
const mockAxiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;
const mockBuildLeadWhere = buildLeadWhere as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/leads", leadRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const baseLeadRow = {
  id: "lead-1",
  fullName: "Jane Doe",
  displayName: null,
  email: "jane@example.com",
  contactNumber: null,
  profileLink: null,
  services: [],
  flags: [],
  createdByContractorId: null,
  createdByRecruiterId: "owner-1",
  assignedRecruiterId: null,
  source: "LINKEDIN",
  stage: "NEW",
};

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
  mockFindDuplicateLead.mockResolvedValue({ isDuplicate: false, matchedField: null, leadId: null, matchedName: null });
});

describe("GET /api/leads/:id", () => {
  it("returns the lead + timeline on the happy path", async () => {
    mockFindUnique.mockResolvedValue(baseLeadRow);
    (getLeadTimeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ type: "created" }]);

    const res = await request(buildApp()).get("/api/leads/lead-1");

    expect(res.status).toBe(200);
    expect(res.body.lead.id).toBe("lead-1");
    expect(res.body.timeline).toEqual([{ type: "created" }]);
  });

  it("404s when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/leads/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("LEAD_NOT_FOUND");
  });

  it("403s a contractor viewing a lead they didn't submit", async () => {
    setTestUser({ id: "contractor-1", email: "c@example.com", name: "Contractor", role: "contractor" });
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, createdByContractorId: "someone-else" });

    const res = await request(buildApp()).get("/api/leads/lead-1");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("allows a contractor to view their own submitted lead", async () => {
    setTestUser({ id: "contractor-1", email: "c@example.com", name: "Contractor", role: "contractor" });
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, createdByContractorId: "contractor-1" });

    const res = await request(buildApp()).get("/api/leads/lead-1");

    expect(res.status).toBe(200);
  });
});

describe("POST /api/leads (create)", () => {
  const validBody = { fullName: "New Person", source: "LINKEDIN", email: "new@example.com" };

  it("creates a lead on the happy path", async () => {
    mockCreate.mockResolvedValue({ ...baseLeadRow, id: "lead-new", fullName: "New Person" });

    const res = await request(buildApp()).post("/api/leads").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.lead.id).toBe("lead-new");
    expect(res.body.duplicateWarning).toBeNull();
  });

  it("rejects with 400 when fullName is missing (validation failure)", async () => {
    const res = await request(buildApp()).post("/api/leads").send({ source: "LINKEDIN" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects with 400 when source is not a recognized enum value", async () => {
    const res = await request(buildApp()).post("/api/leads").send({ fullName: "X", source: "NOT_A_REAL_SOURCE" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects with 409 when findDuplicateLead reports a match", async () => {
    mockFindDuplicateLead.mockResolvedValue({
      isDuplicate: true,
      matchedField: "email_address",
      leadId: "existing-1",
      matchedName: "Existing Person",
    });

    const res = await request(buildApp()).post("/api/leads").send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("DUPLICATE_LEAD");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("sets ON_HOLD and PENDING when the new lead has no contact info at all", async () => {
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, id: "lead-no-contact" }));

    const res = await request(buildApp()).post("/api/leads").send({ fullName: "No Contact Person", source: "LINKEDIN" });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flags: ["ON_HOLD"], enrichmentStatus: "PENDING" }) })
    );
  });

  it("does not set ON_HOLD when the new lead has an email", async () => {
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, id: "lead-with-contact" }));

    await request(buildApp()).post("/api/leads").send(validBody);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flags: [], enrichmentStatus: "IN_PROGRESS" }) })
    );
  });

  it("attributes createdByContractorId (not createdByRecruiterId) when a contractor creates a lead", async () => {
    setTestUser({ id: "contractor-1", email: "c@example.com", name: "Contractor", role: "contractor" });
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, id: "lead-x" }));

    await request(buildApp()).post("/api/leads").send(validBody);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdByContractorId: "contractor-1", createdByRecruiterId: undefined }),
      })
    );
    // Contractors never get an auto-created email queue item / conversation.
    expect(prisma.emailQueueItem.create).not.toHaveBeenCalled();
  });

  it("403s a role not permitted to create leads at all", async () => {
    setTestUser({ id: "nobody", email: "n@example.com", name: "Nobody", role: "banned-role" as any });
    const res = await request(buildApp()).post("/api/leads").send(validBody);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/leads", () => {
  it("returns a page of leads with a nextCursor when there's more than the page limit", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({ ...baseLeadRow, id: `lead-${i}` }));
    mockFindMany.mockResolvedValue(rows);
    const res = await request(buildApp()).get("/api/leads");
    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(25);
    expect(res.body.nextCursor).toBe("lead-24");
  });

  it("returns nextCursor null when the page isn't full", async () => {
    mockFindMany.mockResolvedValue([baseLeadRow]);
    const res = await request(buildApp()).get("/api/leads");
    expect(res.body.nextCursor).toBeNull();
  });

  it("scopes a contractor's list request to createdByContractorId even though contractors can't hit this route", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/leads");
    expect(res.status).toBe(403);
  });

  it("scopes a recruiter's results to the global identity-resolved pool plus their own assigned/created leads", async () => {
    setTestUser({ id: "rec-1", email: "r@example.com", name: "R", role: "recruiter" });
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/leads");
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([
      { identityResolved: true, enrichmentStatus: "COMPLETE" },
      { assignedRecruiterId: "rec-1" },
      { createdByRecruiterId: "rec-1" },
    ]);
  });

  it("caps the page limit at 100 regardless of a larger requested limit", async () => {
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/leads?limit=500");
    expect(mockFindMany.mock.calls[0][0].take).toBe(101);
  });

  it("passes a cursor through as skip+cursor", async () => {
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/leads?cursor=lead-9");
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({ skip: 1, cursor: { id: "lead-9" } });
  });
});

describe("GET /api/leads/mine", () => {
  it("scopes a contractor to their own submissions", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/leads/mine");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdByContractorId: "c-1" } })
    );
  });

  it("scopes a recruiter to assigned+claimed+created leads", async () => {
    setTestUser({ id: "rec-1", email: "r@example.com", name: "R", role: "recruiter" });
    mockFindMany.mockResolvedValue([]);
    await request(buildApp()).get("/api/leads/mine");
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { assignedRecruiterId: "rec-1" },
      { claimedByRecruiterId: "rec-1" },
      { createdByRecruiterId: "rec-1" },
    ]);
  });
});

describe("GET /api/leads/export", () => {
  it("returns a CSV with a header row and one row per lead", async () => {
    mockFindMany.mockResolvedValue([{ ...baseLeadRow, id: "lead-1", createdAt: "2026-01-01" }]);
    const res = await request(buildApp()).get("/api/leads/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")).toHaveLength(2);
    expect(res.text).toContain("id,fullName,email");
  });

  it("warns (but still returns 200) when the export hits the 5000-row cap", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ ...baseLeadRow, id: `lead-${i}` }));
    mockFindMany.mockResolvedValue(rows);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(buildApp()).get("/api/leads/export");
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("POST /api/leads/check-duplicate", () => {
  it("passes the request body straight through to findDuplicateLead", async () => {
    mockFindDuplicateLead.mockResolvedValue({ isDuplicate: true, matchedField: "email_address", leadId: "x", matchedName: "X" });
    const res = await request(buildApp()).post("/api/leads/check-duplicate").send({ email: "a@b.com" });
    expect(res.status).toBe(200);
    expect(res.body.isDuplicate).toBe(true);
    expect(mockFindDuplicateLead).toHaveBeenCalledWith({ email: "a@b.com", contactNumber: undefined, fullName: undefined });
  });
});

describe("POST /api/leads/check-bulk-duplicates", () => {
  it("flags an intra-batch duplicate by email without querying the DB for that row", async () => {
    const res = await request(buildApp())
      .post("/api/leads/check-bulk-duplicates")
      .send({ leads: [{ fullName: "A", email: "same@x.com" }, { fullName: "B", email: "SAME@x.com" }] });

    expect(res.body.hasDuplicates).toBe(true);
    expect(res.body.duplicateCount).toBe(1);
    expect(res.body.duplicates[0]).toMatchObject({ index: 1, matchedField: "csv_duplicate", existingLeadId: "intra_batch" });
    expect(mockFindDuplicateLead).not.toHaveBeenCalledWith(expect.objectContaining({ email: "SAME@x.com" }));
  });

  it("flags a DB duplicate and looks up the existing lead's display name", async () => {
    mockFindDuplicateLead.mockResolvedValue({ isDuplicate: true, matchedField: "email_address", leadId: "existing-1", matchedName: "X" });
    mockFindUnique.mockResolvedValue({ fullName: "Existing Person", displayName: null });

    const res = await request(buildApp())
      .post("/api/leads/check-bulk-duplicates")
      .send({ leads: [{ fullName: "New", email: "new@x.com" }] });

    expect(res.body.duplicates[0]).toMatchObject({ existingLeadId: "existing-1", existingLeadName: "Existing Person" });
  });

  it("reports newCount/totalCount correctly with a mix of new and duplicate rows", async () => {
    mockFindDuplicateLead
      .mockResolvedValueOnce({ isDuplicate: false })
      .mockResolvedValueOnce({ isDuplicate: true, matchedField: "email_address", leadId: "x", matchedName: "X" });

    const res = await request(buildApp())
      .post("/api/leads/check-bulk-duplicates")
      .send({ leads: [{ fullName: "A", email: "a@x.com" }, { fullName: "B", email: "b@x.com" }] });

    expect(res.body.totalCount).toBe(2);
    expect(res.body.duplicateCount).toBe(1);
    expect(res.body.newCount).toBe(1);
  });

  it("skips a row with no identifying fields at all", async () => {
    const res = await request(buildApp()).post("/api/leads/check-bulk-duplicates").send({ leads: [{}] });
    expect(res.body.totalCount).toBe(1);
    expect(res.body.duplicateCount).toBe(0);
    expect(mockFindDuplicateLead).not.toHaveBeenCalled();
  });
});

describe("POST /api/leads/bulk", () => {
  const rows = [{ fullName: "Row One", source: "LINKEDIN", email: "one@x.com" }];

  it("creates every non-duplicate row and reports accepted status", async () => {
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, id: "lead-bulk-1" }));
    const res = await request(buildApp()).post("/api/leads/bulk").send({ leads: rows });
    expect(res.status).toBe(201);
    expect(res.body.results).toEqual([{ index: 0, status: "accepted", leadId: "lead-bulk-1" }]);
  });

  it("reports duplicate status for a row findDuplicateLead matches, without creating it", async () => {
    mockFindDuplicateLead.mockResolvedValue({ isDuplicate: true, matchedField: "email_address", matchedName: "X" });
    const res = await request(buildApp()).post("/api/leads/bulk").send({ leads: rows });
    expect(res.body.results[0].status).toBe("duplicate");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("flags an intra-batch duplicate pair without a second DB lookup", async () => {
    const twoRows = [
      { fullName: "Same", source: "LINKEDIN", email: "same@x.com" },
      { fullName: "Same", source: "LINKEDIN", email: "same@x.com" },
    ];
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, id: "lead-x" }));
    const res = await request(buildApp()).post("/api/leads/bulk").send({ leads: twoRows });
    expect(res.body.results[0].status).toBe("accepted");
    expect(res.body.results[1].status).toBe("duplicate");
  });

  it("isolates a per-row failure as an 'error' result without aborting the rest of the batch", async () => {
    mockCreate.mockRejectedValueOnce(new Error("db exploded")).mockImplementationOnce(({ data }: any) =>
      Promise.resolve({ ...baseLeadRow, ...data, id: "lead-ok" })
    );
    const twoRows = [
      { fullName: "Fails", source: "LINKEDIN", email: "fail@x.com" },
      { fullName: "Works", source: "LINKEDIN", email: "works@x.com" },
    ];
    const res = await request(buildApp()).post("/api/leads/bulk").send({ leads: twoRows });
    expect(res.body.results[0]).toMatchObject({ status: "error", message: "db exploded" });
    expect(res.body.results[1]).toMatchObject({ status: "accepted" });
  });

  it("rejects a batch over the 2000-row cap", async () => {
    const tooMany = Array.from({ length: 2001 }, (_, i) => ({ fullName: `P${i}`, source: "LINKEDIN" }));
    const res = await request(buildApp()).post("/api/leads/bulk").send({ leads: tooMany });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/leads/import-from-sheet", () => {
  const sheetUrl = "https://docs.google.com/spreadsheets/d/abc123/edit";

  it("400s (SHEET_FETCH_FAILED) for a non-Google-Sheets URL, since convertGoogleSheetUrlToCsv falls back to treating it as a direct CSV link and the fetch then fails", async () => {
    mockAxiosGet.mockRejectedValue(new Error("not found"));
    const res = await request(buildApp()).post("/api/leads/import-from-sheet").send({ sheetUrl: "https://example.com/not-a-sheet" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("SHEET_FETCH_FAILED");
  });

  it("400s (SHEET_FETCH_FAILED) when the CSV fetch rejects", async () => {
    mockAxiosGet.mockRejectedValue(new Error("network down"));
    const res = await request(buildApp()).post("/api/leads/import-from-sheet").send({ sheetUrl });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("SHEET_FETCH_FAILED");
  });

  it("400s when the sheet isn't public and returns an HTML sign-in page", async () => {
    mockAxiosGet.mockResolvedValue({ data: "<!DOCTYPE html><html>sign in</html>" });
    const res = await request(buildApp()).post("/api/leads/import-from-sheet").send({ sheetUrl });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("SHEET_FETCH_FAILED");
  });

  it("200s with an empty result set and an explanatory message when no row has a recognizable header", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Foo,Bar\n1,2" });
    const res = await request(buildApp()).post("/api/leads/import-from-sheet").send({ sheetUrl });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.message).toContain("no rows matched");
  });

  it("parses valid sheet rows and creates leads through the same ingestion path as /bulk", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Full Name,Email,Target Language\nJane Doe,jane@x.com,German" });
    mockCreate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, id: "lead-sheet-1" }));
    const res = await request(buildApp()).post("/api/leads/import-from-sheet").send({ sheetUrl });
    expect(res.status).toBe(201);
    expect(res.body.results[0]).toMatchObject({ status: "accepted", leadId: "lead-sheet-1" });
  });
});

describe("mapSheetRowsToLeads", () => {
  it("maps recognized headers regardless of case/punctuation, defaulting language to English", () => {
    const rows = [
      ["Full Name", "Email", "Contact #"],
      ["Jane Doe", "jane@x.com", "555-1234"],
    ];
    const leads = mapSheetRowsToLeads(rows);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ fullName: "Jane Doe", email: "jane@x.com", sourceLanguage: "English", targetLanguage: "English" });
  });

  it("skips a row with no name at all", () => {
    const rows = [["Full Name", "Email"], ["", "noname@x.com"]];
    expect(mapSheetRowsToLeads(rows)).toEqual([]);
  });

  it("returns an empty array for a header-only (or empty) sheet", () => {
    expect(mapSheetRowsToLeads([["Full Name", "Email"]])).toEqual([]);
    expect(mapSheetRowsToLeads([])).toEqual([]);
  });
});

describe("PATCH /api/leads/bulk", () => {
  it("400s (NO_OP) when neither stage nor recruiterId is provided", async () => {
    const res = await request(buildApp())
      .patch("/api/leads/bulk")
      .send({ ids: ["11111111-1111-4111-8111-111111111111"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NO_OP");
  });

  it("logs a StageHistory row per id and bulk-updates stage", async () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const res = await request(buildApp()).patch("/api/leads/bulk").send({ ids, stage: "CONTACTED" });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(prisma.stageHistory.create).toHaveBeenCalledTimes(2);
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ids } }, data: { stage: "CONTACTED" } });
  });

  it("bulk-reassigns recruiterId without touching stage", async () => {
    const ids = ["11111111-1111-4111-8111-111111111111"];
    await request(buildApp()).patch("/api/leads/bulk").send({ ids, recruiterId: "22222222-2222-4222-8222-222222222222" });
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedRecruiterId: "22222222-2222-4222-8222-222222222222" }) })
    );
    expect(prisma.stageHistory.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/leads/:id", () => {
  it("404s when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).patch("/api/leads/lead-1").send({ displayName: "X" });
    expect(res.status).toBe(404);
  });

  it("403s a contractor editing a lead they didn't submit", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, createdByContractorId: "someone-else" });
    const res = await request(buildApp()).patch("/api/leads/lead-1").send({ displayName: "X" });
    expect(res.status).toBe(403);
  });

  it("merges an added flag with the lead's existing flags instead of replacing them (regression: flag-clobber bug)", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, flags: ["DNC"], enrichmentStatus: "PENDING", email: null, contactNumber: null, profileLink: null });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));

    const res = await request(buildApp()).patch("/api/leads/lead-1").send({ flags: ["WATCHING"] });

    expect(res.status).toBe(200);
    const savedFlags: string[] = mockUpdate.mock.calls[0][0].data.flags;
    expect(savedFlags.sort()).toEqual(["DNC", "WATCHING"]);
  });

  it("drops ON_HOLD once the lead becomes complete (has contact info), never re-adding it", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, flags: ["ON_HOLD"], enrichmentStatus: "PENDING", email: null, contactNumber: null, profileLink: null });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));

    const res = await request(buildApp()).patch("/api/leads/lead-1").send({ email: "found@x.com" });

    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.flags).toEqual([]);
    expect(data.enrichmentStatus).toBe("COMPLETE");
    expect(data.identityResolved).toBe(true);
  });

  it("requires a closureReason when moving a lead to COLD", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, stage: "CONTACTED" });
    const res = await request(buildApp()).patch("/api/leads/lead-1").send({ stage: "COLD" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("REASON_REQUIRED");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("logs a StageHistory row when stage actually changes", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, stage: "CONTACTED" });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));
    await request(buildApp()).patch("/api/leads/lead-1").send({ stage: "COLD", closureReason: "unresponsive" });
    expect(prisma.stageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStage: "CONTACTED", toStage: "COLD", reason: "unresponsive" }) })
    );
  });

  it("does not log StageHistory when stage is unchanged", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, stage: "CONTACTED" });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));
    await request(buildApp()).patch("/api/leads/lead-1").send({ displayName: "New Name" });
    expect(prisma.stageHistory.create).not.toHaveBeenCalled();
  });

  it("increments a matching Requirement's filled count and clamps gap at 0 when a lead moves to ONBOARDED", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, stage: "NEGOTIATING", targetLanguage: "German" });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, targetLanguage: "German" }));
    (prisma.requirement.findFirst as any).mockResolvedValue({ id: "req-1", clientId: "client-1", headcountNeeded: 3, filled: 2, gap: 1, status: "ACTIVE" });
    (prisma.clientDemand.findFirst as any).mockResolvedValue({ id: "demand-1", headcountNeeded: 3, filled: 2, gap: 1 });

    await request(buildApp()).patch("/api/leads/lead-1").send({ stage: "ONBOARDED" });

    expect(prisma.requirement.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { filled: 3, gap: 0, status: "FULFILLED" },
    });
    expect(prisma.clientDemand.update).toHaveBeenCalledWith({
      where: { id: "demand-1" },
      data: { filled: 3, gap: 0 },
    });
  });

  it("decrements a Requirement's filled count when a lead moves OFF ONBOARDED, never going below 0", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, stage: "ONBOARDED", targetLanguage: "German" });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, targetLanguage: "German" }));
    (prisma.requirement.findFirst as any).mockResolvedValue({ id: "req-1", clientId: "client-1", headcountNeeded: 3, filled: 0, gap: 3, status: "FULFILLED" });
    (prisma.clientDemand.findFirst as any).mockResolvedValue(null);

    await request(buildApp()).patch("/api/leads/lead-1").send({ stage: "COLD", closureReason: "left" });

    expect(prisma.requirement.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { filled: 0, gap: 3, status: "ACTIVE" },
    });
  });

  it("also decrements the matching ClientDemand's filled count when a lead moves off ONBOARDED", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, stage: "ONBOARDED", targetLanguage: "German" });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data, targetLanguage: "German" }));
    (prisma.requirement.findFirst as any).mockResolvedValue({ id: "req-1", clientId: "client-1", headcountNeeded: 3, filled: 1, gap: 2, status: "ACTIVE" });
    (prisma.clientDemand.findFirst as any).mockResolvedValue({ id: "demand-1", headcountNeeded: 3, filled: 1, gap: 2 });

    await request(buildApp()).patch("/api/leads/lead-1").send({ stage: "COLD", closureReason: "left" });

    expect(prisma.clientDemand.update).toHaveBeenCalledWith({
      where: { id: "demand-1" },
      data: { filled: 0, gap: 3 },
    });
  });

  it("includes years-of-experience in the regenerated draft's enrichment note", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, targetLanguage: null, yearsOfExperience: null });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));
    (prisma.emailQueueItem.findMany as any).mockResolvedValue([{ id: "item-1", candidateName: "Jane Doe", candidateRole: "German" }]);

    await request(buildApp()).patch("/api/leads/lead-1").send({ targetLanguage: "German", yearsOfExperience: 5 });

    expect(prisma.emailQueueItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: expect.stringContaining("5 years of experience") }) })
    );
  });

  it("regenerates queued email-draft subject/body when identity-resolving fields change", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, targetLanguage: null });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));
    (prisma.emailQueueItem.findMany as any).mockResolvedValue([{ id: "item-1", candidateName: "Jane Doe", candidateRole: "German" }]);

    await request(buildApp()).patch("/api/leads/lead-1").send({ targetLanguage: "German" });

    expect(prisma.emailQueueItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" }, data: expect.objectContaining({ subject: expect.stringContaining("Jane Doe") }) })
    );
  });
});

describe("POST /api/leads/:id/claim", () => {
  it("returns the claimed lead", async () => {
    mockClaimLead.mockResolvedValue({ ...baseLeadRow, claimedByRecruiterId: "owner-1" });
    const res = await request(buildApp()).post("/api/leads/lead-1/claim");
    expect(res.status).toBe(200);
    expect(mockClaimLead).toHaveBeenCalledWith("lead-1", "owner-1");
  });
});

describe("POST /api/leads/:id/flags", () => {
  it("404s when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/leads/lead-1/flags").send({ flag: "DNC" });
    expect(res.status).toBe(404);
  });

  it("adds a flag, merging with any existing flags", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, flags: ["WATCHING"] });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));
    const res = await request(buildApp()).post("/api/leads/lead-1/flags").send({ flag: "DNC" });
    expect(res.status).toBe(201);
    expect(res.body.lead.flags.sort()).toEqual(["DNC", "WATCHING"]);
  });

  it("marks a provisional DNC flag event as PROVISIONAL, not CONFIRMED", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, flags: [] });
    mockUpdate.mockResolvedValue({ ...baseLeadRow, flags: ["DNC"] });
    await request(buildApp()).post("/api/leads/lead-1/flags").send({ flag: "DNC", provisional: true });
    expect(prisma.leadFlagEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROVISIONAL" }) })
    );
  });
});

describe("DELETE /api/leads/:id/flags/:flag", () => {
  it("400s on an unrecognized flag", async () => {
    const res = await request(buildApp()).delete("/api/leads/lead-1/flags/NOT_A_FLAG");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_FLAG");
  });

  it("404s when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).delete("/api/leads/lead-1/flags/DNC");
    expect(res.status).toBe(404);
  });

  it("removes the flag and logs a REMOVED flag event", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, flags: ["DNC", "WATCHING"] });
    mockUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...baseLeadRow, ...data }));
    const res = await request(buildApp()).delete("/api/leads/lead-1/flags/DNC");
    expect(res.status).toBe(200);
    expect(res.body.lead.flags).toEqual(["WATCHING"]);
    expect(prisma.leadFlagEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flag: "DNC", action: "REMOVED" }) })
    );
  });
});

describe("POST /api/leads/:id/activities", () => {
  it("404s when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/leads/lead-1/activities")
      .send({ type: "INTERVIEW", scheduledAt: "2026-06-01T10:00:00.000Z" });
    expect(res.status).toBe(404);
  });

  it("logs an INTERVIEW activity with notes", async () => {
    mockFindUnique.mockResolvedValue(baseLeadRow);
    const res = await request(buildApp())
      .post("/api/leads/lead-1/activities")
      .send({ type: "INTERVIEW", scheduledAt: "2026-06-01T10:00:00.000Z", notes: "Went well" });
    expect(res.status).toBe(201);
    expect(prisma.manualActivityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "INTERVIEW", notes: "Went well" }) })
    );
  });

  it("logs a CALL activity, joining purpose and outcome into notes", async () => {
    mockFindUnique.mockResolvedValue(baseLeadRow);
    await request(buildApp())
      .post("/api/leads/lead-1/activities")
      .send({ type: "CALL", scheduledAt: "2026-06-01T10:00:00.000Z", purpose: "screen", outcome: "positive" });
    expect(prisma.manualActivityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "CALL", notes: "screen - positive" }) })
    );
  });

  it("400s on an unrecognized activity type", async () => {
    mockFindUnique.mockResolvedValue(baseLeadRow);
    const res = await request(buildApp())
      .post("/api/leads/lead-1/activities")
      .send({ type: "PARTY", scheduledAt: "2026-06-01T10:00:00.000Z" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/leads/:id/retry-enrichment", () => {
  it("404s when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/leads/lead-1/retry-enrichment");
    expect(res.status).toBe(404);
  });

  it("409s (ALREADY_RUNNING) when enrichment is currently IN_PROGRESS", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, enrichmentStatus: "IN_PROGRESS" });
    const res = await request(buildApp()).post("/api/leads/lead-1/retry-enrichment");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_RUNNING");
  });

  it("resets a stalled lead back to PENDING", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLeadRow, enrichmentStatus: "FLAGGED_REVIEW" });
    mockUpdate.mockResolvedValue({ ...baseLeadRow, enrichmentStatus: "PENDING" });
    const res = await request(buildApp()).post("/api/leads/lead-1/retry-enrichment");
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { enrichmentStatus: "PENDING" } });
  });
});

describe("POST /api/leads/batch-delete", () => {
  it("short-circuits to deletedCount 0 without a transaction for an empty id list", async () => {
    const res = await request(buildApp()).post("/api/leads/batch-delete").send({ leadIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("cascades deletes across every dependent table in one transaction", async () => {
    const res = await request(buildApp()).post("/api/leads/batch-delete").send({ leadIds: ["lead-1", "lead-2"] });
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(2);
    expect(prisma.emailQueueItem.deleteMany).toHaveBeenCalled();
    expect(prisma.conversationMessage.deleteMany).toHaveBeenCalled();
    expect(prisma.conversation.deleteMany).toHaveBeenCalled();
    expect(prisma.leadFlagEvent.deleteMany).toHaveBeenCalled();
    expect(prisma.interactionEvent.deleteMany).toHaveBeenCalled();
    expect(prisma.lead.deleteMany).toHaveBeenCalled();
  });
});
