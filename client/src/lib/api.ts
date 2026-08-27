import type {
  ApiLead,
  LeadTimelineEvent,
  ApiUser,
  ApiClient,
  ApiRequirement,
  ApiClientDemand,
  ApiEmailQueueItem,
  ApiConversation,
  ApiConversationMessage,
  ApiEscalation,
  ApiKpiConfig,
  ApiRecruiterScoreSnapshot,
  ApiRecruiterMetricSnapshot,
  ApiRecruiterKpiSummary,
  ApiSheetSyncConfig,
  ApiRequestError,
  UserRole,
  WorkStatus,
} from "@/lib/api-types";
import { getNeonToken } from "@/lib/neon-auth";

// Strip any trailing slash(es) -- every call site appends a path starting
// with "/", so a trailing slash on VITE_API_BASE_URL (e.g. set with one in
// Vercel's env, "https://api.example.com/") produces a double slash
// ("https://api.example.com//api/auth/me") that Express's router doesn't
// match, 404ing every request. Confirmed live: production was hitting this
// exact bug.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

/** Shared fetch wrapper: attaches the Neon Auth bearer token, builds the full
 *  URL from VITE_API_BASE_URL, and normalizes errors into ApiRequestError. */
async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getNeonToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const err = new Error((isJson && data.message) || `Request failed (${res.status})`) as ApiRequestError;
    err.code = isJson ? data.error : undefined;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

// -------------------- FAQ types --------------------

export interface FaqEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaqInput {
  category: string;
  question: string;
  answer: string;
}

export interface UpdateFaqInput {
  category?: string;
  question?: string;
  answer?: string;
  tags?: string[];
  isActive?: boolean;
}

export const api = {
  // -------------------- leads --------------------

  async getLeads(filters: {
    q?: string; stage?: string; language?: string; country?: string; service?: string;
    recruiterId?: string; flag?: string; dateRange?: "24h" | "7d" | "30d"; cursor?: string; limit?: number;
  } = {}): Promise<{ leads: ApiLead[]; nextCursor: string | null }> {
    return request(`/api/leads${qs(filters)}`);
  },

  async getMyLeads(): Promise<{ leads: ApiLead[] }> {
    return request("/api/leads/mine");
  },

  async getLead(id: string): Promise<{ lead: ApiLead; timeline: LeadTimelineEvent[] }> {
    return request(`/api/leads/${id}`);
  },

  async createLead(lead: Partial<ApiLead> & { fullName: string; source: string }): Promise<{ lead: ApiLead; duplicateWarning: any }> {
    return request("/api/leads", { method: "POST", body: JSON.stringify(lead) });
  },

  async bulkCreateLeads(
    leads: Array<Partial<ApiLead> & { fullName: string; source: string }>,
    options: { skipDuplicates?: boolean } = {}
  ) {
    return request<{ results: Array<{ index: number; status: string; leadId?: string; message?: string }> }>(
      "/api/leads/bulk",
      { method: "POST", body: JSON.stringify({ leads, skipDuplicates: options.skipDuplicates }) }
    );
  },

  async checkBulkDuplicateLeads(leads: Array<{ fullName?: string; email?: string; contactNumber?: string; profileLink?: string }>) {
    return request<{
      hasDuplicates: boolean;
      duplicateCount: number;
      duplicateNames: string[];
      duplicates: Array<{
        index: number;
        fullName: string;
        email?: string;
        matchedField: string;
        existingLeadId: string;
        existingLeadName?: string;
      }>;
      totalCount: number;
      newCount: number;
    }>("/api/leads/check-bulk-duplicates", {
      method: "POST",
      body: JSON.stringify({ leads }),
    });
  },

  async updateLead(id: string, patch: Partial<ApiLead>): Promise<{ lead: ApiLead }> {
    return request(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async bulkUpdateLeads(ids: string[], patch: { stage?: string; recruiterId?: string }) {
    return request<{ updated: number }>("/api/leads/bulk", { method: "PATCH", body: JSON.stringify({ ids, ...patch }) });
  },

  async deleteLeads(leadIds: string[]): Promise<{ deletedCount: number }> {
    return request("/api/leads/batch-delete", { method: "POST", body: JSON.stringify({ leadIds }) });
  },

  async claimLead(id: string): Promise<{ lead: ApiLead }> {
    return request(`/api/leads/${id}/claim`, { method: "POST" });
  },

  async checkDuplicateLead(input: { email?: string; contactNumber?: string; fullName?: string; profileLink?: string }) {
    return request<{ isDuplicate: boolean; matchedField: string | null; leadId: string | null }>(
      "/api/leads/check-duplicate",
      { method: "POST", body: JSON.stringify(input) }
    );
  },

  async addLeadFlag(id: string, flag: string, reason?: string, provisional?: boolean): Promise<{ lead: ApiLead }> {
    return request(`/api/leads/${id}/flags`, { method: "POST", body: JSON.stringify({ flag, reason, provisional }) });
  },

  async removeLeadFlag(id: string, flag: string): Promise<{ lead: ApiLead }> {
    return request(`/api/leads/${id}/flags/${flag}`, { method: "DELETE" });
  },

  async logLeadActivity(id: string, activity: { type: "INTERVIEW"; scheduledAt: string; notes?: string } | { type: "CALL"; scheduledAt: string; purpose?: string; outcome?: string }) {
    return request(`/api/leads/${id}/activities`, { method: "POST", body: JSON.stringify(activity) });
  },

  async retryLeadEnrichment(id: string): Promise<{ lead: ApiLead }> {
    return request(`/api/leads/${id}/retry-enrichment`, { method: "POST" });
  },

  // A plain `window.open`/`<a href>` to this endpoint can't carry the Neon
  // Auth bearer token (browsers don't let you attach headers to a bare
  // navigation), so this fetches the CSV with auth and triggers the download
  // client-side instead of exposing a raw URL.
  async downloadLeadsExport(filters: Record<string, string | undefined> = {}): Promise<void> {
    const token = await getNeonToken();
    const res = await fetch(`${API_BASE_URL}/api/leads/export${qs(filters)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  },

  // -------------------- users (recruiters / contractors) --------------------

  async getUsers(role: "RECRUITER" | "CONTRACTOR"): Promise<{ users: ApiUser[] }> {
    return request(`/api/users${qs({ role })}`);
  },

  async createUser(input: { name: string; email: string; role: UserRole; workStatus?: WorkStatus; languages?: string[] }) {
    return request<{ user: ApiUser }>("/api/users", { method: "POST", body: JSON.stringify(input) });
  },

  async deactivateUser(id: string): Promise<{ user: ApiUser }> {
    return request(`/api/users/${id}`, { method: "DELETE" });
  },

  async updateUserLanguages(id: string, languages: string[]): Promise<{ user: ApiUser }> {
    return request(`/api/users/${id}/languages`, { method: "PATCH", body: JSON.stringify({ languages }) });
  },

  async assignContractor(contractorId: string, recruiterId?: string) {
    return request(`/api/users/${contractorId}/contractor-assignment`, { method: "POST", body: JSON.stringify({ recruiterId }) });
  },

  async unassignContractor(contractorId: string) {
    return request(`/api/users/${contractorId}/contractor-assignment`, { method: "DELETE" });
  },

  // -------------------- clients & requirements --------------------

  async getClients(): Promise<{ clients: ApiClient[] }> {
    return request("/api/clients");
  },

  async getClient(id: string): Promise<{ client: ApiClient }> {
    return request(`/api/clients/${id}`);
  },

  async createClient(input: { name: string; industry?: string; contactName?: string; contactEmail?: string; notes?: string }) {
    return request<{ client: ApiClient }>("/api/clients", { method: "POST", body: JSON.stringify(input) });
  },

  async updateClient(id: string, patch: Partial<{ name: string; industry: string; contactName: string; contactEmail: string; notes: string }>) {
    return request<{ client: ApiClient }>(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async deleteClient(id: string) {
    return request<{ success: boolean; message: string }>(`/api/clients/${id}`, { method: "DELETE" });
  },

  async getRequirements(filters: { clientId?: string; status?: string; priority?: string; q?: string } = {}) {
    return request<{ requirements: ApiRequirement[] }>(`/api/requirements${qs(filters)}`);
  },

  async getRequirement(id: string): Promise<{ requirement: ApiRequirement }> {
    return request(`/api/requirements/${id}`);
  },

  async getRequirementHistory(id: string): Promise<{ assignments: any[] }> {
    return request(`/api/requirements/${id}/history`);
  },

  async createRequirements(clientId: string, items: Array<{
    title: string; language: string; service: string; region?: string; projectName?: string;
    headcountNeeded: number; priority: string; recruiterId?: string; deadline?: string; notes?: string;
  }>) {
    return request<{ requirements: ApiRequirement[] }>("/api/requirements", { method: "POST", body: JSON.stringify({ clientId, items }) });
  },

  async updateRequirement(id: string, patch: {
    title?: string; language?: string; service?: string; region?: string; projectName?: string;
    headcountNeeded?: number; priority?: string; status?: string; deadline?: string; notes?: string;
  }) {
    return request<{ requirement: ApiRequirement }>(`/api/requirements/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async deleteRequirement(id: string) {
    return request<{ success: boolean; message: string }>(`/api/requirements/${id}`, { method: "DELETE" });
  },

  async assignRequirement(id: string, recruiterId: string | null, note?: string) {
    return request<{ requirement: ApiRequirement }>(`/api/requirements/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ recruiterId, note }),
    });
  },

  // -------------------- client demands (aggregate view) --------------------

  async getClientDemands(): Promise<{ clientDemands: ApiClientDemand[] }> {
    return request("/api/client-demands");
  },

  async getClientDemand(id: string): Promise<{ clientDemand: ApiClientDemand }> {
    return request(`/api/client-demands/${id}`);
  },

  async createClientDemand(input: {
    clientName: string; language: string; services: Array<{ service: string; needed: number }>;
    priority: string; deadline?: string; contactName?: string; contactEmail?: string; notes?: string;
  }) {
    return request<{ clientDemand: ApiClientDemand; requirements: ApiRequirement[] }>(
      "/api/client-demands",
      { method: "POST", body: JSON.stringify(input) }
    );
  },

  async updateClientDemand(id: string, patch: {
    priority?: string; deadline?: string | null; contactName?: string | null;
    contactEmail?: string | null; notes?: string | null; headcountNeeded?: number;
  }) {
    return request<{ clientDemand: ApiClientDemand }>(`/api/client-demands/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async deleteClientDemand(id: string) {
    return request<{ success: boolean; message: string }>(`/api/client-demands/${id}`, { method: "DELETE" });
  },

  // -------------------- sheet sync --------------------

  async getSheetSync(): Promise<ApiSheetSyncConfig> {
    return request("/api/sheet-sync");
  },

  async setSheetSyncUrl(sheetUrl: string): Promise<ApiSheetSyncConfig> {
    return request("/api/sheet-sync", { method: "PUT", body: JSON.stringify({ sheetUrl }) });
  },

  async triggerSheetSync(): Promise<{ synced: boolean; reason?: string }> {
    return request("/api/sheet-sync/sync", { method: "POST" });
  },

  // -------------------- email queue --------------------

  async getEmailQueue(): Promise<{ items: ApiEmailQueueItem[] }> {
    return request("/api/email-queue");
  },

  async addToEmailQueue(leadId: string): Promise<{ item: ApiEmailQueueItem }> {
    return request("/api/email-queue", { method: "POST", body: JSON.stringify({ leadId }) });
  },

  async updateEmailQueueItem(id: string, patch: { subject?: string; body?: string }) {
    return request<{ item: ApiEmailQueueItem }>(`/api/email-queue/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async generateEmailDraft(id: string, to?: string) {
    return request<{ item: ApiEmailQueueItem }>(`/api/email-queue/${id}/generate-draft`, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
  },

  async sendEmailQueueItem(id: string, payload: { to?: string; subject?: string; body: string; channel: "LINKEDIN" | "EMAIL"; accountId?: string }) {
    return request<{ success: true }>(`/api/email-queue/${id}/send`, { method: "POST", body: JSON.stringify(payload) });
  },

  async batchSendEmailQueue(ids: string[]) {
    return request<{ results: Array<{ id: string; success: boolean; error?: string }> }>(
      "/api/email-queue/batch-send",
      { method: "POST", body: JSON.stringify({ ids }) }
    );
  },

  // -------------------- conversations --------------------

  async getConversations(): Promise<{ conversations: ApiConversation[] }> {
    return request("/api/conversations");
  },

  async getConversation(id: string): Promise<{ conversation: ApiConversation }> {
    return request(`/api/conversations/${id}`);
  },

  async createConversation(leadId: string): Promise<{ conversation: ApiConversation }> {
    return request("/api/conversations", { method: "POST", body: JSON.stringify({ leadId }) });
  },

  async generateLinkedInDraft(id: string) {
    return request<{ draft: { body: string } }>(`/api/conversations/${id}/generate-draft`, { method: "POST" });
  },

  async sendConversationMessage(id: string, text: string, accountId?: string, to?: string) {
    return request(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ text, accountId, to }) });
  },

  async getConversationByLead(leadId: string, channel?: string): Promise<{ conversation: ApiConversation | null; messages: ApiConversationMessage[] }> {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : "";
    return request(`/api/conversations/by-lead/${leadId}${qs}`);
  },

  // -------------------- escalations --------------------

  async getEscalations(): Promise<{ escalations: ApiEscalation[] }> {
    return request("/api/escalations");
  },

  async updateEscalation(id: string, patch: { status?: string; assignToMe?: boolean }) {
    return request<{ escalation: ApiEscalation }>(`/api/escalations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  // -------------------- evaluation / scoring --------------------

  async getKpiConfig(): Promise<{ kpiConfig: ApiKpiConfig[] }> {
    return request("/api/kpi-config");
  },

  async updateKpiConfig(metricKey: string, patch: Partial<Pick<ApiKpiConfig, "weight" | "target" | "goodBand" | "direction" | "group" | "label" | "unit" | "scored" | "notes">>) {
    return request<{ kpiConfig: ApiKpiConfig }>(`/api/kpi-config/${metricKey}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async getRecruiterScore(recruiterId: string) {
    return request<{ snapshot: ApiRecruiterScoreSnapshot | null; metricSnapshots: ApiRecruiterMetricSnapshot[] }>(
      `/api/recruiters/${recruiterId}/score`
    );
  },

  async recomputeRecruiterScore(recruiterId: string) {
    return request<{ success: boolean; snapshot: ApiRecruiterScoreSnapshot }>(
      `/api/recruiters/${recruiterId}/recompute-score`,
      { method: "POST" }
    );
  },

  async getRecruiterKpiSummary(recruiterId: string) {
    return request<{ summary: ApiRecruiterKpiSummary | null }>(`/api/recruiters/${recruiterId}/kpi-summary`);
  },

  // -------------------- Unipile / outreach --------------------

  /** Mint hosted auth link for connecting accounts */
  async connectAccount(provider: string, clientUrl?: string): Promise<{ url: string }> {
    const origin = clientUrl || (typeof window !== "undefined" ? window.location.origin : undefined);
    return request("/api/unipile/connect", { method: "POST", body: JSON.stringify({ provider, clientUrl: origin }) });
  },

  /** Get user's connected Unipile accounts */
  async getConnectedAccounts(): Promise<any[]> {
    try {
      const data = await request<{ accounts: any[] }>("/api/unipile/accounts");
      return data.accounts || [];
    } catch {
      return [];
    }
  },

  /** Disconnect account from Unipile */
  async disconnectAccount(accountId: string): Promise<{ success: boolean }> {
    return request(`/api/unipile/accounts/${accountId}`, { method: "DELETE" });
  },

  /** Clear this user's own outstanding connect attempt (idempotent) */
  async cancelPendingConnection(provider: string): Promise<{ success: boolean }> {
    return request("/api/unipile/cancel-pending", { method: "POST", body: JSON.stringify({ provider }) });
  },

  /** Send outreach via Unipile (LinkedIn DM or Tracked Email) */
  async sendOutreach(payload: {
    leadId: string;
    channel: "LINKEDIN" | "EMAIL" | string;
    to?: string;
    subject?: string;
    body: string;
    emailQueueId?: string;
  }) {
    return request("/api/outreach/send", { method: "POST", body: JSON.stringify(payload) });
  },

  // -------------------- Reports & Analytics --------------------

  async getReportsAnalytics(range: string = "30d"): Promise<ApiReportsAnalytics> {
    return request<ApiReportsAnalytics>(`/api/reports/analytics?range=${range}`);
  },

  /** Real Contacted/Awaiting Reply/Replied/Negotiation/DNC counts -- replaces
   *  the hardcoded-zero g3-mock outreachBatch both dashboards used to read. */
  async getOutreachFunnel(range: string = "30d"): Promise<{
    range: string;
    contacted: number;
    awaiting_reply: number;
    replied: number;
    in_negotiation: number;
    dnc: number;
  }> {
    return request(`/api/reports/outreach-funnel?range=${range}`);
  },

  /** Real lead-data completeness -- replaces the hardcoded-zero g3-mock
   *  profileCompleteness object the owner dashboard used to read. */
  async getDataHealth(): Promise<{
    total: number;
    enrichedPct: number;
    verifiedEmailPct: number;
    confirmedLanguagePairPct: number;
    experienceDataPct: number;
  }> {
    return request("/api/reports/data-health");
  },

  async getRecentReports(): Promise<{ reports: ApiRecentReport[] }> {
    return request<{ reports: ApiRecentReport[] }>("/api/reports/recent");
  },

  getReportExportUrl(type: string): string {
    return `/api/reports/export/${type}`;
  },

  // -------------------- FAQ --------------------

  /** Check a lead's message against the FAQ table (button-triggered, structured lookup) */
  async checkFaq(leadMessage: string): Promise<{ match: boolean; answer?: string; matchedQuestion?: string }> {
    return request("/api/faq/check", { method: "POST", body: JSON.stringify({ leadMessage }) });
  },

  /** List all FAQ entries */
  async listFaqs(): Promise<{ faqEntries: FaqEntry[] }> {
    return request("/api/faq");
  },

  /** Fetch a single FAQ entry by id */
  async getFaq(id: string): Promise<{ faqEntry: FaqEntry }> {
    return request(`/api/faq/${id}`);
  },

  /** Create an FAQ entry (owner only); keywords are auto-generated server-side */
  async createFaq(data: CreateFaqInput): Promise<{ faqEntry: FaqEntry; keywordsGenerated: boolean }> {
    return request("/api/faq", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /** Update an FAQ entry (owner only) */
  async updateFaq(id: string, data: UpdateFaqInput): Promise<{ faqEntry: FaqEntry }> {
    return request(`/api/faq/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  /** Soft-delete an FAQ entry (owner only) */
  async deleteFaq(id: string): Promise<{ success: boolean }> {
    return request(`/api/faq/${id}`, { method: "DELETE" });
  },
};
