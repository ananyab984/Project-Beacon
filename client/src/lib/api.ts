import type {
  ApiLead,
  LeadTimelineEvent,
  ApiUser,
  ApiClient,
  ApiRequirement,
  ApiClientDemand,
  ApiEmailQueueItem,
  ApiConversation,
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem("g3.session.v2");
    if (raw) {
      const session = JSON.parse(raw);
      return session.accessToken || `demo_token_${session.userId || "user"}`;
    }
  } catch {}
  return "demo_token_user";
}

/** Shared fetch wrapper: attaches the bearer token, builds the full URL from
 *  VITE_API_BASE_URL, and normalizes errors into ApiRequestError so callers
 *  can read `.code`/`.status` instead of re-parsing the response body. */
async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
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

  async bulkCreateLeads(leads: Array<Partial<ApiLead> & { fullName: string; source: string }>) {
    return request<{ results: Array<{ index: number; status: string; leadId?: string; message?: string }> }>(
      "/api/leads/bulk",
      { method: "POST", body: JSON.stringify({ leads }) }
    );
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

  async checkDuplicateLead(input: { email?: string; contactNumber?: string; fullName?: string }) {
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

  leadsExportUrl(filters: Record<string, string | undefined> = {}): string {
    return `${API_BASE_URL}/api/leads/export${qs(filters)}`;
  },

  // -------------------- users (recruiters / contractors) --------------------

  async getUsers(role: "RECRUITER" | "CONTRACTOR"): Promise<{ users: ApiUser[] }> {
    return request(`/api/users${qs({ role })}`);
  },

  async createUser(input: { name: string; email: string; role: UserRole; workStatus?: WorkStatus; languages?: string[] }) {
    return request<{ user: ApiUser; tempPassword: string }>("/api/users", { method: "POST", body: JSON.stringify(input) });
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

  async createClient(input: { name: string; industry?: string; contactName?: string; contactEmail?: string; notes?: string }) {
    return request<{ client: ApiClient }>("/api/clients", { method: "POST", body: JSON.stringify(input) });
  },

  async getRequirements(filters: { clientId?: string; status?: string; priority?: string; q?: string } = {}) {
    return request<{ requirements: ApiRequirement[] }>(`/api/requirements${qs(filters)}`);
  },

  async createRequirements(clientId: string, items: Array<{
    title: string; language: string; service: string; region?: string; projectName?: string;
    headcountNeeded: number; priority: string; recruiterId?: string; deadline?: string; notes?: string;
  }>) {
    return request<{ requirements: ApiRequirement[] }>("/api/requirements", { method: "POST", body: JSON.stringify({ clientId, items }) });
  },

  async updateRequirement(id: string, patch: { deadline?: string; notes?: string }) {
    return request<{ requirement: ApiRequirement }>(`/api/requirements/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
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

  async createClientDemand(input: {
    clientName: string; language: string; services: Array<{ service: string; needed: number }>;
    priority: string; deadline?: string; contactName?: string; contactEmail?: string; notes?: string;
  }) {
    return request<{ clientDemand: ApiClientDemand; requirements: ApiRequirement[] }>(
      "/api/client-demands",
      { method: "POST", body: JSON.stringify(input) }
    );
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

  async generateEmailDraft(id: string) {
    return request<{ item: ApiEmailQueueItem }>(`/api/email-queue/${id}/generate-draft`, { method: "POST" });
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
};
