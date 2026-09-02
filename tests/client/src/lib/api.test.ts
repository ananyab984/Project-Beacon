import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/neon-auth", () => ({
  getNeonToken: vi.fn(),
}));

import { getNeonToken } from "@/lib/neon-auth";
import { api } from "@/lib/api";

function jsonResponse(body: any, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  };
}

function textResponse(body: string, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    headers: { get: () => null },
    text: async () => body,
  };
}

describe("api", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(getNeonToken).mockResolvedValue(null);
  });

  describe("request()", () => {
    it("builds URL from API_BASE_URL and path", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads();
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/leads$/);
    });

    it("attaches Authorization header when a token is available", async () => {
      vi.mocked(getNeonToken).mockResolvedValue("tok123");
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads();
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options!.headers as any).Authorization).toBe("Bearer tok123");
    });

    it("omits Authorization header when there is no token", async () => {
      vi.mocked(getNeonToken).mockResolvedValue(null);
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads();
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options!.headers as any).Authorization).toBeUndefined();
    });

    it("sets Content-Type only when a body is present", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {} }) as any);
      await api.createLead({ fullName: "A", source: "x" } as any);
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options!.headers as any)["Content-Type"]).toBe("application/json");
    });

    it("does not set Content-Type for bodyless GET requests", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads();
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options!.headers as any)["Content-Type"]).toBeUndefined();
    });

    it("parses a JSON response body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [{ id: "1" }], nextCursor: "c1" }) as any);
      const result = await api.getLeads();
      expect(result).toEqual({ leads: [{ id: "1" }], nextCursor: "c1" });
    });

    it("parses a non-JSON response body as text", async () => {
      vi.mocked(fetch).mockResolvedValue(textResponse("plain text ok") as any);
      const result = await api.getLeads();
      expect(result).toBe("plain text ok");
    });

    it("throws an ApiRequestError with message/code/status on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ message: "Bad input", error: "VALIDATION_ERROR" }, { status: 400, ok: false }) as any
      );
      await expect(api.getLeads()).rejects.toMatchObject({
        message: "Bad input",
        code: "VALIDATION_ERROR",
        status: 400,
      });
    });

    it("falls back to a generic message when the error body has no message", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}, { status: 500, ok: false }) as any);
      await expect(api.getLeads()).rejects.toThrow("Request failed (500)");
    });

    it("tolerates a non-JSON error response, defaulting error data to {}", async () => {
      vi.mocked(fetch).mockResolvedValue(textResponse("Internal Server Error", { status: 500, ok: false }) as any);
      await expect(api.getLeads()).rejects.toMatchObject({ status: 500 });
    });

    it("tolerates a JSON body that fails to parse", async () => {
      const res = {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => {
          throw new Error("invalid json");
        },
      };
      vi.mocked(fetch).mockResolvedValue(res as any);
      const result = await api.getLeads();
      expect(result).toEqual({});
    });
  });

  describe("API_BASE_URL trailing-slash normalization", () => {
    it("does not produce a double slash when VITE_API_BASE_URL has a trailing slash", async () => {
      // API_BASE_URL is computed once at module-load time from import.meta.env,
      // so this exercises the regex directly the same way the module does.
      const withTrailingSlash = "https://api.example.com/";
      const normalized = withTrailingSlash.replace(/\/+$/, "");
      expect(normalized).toBe("https://api.example.com");
      expect(`${normalized}/api/leads`).toBe("https://api.example.com/api/leads");
    });

    it("strips multiple trailing slashes", () => {
      expect("https://api.example.com///".replace(/\/+$/, "")).toBe("https://api.example.com");
    });

    it("built request URL never contains a double slash before /api", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads();
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url as string).not.toMatch(/[^:]\/\/api/);
    });
  });

  describe("qs()", () => {
    it("builds a query string, skipping undefined/null/empty values", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads({ q: "foo", stage: undefined, country: "", limit: 5 });
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain("q=foo");
      expect(url).toContain("limit=5");
      expect(url).not.toContain("stage=");
      expect(url).not.toContain("country=");
    });

    it("returns empty string suffix when no filters given", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [], nextCursor: null }) as any);
      await api.getLeads({});
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/leads$/);
    });
  });

  describe("leads", () => {
    it("getMyLeads hits /api/leads/mine", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ leads: [] }) as any);
      await api.getMyLeads();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/mine$/);
    });

    it("getLead hits /api/leads/:id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {}, timeline: [] }) as any);
      await api.getLead("42");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/42$/);
    });

    it("createLead POSTs with JSON body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {}, duplicateWarning: null }) as any);
      await api.createLead({ fullName: "Jane", source: "referral" });
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(options!.method).toBe("POST");
      expect(JSON.parse(options!.body as string)).toEqual({ fullName: "Jane", source: "referral" });
    });

    it("updateLead PATCHes", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {} }) as any);
      await api.updateLead("1", { stage: "CONTACTED" } as any);
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(options!.method).toBe("PATCH");
    });

    it("bulkUpdateLeads merges ids and patch into the body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ updated: 2 }) as any);
      await api.bulkUpdateLeads(["a", "b"], { stage: "NEW" });
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ ids: ["a", "b"], stage: "NEW" });
    });

    it("deleteLeads POSTs to batch-delete", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ deletedCount: 3 }) as any);
      await api.deleteLeads(["a"]);
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/batch-delete$/);
    });

    it("claimLead POSTs to /claim", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {} }) as any);
      await api.claimLead("9");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/9\/claim$/);
    });

    it("addLeadFlag includes reason and provisional in body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {} }) as any);
      await api.addLeadFlag("9", "DNC", "requested", true);
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ flag: "DNC", reason: "requested", provisional: true });
    });

    it("removeLeadFlag issues DELETE to /flags/:flag", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {} }) as any);
      await api.removeLeadFlag("9", "DNC");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/flags\/DNC$/);
      expect(options!.method).toBe("DELETE");
    });
  });

  describe("downloadLeadsExport", () => {
    it("throws when the export request fails", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as any);
      await expect(api.downloadLeadsExport()).rejects.toThrow("Export failed (500)");
    });

    it("triggers a client-side download on success", async () => {
      const blob = new Blob(["csv,data"]);
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, blob: async () => blob } as any);

      const createObjectURL = vi.fn(() => "blob:mock");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

      const clickSpy = vi.fn();
      const anchor = { href: "", download: "", click: clickSpy } as any;
      const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue(anchor);

      await api.downloadLeadsExport({ stage: "NEW" });

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(anchor.download).toBe("leads_export.csv");
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

      createElementSpy.mockRestore();
    });

    it("attaches Authorization header on the export request when a token exists", async () => {
      vi.mocked(getNeonToken).mockResolvedValue("export-tok");
      const blob = new Blob(["csv"]);
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, blob: async () => blob } as any);
      vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
      vi.spyOn(document, "createElement").mockReturnValue({ href: "", download: "", click: vi.fn() } as any);

      await api.downloadLeadsExport();
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options!.headers as any).Authorization).toBe("Bearer export-tok");
    });
  });

  describe("users", () => {
    it("getUsers includes role in query string", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ users: [] }) as any);
      await api.getUsers("RECRUITER");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\?role=RECRUITER$/);
    });

    it("deactivateUser issues DELETE", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ user: {} }) as any);
      await api.deactivateUser("5");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(options!.method).toBe("DELETE");
    });

    it("assignContractor POSTs recruiterId in body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.assignContractor("c1", "r1");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ recruiterId: "r1" });
    });
  });

  describe("clients & requirements", () => {
    it("getClients hits /api/clients", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ clients: [] }) as any);
      await api.getClients();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/clients$/);
    });

    it("deleteClient issues DELETE", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, message: "ok" }) as any);
      await api.deleteClient("1");
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("DELETE");
    });

    it("createRequirements sends clientId and items", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ requirements: [] }) as any);
      await api.createRequirements("c1", [{ title: "t", language: "en", service: "s", headcountNeeded: 1, priority: "HIGH" }]);
      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options!.body as string);
      expect(body.clientId).toBe("c1");
      expect(body.items).toHaveLength(1);
    });

    it("assignRequirement allows a null recruiterId", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ requirement: {} }) as any);
      await api.assignRequirement("r1", null, "unassigning");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ recruiterId: null, note: "unassigning" });
    });
  });

  describe("sheet sync", () => {
    it("setSheetSyncUrl issues PUT", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.setSheetSyncUrl("https://sheet.example.com");
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("PUT");
    });

    it("triggerSheetSync POSTs with no body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ synced: true }) as any);
      await api.triggerSheetSync();
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(options!.method).toBe("POST");
      expect(options!.body).toBeUndefined();
    });
  });

  describe("email queue", () => {
    it("addToEmailQueue sends leadId", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ item: {} }) as any);
      await api.addToEmailQueue("lead1");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ leadId: "lead1" });
    });

    it("sendEmailQueueItem includes channel and payload", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }) as any);
      await api.sendEmailQueueItem("q1", { body: "hi", channel: "EMAIL", to: "a@b.com" });
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/email-queue\/q1\/send$/);
      expect(JSON.parse(options!.body as string)).toMatchObject({ channel: "EMAIL", to: "a@b.com" });
    });

    it("batchSendEmailQueue sends ids array", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ results: [] }) as any);
      await api.batchSendEmailQueue(["1", "2"]);
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ ids: ["1", "2"] });
    });
  });

  describe("conversations", () => {
    it("getConversationByLead omits channel query param when not given", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ conversation: null, messages: [] }) as any);
      await api.getConversationByLead("lead1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/by-lead\/lead1$/);
    });

    it("getConversationByLead includes channel query param when given", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ conversation: null, messages: [] }) as any);
      await api.getConversationByLead("lead1", "LINKEDIN");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/by-lead\/lead1\?channel=LINKEDIN$/);
    });

    it("sendConversationMessage includes optional fields in body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.sendConversationMessage("c1", "hello", "acc1", "to@x.com", "msg1");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({
        text: "hello", accountId: "acc1", to: "to@x.com", replyToMessageId: "msg1",
      });
    });
  });

  describe("unipile / outreach", () => {
    it("connectAccount defaults clientUrl to window.location.origin", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ url: "https://x" }) as any);
      await api.connectAccount("linkedin");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(options!.body as string);
      expect(body.clientUrl).toBe(window.location.origin);
    });

    it("connectAccount uses an explicit clientUrl when given", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ url: "https://x" }) as any);
      await api.connectAccount("linkedin", "https://custom.example.com");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string).clientUrl).toBe("https://custom.example.com");
    });

    it("getConnectedAccounts returns the accounts array on success", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ accounts: [{ id: "a1" }] }) as any);
      const result = await api.getConnectedAccounts();
      expect(result).toEqual([{ id: "a1" }]);
    });

    it("getConnectedAccounts returns [] when the request fails", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}, { status: 500, ok: false }) as any);
      const result = await api.getConnectedAccounts();
      expect(result).toEqual([]);
    });

    it("getConnectedAccounts returns [] when accounts is missing from the response", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      const result = await api.getConnectedAccounts();
      expect(result).toEqual([]);
    });

    it("disconnectAccount issues DELETE", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }) as any);
      await api.disconnectAccount("acc1");
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("DELETE");
    });

    it("sendOutreach POSTs the full payload", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      const payload = { leadId: "l1", channel: "EMAIL" as const, body: "hi" };
      await api.sendOutreach(payload);
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual(payload);
    });
  });

  describe("reports & analytics", () => {
    it("getReportsAnalytics defaults range to 30d", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.getReportsAnalytics();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/range=30d$/);
    });

    it("getReportsAnalytics accepts a custom range", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.getReportsAnalytics("7d");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/range=7d$/);
    });

    it("getOutreachFunnel defaults range to 30d", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.getOutreachFunnel();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/range=30d$/);
    });

    it("getReportExportUrl returns a relative path without making a request", () => {
      expect(api.getReportExportUrl("csv")).toBe("/api/reports/export/csv");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("remaining leads endpoints", () => {
    it("bulkCreateLeads sends leads and skipDuplicates", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ results: [] }) as any);
      await api.bulkCreateLeads([{ fullName: "A", source: "x" }], { skipDuplicates: true });
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/leads\/bulk$/);
      expect(JSON.parse(options!.body as string)).toEqual({ leads: [{ fullName: "A", source: "x" }], skipDuplicates: true });
    });

    it("importLeadsFromSheet POSTs the sheetUrl", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ results: [] }) as any);
      await api.importLeadsFromSheet("https://sheet.example.com");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/leads\/import-from-sheet$/);
      expect(JSON.parse(options!.body as string)).toEqual({ sheetUrl: "https://sheet.example.com" });
    });

    it("checkBulkDuplicateLeads POSTs the leads array", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ hasDuplicates: false }) as any);
      await api.checkBulkDuplicateLeads([{ fullName: "A" }]);
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/check-bulk-duplicates$/);
    });

    it("checkDuplicateLead POSTs the input", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ isDuplicate: false, matchedField: null, leadId: null }) as any);
      await api.checkDuplicateLead({ email: "a@b.com" });
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/check-duplicate$/);
    });

    it("logLeadActivity POSTs the activity payload", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.logLeadActivity("1", { type: "CALL", scheduledAt: "2026-01-01", outcome: "connected" });
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/leads\/1\/activities$/);
      expect(JSON.parse(options!.body as string).type).toBe("CALL");
    });

    it("retryLeadEnrichment POSTs to /retry-enrichment", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ lead: {} }) as any);
      await api.retryLeadEnrichment("1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/leads\/1\/retry-enrichment$/);
    });
  });

  describe("remaining users endpoints", () => {
    it("createUser POSTs the input", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ user: {} }) as any);
      await api.createUser({ name: "A", email: "a@b.com", role: "RECRUITER" as any });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("POST");
    });

    it("updateUserLanguages PATCHes languages", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ user: {} }) as any);
      await api.updateUserLanguages("1", ["en", "fr"]);
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/users\/1\/languages$/);
      expect(JSON.parse(options!.body as string)).toEqual({ languages: ["en", "fr"] });
    });

    it("unassignContractor issues DELETE", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.unassignContractor("c1");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/users\/c1\/contractor-assignment$/);
      expect(options!.method).toBe("DELETE");
    });
  });

  describe("remaining clients/requirements endpoints", () => {
    it("getClient hits /api/clients/:id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ client: {} }) as any);
      await api.getClient("1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/clients\/1$/);
    });

    it("createClient POSTs the input", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ client: {} }) as any);
      await api.createClient({ name: "Acme" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("POST");
    });

    it("updateClient PATCHes the patch", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ client: {} }) as any);
      await api.updateClient("1", { name: "New" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("PATCH");
    });

    it("getRequirements applies filters", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ requirements: [] }) as any);
      await api.getRequirements({ clientId: "c1" });
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/clientId=c1/);
    });

    it("getRequirement hits /api/requirements/:id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ requirement: {} }) as any);
      await api.getRequirement("1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/requirements\/1$/);
    });

    it("getRequirementHistory hits /history", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ assignments: [] }) as any);
      await api.getRequirementHistory("1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/requirements\/1\/history$/);
    });

    it("updateRequirement PATCHes the patch", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ requirement: {} }) as any);
      await api.updateRequirement("1", { status: "OPEN" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("PATCH");
    });

    it("deleteRequirement issues DELETE", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, message: "ok" }) as any);
      await api.deleteRequirement("1");
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("DELETE");
    });
  });

  describe("remaining client-demand endpoints", () => {
    it("getClientDemands hits /api/client-demands", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ clientDemands: [] }) as any);
      await api.getClientDemands();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/client-demands$/);
    });

    it("getClientDemand hits /api/client-demands/:id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ clientDemand: {} }) as any);
      await api.getClientDemand("1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/client-demands\/1$/);
    });

    it("createClientDemand POSTs the input", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ clientDemand: {}, requirements: [] }) as any);
      await api.createClientDemand({ clientName: "Acme", language: "en", services: [], priority: "HIGH" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("POST");
    });

    it("updateClientDemand PATCHes the patch", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ clientDemand: {} }) as any);
      await api.updateClientDemand("1", { priority: "LOW" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("PATCH");
    });

    it("deleteClientDemand issues DELETE", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, message: "ok" }) as any);
      await api.deleteClientDemand("1");
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("DELETE");
    });
  });

  describe("remaining sheet-sync / email-queue / conversation endpoints", () => {
    it("getSheetSync hits /api/sheet-sync", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.getSheetSync();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/sheet-sync$/);
    });

    it("getEmailQueue hits /api/email-queue", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ items: [] }) as any);
      await api.getEmailQueue();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/email-queue$/);
    });

    it("updateEmailQueueItem PATCHes the patch", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ item: {} }) as any);
      await api.updateEmailQueueItem("1", { subject: "Hi" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("PATCH");
    });

    it("generateEmailDraft POSTs an optional to address", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ item: {} }) as any);
      await api.generateEmailDraft("1", "a@b.com");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/email-queue\/1\/generate-draft$/);
      expect(JSON.parse(options!.body as string)).toEqual({ to: "a@b.com" });
    });

    it("getConversations hits /api/conversations", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ conversations: [] }) as any);
      await api.getConversations();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/conversations$/);
    });

    it("getConversation hits /api/conversations/:id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ conversation: {} }) as any);
      await api.getConversation("1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/conversations\/1$/);
    });

    it("createConversation POSTs the leadId", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ conversation: {} }) as any);
      await api.createConversation("lead1");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ leadId: "lead1" });
    });

    it("generateLinkedInDraft POSTs with no body", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ draft: { body: "hi" } }) as any);
      await api.generateLinkedInDraft("1");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/conversations\/1\/generate-draft$/);
      expect(options!.method).toBe("POST");
    });
  });

  describe("remaining escalations / evaluation endpoints", () => {
    it("getEscalations hits /api/escalations", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ escalations: [] }) as any);
      await api.getEscalations();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/escalations$/);
    });

    it("updateEscalation PATCHes the patch", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ escalation: {} }) as any);
      await api.updateEscalation("1", { status: "RESOLVED" });
      expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe("PATCH");
    });

    it("getKpiConfig hits /api/kpi-config", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ kpiConfig: [] }) as any);
      await api.getKpiConfig();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/kpi-config$/);
    });

    it("updateKpiConfig PATCHes by metricKey", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ kpiConfig: {} }) as any);
      await api.updateKpiConfig("responseTime", { weight: 2 });
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/kpi-config\/responseTime$/);
    });

    it("getRecruiterScore hits /api/recruiters/:id/score", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ snapshot: null, metricSnapshots: [] }) as any);
      await api.getRecruiterScore("r1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/recruiters\/r1\/score$/);
    });

    it("recomputeRecruiterScore POSTs to /recompute-score", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, snapshot: {} }) as any);
      await api.recomputeRecruiterScore("r1");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/recompute-score$/);
      expect(options!.method).toBe("POST");
    });

    it("getRecruiterKpiSummary hits /kpi-summary", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ summary: null }) as any);
      await api.getRecruiterKpiSummary("r1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/kpi-summary$/);
    });
  });

  describe("remaining unipile / reports endpoints", () => {
    it("cancelPendingConnection POSTs the provider", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }) as any);
      await api.cancelPendingConnection("linkedin");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ provider: "linkedin" });
    });

    it("getDataHealth hits /api/reports/data-health", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}) as any);
      await api.getDataHealth();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/reports\/data-health$/);
    });

    it("getRecentReports hits /api/reports/recent", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ reports: [] }) as any);
      await api.getRecentReports();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/reports\/recent$/);
    });
  });

  describe("FAQ", () => {
    it("checkFaq sends leadMessage", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ match: false }) as any);
      await api.checkFaq("hello");
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(options!.body as string)).toEqual({ leadMessage: "hello" });
    });

    it("listFaqs hits /api/faq", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ faqEntries: [] }) as any);
      await api.listFaqs();
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/faq$/);
    });

    it("getFaq hits /api/faq/:id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ faqEntry: {} }) as any);
      await api.getFaq("f1");
      expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/api\/faq\/f1$/);
    });

    it("createFaq POSTs data", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ faqEntry: {}, keywordsGenerated: true }) as any);
      await api.createFaq({ category: "c", question: "q", answer: "a" });
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect(options!.method).toBe("POST");
    });

    it("updateFaq PATCHes by id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ faqEntry: {} }) as any);
      await api.updateFaq("f1", { isActive: false });
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/faq\/f1$/);
      expect(options!.method).toBe("PATCH");
    });

    it("deleteFaq issues DELETE by id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }) as any);
      await api.deleteFaq("f1");
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toMatch(/\/api\/faq\/f1$/);
      expect(options!.method).toBe("DELETE");
    });
  });
});
