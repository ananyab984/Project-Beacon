import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import axios from "axios";
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

vi.mock("axios", () => ({
  default: { get: vi.fn() },
}));

const mockTx = {
  client: { findFirst: vi.fn(), create: vi.fn() },
  clientDemand: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  clientDemandService: { upsert: vi.fn() },
  requirement: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};

vi.mock("@server-root/prisma", () => ({
  prisma: {
    sheetSyncConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(mockTx)),
  },
}));

import { prisma } from "@server-root/prisma";
import {
  sheetSyncRouter,
  convertGoogleSheetUrlToCsv,
  parseCsvRows,
  parseDemandsFromCsv,
} from "@server/routes/sheet-sync.routes";

const mockConfigFindUnique = prisma.sheetSyncConfig.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockConfigUpsert = prisma.sheetSyncConfig.upsert as unknown as ReturnType<typeof vi.fn>;
const mockAxiosGet = axios.get as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/sheet-sync", sheetSyncRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  setTestUser({ id: "owner-1", email: "owner@example.com", name: "Owner", role: "owner" });
  mockConfigFindUnique.mockResolvedValue(null);
  mockConfigUpsert.mockResolvedValue({ ownerUserId: "owner-1", sheetUrl: "https://x.com/sheet.csv", lastSyncedAt: new Date() });
  mockTx.client.findFirst.mockResolvedValue(null);
  mockTx.client.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "client-1", ...data }));
  mockTx.clientDemand.findUnique.mockResolvedValue(null);
  mockTx.clientDemand.findFirst.mockResolvedValue(null);
  mockTx.clientDemand.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "demand-1", ...data }));
  mockTx.clientDemand.update.mockImplementation(({ data }: any) => Promise.resolve({ id: "demand-1", ...data }));
  mockTx.clientDemandService.upsert.mockResolvedValue({});
  mockTx.requirement.findFirst.mockResolvedValue(null);
  mockTx.requirement.create.mockResolvedValue({});
  mockTx.requirement.update.mockResolvedValue({});
});

describe("convertGoogleSheetUrlToCsv", () => {
  it("returns empty for a falsy url", () => {
    expect(convertGoogleSheetUrlToCsv("")).toEqual({ csvUrl: "", sheetId: null });
  });

  it("passes through an already-published csv export link unchanged", () => {
    const url = "https://docs.google.com/spreadsheets/d/e/xyz/pub?output=csv";
    expect(convertGoogleSheetUrlToCsv(url)).toEqual({ csvUrl: url, sheetId: "published" });
  });

  it("passes through a url ending in .csv unchanged", () => {
    const url = "https://example.com/data.csv";
    expect(convertGoogleSheetUrlToCsv(url)).toEqual({ csvUrl: url, sheetId: "published" });
  });

  it("converts a normal spreadsheet edit url to a csv export link", () => {
    const url = "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=456";
    expect(convertGoogleSheetUrlToCsv(url)).toEqual({
      csvUrl: "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=456",
      sheetId: "ABC123",
    });
  });

  it("omits the gid param when the url has none", () => {
    const url = "https://docs.google.com/spreadsheets/d/ABC123/edit";
    expect(convertGoogleSheetUrlToCsv(url)).toEqual({
      csvUrl: "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv",
      sheetId: "ABC123",
    });
  });

  it("falls back to the trimmed raw url when it matches neither pattern", () => {
    expect(convertGoogleSheetUrlToCsv("  https://example.com/whatever  ")).toEqual({
      csvUrl: "https://example.com/whatever",
      sheetId: null,
    });
  });

  it("returns an empty csvUrl for a whitespace-only url", () => {
    expect(convertGoogleSheetUrlToCsv("   ")).toEqual({ csvUrl: "", sheetId: null });
  });
});

describe("parseCsvRows", () => {
  it("returns an empty array for empty input", () => {
    expect(parseCsvRows("")).toEqual([]);
  });

  it("splits plain comma-separated rows and trims fields", () => {
    expect(parseCsvRows("a, b ,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("skips blank lines", () => {
    expect(parseCsvRows("a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsvRows('a,"b, and c",d')).toEqual([["a", "b, and c", "d"]]);
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    expect(parseCsvRows('a,"say ""hi""",c')).toEqual([["a", 'say "hi"', "c"]]);
  });
});

describe("parseDemandsFromCsv", () => {
  it("returns an empty array when there's only a header row", () => {
    expect(parseDemandsFromCsv("Client,Language,Service,Headcount")).toEqual([]);
  });

  it("parses a single simple row into one ParsedSheetDemand", () => {
    const csv = "Client,Target Language,Service Type,Headcount Needed\nAcme,German,Dubbing,3";
    const rows = parseDemandsFromCsv(csv, "sheet1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientName: "Acme",
      language: "German",
      service: "Dubbing",
      headcountNeeded: 3,
      priority: "STANDARD",
    });
    expect(rows[0].sheetRowId).toBe("sheet_sheet1_row_1_b1_acme_german_dubbing");
  });

  it("defaults clientName to 'Sample Client' when the column is missing/blank", () => {
    const csv = "Language,Service\nGerman,Dubbing";
    const rows = parseDemandsFromCsv(csv);
    expect(rows[0].clientName).toBe("Sample Client");
  });

  it("skips a row with no language value in block 1", () => {
    const csv = "Client,Language,Service\nAcme,,Dubbing";
    expect(parseDemandsFromCsv(csv)).toEqual([]);
  });

  it("skips a row with fewer than 2 columns", () => {
    const csv = "Client,Language\nOnlyOneCell";
    expect(parseDemandsFromCsv(csv)).toEqual([]);
  });

  it("defaults service to Subtitling and headcount to 1 when those columns are missing/invalid", () => {
    const csv = "Client,Language\nAcme,German";
    const rows = parseDemandsFromCsv(csv);
    expect(rows[0]).toMatchObject({ service: "Subtitling", headcountNeeded: 1 });
  });

  it("clamps a non-numeric or sub-1 headcount to 1", () => {
    const csv = "Client,Language,Headcount\nAcme,German,notanumber";
    const rows = parseDemandsFromCsv(csv);
    expect(rows[0].headcountNeeded).toBe(1);
  });

  it.each([
    ["urgent", "CRITICAL"],
    ["<15 days", "CRITICAL"],
    ["critical", "CRITICAL"],
    ["p0", "CRITICAL"],
    ["high", "HIGH"],
    ["p1", "HIGH"],
    ["normal", "STANDARD"],
  ])("maps priority text %s to %s", (raw, expected) => {
    const csv = `Client,Language,Priority\nAcme,German,${raw}`;
    const rows = parseDemandsFromCsv(csv);
    expect(rows[0].priority).toBe(expected);
  });

  it("splits comma/semicolon/slash-separated languages and services into a cross-product of rows", () => {
    const csv = "Client,Language,Service\nAcme,\"Gujarati, Marathi\",\"Dubbing; CC\"";
    const rows = parseDemandsFromCsv(csv);
    expect(rows).toHaveLength(4);
    const pairs = rows.map((r) => `${r.language}/${r.service}`);
    expect(pairs).toEqual(
      expect.arrayContaining(["Gujarati/Dubbing", "Gujarati/CC", "Marathi/Dubbing", "Marathi/CC"])
    );
  });

  it("builds a combined notes string from content type, go-live, length, episodes and free notes", () => {
    const csv =
      "Client,Language,Content Type,Project Go Live Date,Episode File Length,Number of Episodes,Notes\n" +
      "Acme,German,Trailer,2026-12-01,20,5,Rush job";
    const rows = parseDemandsFromCsv(csv);
    expect(rows[0].notes).toBe(
      "Content Type: Trailer | Go-Live Date: 2026-12-01 | Length: 20 min | Episodes/Files: 5 | Notes: Rush job"
    );
  });

  it("leaves notes undefined when there is nothing to report", () => {
    const csv = "Client,Language\nAcme,German";
    const rows = parseDemandsFromCsv(csv);
    expect(rows[0].notes).toBeUndefined();
  });

  it("parses a second language block only when a block-2 language column is present and filled", () => {
    const csv = "Client,Target Language,Target Language 2\nAcme,German,French";
    const rows = parseDemandsFromCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.language)).toEqual(["German", "French"]);
  });

  it("skips block 2 entirely when its language cell is blank even though the column exists", () => {
    const csv = "Client,Target Language,Target Language 2\nAcme,German,";
    const rows = parseDemandsFromCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it("parses a third language block", () => {
    const csv = "Client,Target Language,Target Language 2,Target Language 3\nAcme,German,French,Italian";
    const rows = parseDemandsFromCsv(csv);
    expect(rows.map((r) => r.language)).toEqual(["German", "French", "Italian"]);
  });
});

describe("GET /api/sheet-sync", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).get("/api/sheet-sync");
    expect(res.status).toBe(403);
  });

  it("returns the null default when the user has no config", async () => {
    mockConfigFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/sheet-sync");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sheetUrl: null, lastSyncedAt: null });
  });

  it("returns the existing config", async () => {
    mockConfigFindUnique.mockResolvedValue({ ownerUserId: "owner-1", sheetUrl: "https://x.com/s.csv", lastSyncedAt: null });
    const res = await request(buildApp()).get("/api/sheet-sync");
    expect(res.body.sheetUrl).toBe("https://x.com/s.csv");
  });
});

describe("PUT /api/sheet-sync", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).put("/api/sheet-sync").send({ sheetUrl: "https://x.com/s.csv" });
    expect(res.status).toBe(403);
  });

  it("400s on an invalid url", async () => {
    const res = await request(buildApp()).put("/api/sheet-sync").send({ sheetUrl: "not-a-url" });
    expect(res.status).toBe(400);
    expect(mockConfigUpsert).not.toHaveBeenCalled();
  });

  it("upserts the sheet url on the happy path", async () => {
    const res = await request(buildApp()).put("/api/sheet-sync").send({ sheetUrl: "https://x.com/s.csv" });
    expect(res.status).toBe(200);
    expect(mockConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserId: "owner-1" },
        update: { sheetUrl: "https://x.com/s.csv" },
        create: { ownerUserId: "owner-1", sheetUrl: "https://x.com/s.csv" },
      })
    );
  });
});

describe("POST /api/sheet-sync/sync", () => {
  it("403s a contractor", async () => {
    setTestUser({ id: "c-1", email: "c@example.com", name: "C", role: "contractor" });
    const res = await request(buildApp()).post("/api/sheet-sync/sync");
    expect(res.status).toBe(403);
  });

  it("400s NO_SHEET_URL when neither body nor config has a url", async () => {
    mockConfigFindUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NO_SHEET_URL");
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it("400s INVALID_SHEET_URL when the resolved url is whitespace-only", async () => {
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_SHEET_URL");
  });

  it("400s with a reason when the sheet returns an HTML sign-in page", async () => {
    mockAxiosGet.mockResolvedValue({ data: "<!DOCTYPE html><html>sign in</html>" });
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });
    expect(res.status).toBe(400);
    expect(res.body.synced).toBe(false);
    expect(res.body.reason).toMatch(/sign-in page/);
  });

  it("400s with the error message when the fetch throws", async () => {
    mockAxiosGet.mockRejectedValue(new Error("network down"));
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ synced: false, reason: "network down" });
  });

  it("returns a zero-row summary when no valid demand rows parse out", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language\nAcme," });
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      synced: true,
      added: 0,
      updated: 0,
      totalRows: 0,
      message: "Sheet was fetched successfully, but no valid client demand data rows were found.",
    });
  });

  it("falls back to the saved config's sheetUrl when the body has none", async () => {
    mockConfigFindUnique.mockResolvedValue({ ownerUserId: "owner-1", sheetUrl: "https://example.com/saved.csv", lastSyncedAt: null });
    mockAxiosGet.mockResolvedValue({ data: "Client,Language\nAcme," });
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({});
    expect(res.status).toBe(200);
    expect(mockAxiosGet).toHaveBeenCalledWith("https://example.com/saved.csv", expect.any(Object));
  });

  it("creates a new client, demand, service breakdown and requirement for a brand-new row", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,3" });
    mockTx.client.findFirst.mockResolvedValue(null);
    mockTx.clientDemand.findUnique.mockResolvedValue(null);
    mockTx.clientDemand.findFirst.mockResolvedValue(null);

    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: true, added: 1, updated: 0, totalRows: 1 });
    expect(mockTx.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Acme" }) })
    );
    expect(mockTx.clientDemand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ language: "German", headcountNeeded: 3, filled: 0, gap: 3 }),
      })
    );
    expect(mockTx.requirement.create).toHaveBeenCalledTimes(1);
    expect(mockConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ sheetUrl: "https://example.com/s.csv" }) })
    );
  });

  it("reuses an existing client instead of creating a duplicate", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,3" });
    mockTx.client.findFirst.mockResolvedValue({ id: "existing-client", name: "Acme" });

    await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(mockTx.client.create).not.toHaveBeenCalled();
    expect(mockTx.clientDemand.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: "existing-client" }) })
    );
  });

  it("updates an existing demand found by sheetRowId and recomputes gap against current filled", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,10" });
    mockTx.client.findFirst.mockResolvedValue({ id: "client-1", name: "Acme" });
    mockTx.clientDemand.findUnique.mockResolvedValue({
      id: "demand-1",
      filled: 4,
      projectName: "Old Project",
      notes: "Old notes",
      serviceBreakdown: [],
    });

    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(res.body).toMatchObject({ added: 0, updated: 1 });
    expect(mockTx.clientDemand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "demand-1" },
        data: expect.objectContaining({ headcountNeeded: 10, gap: 6, projectName: "Old Project" }),
      })
    );
    expect(mockTx.clientDemand.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to matching an existing demand by clientId+language when sheetRowId doesn't match", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,10" });
    mockTx.client.findFirst.mockResolvedValue({ id: "client-1", name: "Acme" });
    mockTx.clientDemand.findUnique.mockResolvedValue(null);
    mockTx.clientDemand.findFirst.mockResolvedValue({ id: "demand-2", filled: 2, serviceBreakdown: [] });

    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(res.body).toMatchObject({ added: 0, updated: 1 });
    expect(mockTx.clientDemand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId: "client-1", language: expect.objectContaining({ equals: "German" }) }) })
    );
  });

  it("clamps the recomputed gap at 0 when the new headcount is below filled", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,1" });
    mockTx.client.findFirst.mockResolvedValue({ id: "client-1", name: "Acme" });
    mockTx.clientDemand.findUnique.mockResolvedValue({ id: "demand-1", filled: 5, serviceBreakdown: [] });

    await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(mockTx.clientDemand.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gap: 0 }) })
    );
  });

  it("also updates the matching Requirement row when one exists for that demand", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,10" });
    mockTx.client.findFirst.mockResolvedValue({ id: "client-1", name: "Acme" });
    mockTx.clientDemand.findUnique.mockResolvedValue({ id: "demand-1", filled: 4, serviceBreakdown: [] });
    mockTx.requirement.findFirst.mockResolvedValue({ id: "req-1", filled: 4, projectName: "Old", notes: "Old" });

    await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(mockTx.requirement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "req-1" }, data: expect.objectContaining({ headcountNeeded: 10, gap: 6 }) })
    );
    expect(mockTx.requirement.create).not.toHaveBeenCalled();
  });

  it("does not create or update a Requirement when updating a demand with no matching requirement", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,10" });
    mockTx.client.findFirst.mockResolvedValue({ id: "client-1", name: "Acme" });
    mockTx.clientDemand.findUnique.mockResolvedValue({ id: "demand-1", filled: 4, serviceBreakdown: [] });
    mockTx.requirement.findFirst.mockResolvedValue(null);

    await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(mockTx.requirement.update).not.toHaveBeenCalled();
    expect(mockTx.requirement.create).not.toHaveBeenCalled();
  });

  it("processes multiple rows and sums added/updated across all of them", async () => {
    mockAxiosGet.mockResolvedValue({
      data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,3\nBeta,French,Subtitling,2",
    });
    mockTx.clientDemand.findUnique.mockResolvedValue(null);
    mockTx.clientDemand.findFirst.mockResolvedValue(null);

    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });

    expect(res.body).toMatchObject({ added: 2, updated: 0, totalRows: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("persists lastSyncedAt on the sheet-sync config after a successful sync", async () => {
    mockAxiosGet.mockResolvedValue({ data: "Client,Language,Service,Headcount\nAcme,German,Dubbing,3" });
    const res = await request(buildApp()).post("/api/sheet-sync/sync").send({ sheetUrl: "https://example.com/s.csv" });
    expect(res.body.lastSyncedAt).toBeTruthy();
    expect(mockConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserId: "owner-1" },
        update: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      })
    );
  });
});
