import type {
  Client,
  ClientDemand,
  Requirement,
  Lead,
  Recruiter,
} from "@/lib/g3-mock";
import type { EmailQueueItem, Conversation } from "@/lib/recruiter-mock";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

/**
 * Backend API Client Layer
 * Standardized API interface ready for full database integration.
 * Communicates with backend REST API when VITE_API_BASE_URL is set,
 * defaulting to empty reactive state when offline.
 */
export const api = {
  /** Fetch all clients from backend database */
  async getClients(): Promise<Client[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/clients`);
      if (!res.ok) throw new Error("Failed to fetch clients from database");
      return res.json();
    }
    return [];
  },

  /** Fetch all client demands from backend database */
  async getClientDemands(): Promise<ClientDemand[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/demands`);
      if (!res.ok) throw new Error("Failed to fetch client demands from database");
      return res.json();
    }
    return [];
  },

  /** Create a new client demand in backend database */
  async createClientDemand(demand: Omit<ClientDemand, "id">): Promise<ClientDemand> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/demands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demand),
      });
      if (!res.ok) throw new Error("Failed to create client demand in database");
      return res.json();
    }
    return { ...demand, id: `cd_${Date.now()}` };
  },

  /** Fetch all requirements from backend database */
  async getRequirements(): Promise<Requirement[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/requirements`);
      if (!res.ok) throw new Error("Failed to fetch requirements from database");
      return res.json();
    }
    return [];
  },

  /** Fetch all candidate leads from backend database */
  async getLeads(): Promise<Lead[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/leads`);
      if (!res.ok) throw new Error("Failed to fetch leads from database");
      return res.json();
    }
    return [];
  },

  /** Create a new candidate lead in backend database */
  async createLead(lead: Omit<Lead, "id">): Promise<Lead> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
      if (!res.ok) throw new Error("Failed to create lead in database");
      return res.json();
    }
    return { ...lead, id: `l_${Date.now()}` };
  },

  /** Fetch all recruiter profiles from backend database */
  async getRecruiters(): Promise<Recruiter[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/recruiters`);
      if (!res.ok) throw new Error("Failed to fetch recruiters from database");
      return res.json();
    }
    return [];
  },

  /** Onboard a new recruiter in backend database */
  async onboardRecruiter(recruiter: Omit<Recruiter, "id">): Promise<Recruiter> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/recruiters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recruiter),
      });
      if (!res.ok) throw new Error("Failed to onboard recruiter in database");
      return res.json();
    }
    return { ...recruiter, id: `r_${Date.now()}` };
  },

  /** Fetch email queue items from backend database */
  async getEmailQueue(): Promise<EmailQueueItem[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/email-queue`);
      if (!res.ok) throw new Error("Failed to fetch email queue from database");
      return res.json();
    }
    return [];
  },

  /** Fetch recruiter conversations from backend database */
  async getConversations(): Promise<Conversation[]> {
    if (API_BASE_URL) {
      const res = await fetch(`${API_BASE_URL}/api/conversations`);
      if (!res.ok) throw new Error("Failed to fetch conversations from database");
      return res.json();
    }
    return [];
  },

  /** Mint Unipile hosted auth link for connecting accounts */
  async connectAccount(provider: string): Promise<{ url: string }> {
    const token = getAccessToken();
    const res = await fetch("http://localhost:5001/api/unipile/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ provider }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to generate connection link");
    return data;
  },

  /** Get user's connected Unipile accounts */
  async getConnectedAccounts(): Promise<any[]> {
    const token = getAccessToken();
    if (!token) return [];
    try {
      const res = await fetch("http://localhost:5001/api/unipile/accounts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.accounts || [];
    } catch {
      return [];
    }
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
    const token = getAccessToken();
    const res = await fetch("http://localhost:5001/api/outreach/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw { code: data.error || "SEND_FAILED", message: data.message || "Failed to send message" };
    }
    return data;
  },
};

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem("g3.session.v2");
    if (raw) {
      const session = JSON.parse(raw);
      return session.accessToken || null;
    }
  } catch {}
  return null;
}

