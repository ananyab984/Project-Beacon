// Recruiter-scoped mock data. Uses schema field names verbatim (Template_ProjectBeacon).
// SEARCH fields = filled by recruiter on capture.
// ENRICHMENT fields = filled by background job (simulated) after submit.
import { useSyncExternalStore } from "react";
import { incrementLanguageFilled } from "@/lib/g3-mock";

export type RecruiterLeadStatus = "pending" | "complete";

export interface RecruiterLead {
  id: string;
  owner_recruiter_id: string; // which recruiter added it ("" if contractor-submitted)
  owner_contractor_id?: string; // set when a contractor submitted the lead
  dup_flagged?: boolean; // true if a duplicate warning was shown at submit time
  // SEARCH
  reachout_date: string | null;
  application_date: string | null;
  first_name: string;
  full_name: string;
  country_of_residence: string;
  source: string;
  profile_link: string;
  contact_number: string;
  email_address: string;
  // ENRICHMENT (nullable while pending)
  services: string[] | null;
  source_language: string | null;
  target_language: string | null;
  secondary_languages: string[] | null;
  years_of_exp: number | null;
  vendor_experience: string | null;
  // meta
  enrichment_status: RecruiterLeadStatus;
  just_enriched_until: number | null; // epoch ms
  created_at: number;
}

export interface EmailQueueItem {
  id: string;
  lead_id: string;
  candidate_name: string;
  candidate_role: string;
  status: "AI Drafted" | "Follow-up" | "Review Needed";
  subject: string;
  body: string;
  preview: string;
  received_ago: string;
  ai_generated: boolean;
}

export interface Conversation {
  id: string;
  lead_id: string;
  candidate_name: string;
  candidate_role: string;
  channel: "LinkedIn" | "Instagram" | "WhatsApp" | "SMS";
  last_message: string;
  last_ago: string;
  unread: boolean;
  messages: { from: "me" | "them"; text: string; at: string }[];
}

export interface AssignedContractor {
  id: string;
  name: string;
  email: string;
  assigned_at: number;
  leads_added_30d: number;
  last_active: string;
}

export interface WeeklyChannelStat {
  week: string;
  emails_sent: number;
  emails_replied: number;
  dms_sent: number;
  dms_replied: number;
}

export const CURRENT_RECRUITER_ID = "r_riya";
export const CURRENT_CONTRACTOR_ID = "ct_alex";

const SERVICES_POOL = ["Dubbing", "Subtitling", "SDH", "CC", "AD"];
const LANG_POOL = ["English", "German", "French", "Spanish", "Japanese", "Korean", "Portuguese", "Mandarin"];

function randomFromPool<T>(pool: T[], n: number): T[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// -------------------- global store --------------------

type Store = {
  leads: RecruiterLead[];
  emailQueue: EmailQueueItem[];
  conversations: Conversation[];
  contractors: AssignedContractor[];
  unassignedContractors: AssignedContractor[];
  weekly: WeeklyChannelStat[];
};

function seedContractor(
  first: string, full: string, country: string, source: string, email: string, phone: string,
  services: string[], sl: string, tl: string, yrs: number, vendor: string,
  enrichment: RecruiterLeadStatus, dup: boolean
): RecruiterLead {
  return {
    id: `l_${Math.random().toString(36).slice(2, 10)}`,
    owner_recruiter_id: "",
    owner_contractor_id: CURRENT_CONTRACTOR_ID,
    dup_flagged: dup,
    reachout_date: "2026-07-20",
    application_date: "2026-07-19",
    first_name: first,
    full_name: full,
    country_of_residence: country,
    source,
    profile_link: `https://linkedin.com/in/${first.toLowerCase()}-${yrs}`,
    contact_number: phone,
    email_address: email,
    services,
    source_language: sl,
    target_language: tl,
    secondary_languages: [],
    years_of_exp: yrs,
    vendor_experience: vendor,
    enrichment_status: enrichment,
    just_enriched_until: null,
    created_at: Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 12,
  };
}

const seedLeads: RecruiterLead[] = [];

function seed(
  first: string, full: string, country: string, source: string, email: string,
  services: string[], sl: string, tl: string, yrs: number, vendor: string, owner: string,
): RecruiterLead {
  return {
    id: `l_${Math.random().toString(36).slice(2, 10)}`,
    owner_recruiter_id: owner,
    reachout_date: "2026-07-15",
    application_date: "2026-07-14",
    first_name: first,
    full_name: full,
    country_of_residence: country,
    source,
    profile_link: `https://linkedin.com/in/${first.toLowerCase()}`,
    contact_number: "",
    email_address: email,
    services,
    source_language: sl,
    target_language: tl,
    secondary_languages: [],
    years_of_exp: yrs,
    vendor_experience: vendor,
    enrichment_status: "complete",
    just_enriched_until: null,
    created_at: Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 20,
  };
}

const store: Store = {
  leads: [],
  emailQueue: [],
  conversations: [],
  contractors: [
    { id: "ct_alex", name: "Alex Kim", email: "alex@global3.co", assigned_at: Date.now() - 1000 * 60 * 60 * 24 * 40, leads_added_30d: 12, last_active: "2h ago" },
  ],
  unassignedContractors: [
    { id: "ct_priya", name: "Priya Nair", email: "priya.nair@example.com", assigned_at: 0, leads_added_30d: 0, last_active: "—" },
    { id: "ct_marco", name: "Marco Rossi", email: "marco.rossi@example.com", assigned_at: 0, leads_added_30d: 0, last_active: "—" },
  ],
  weekly: [],
};

export const initialRecruiterStore: Store = store;

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useRecruiterStore(): Store {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

// -------------------- actions --------------------

export type DuplicateHit = { field: "full_name" | "profile_link" | "email_address"; lead: RecruiterLead } | null;

export function checkDuplicate(input: Pick<RecruiterLead, "full_name" | "profile_link" | "email_address">): DuplicateHit {
  const name = input.full_name.trim().toLowerCase();
  const link = input.profile_link.trim().toLowerCase();
  const email = input.email_address.trim().toLowerCase();
  for (const l of store.leads) {
    if (name && l.full_name.trim().toLowerCase() === name) return { field: "full_name", lead: l };
    if (link && l.profile_link.trim().toLowerCase() === link) return { field: "profile_link", lead: l };
    if (email && l.email_address.trim().toLowerCase() === email) return { field: "email_address", lead: l };
  }
  return null;
}

export type AddLeadInput = {
  first_name: string;
  full_name: string;
  country_of_residence: string;
  source: string;
  profile_link: string;
  email_address: string;
  contact_number: string;
  reachout_date: string;
  services: string[];
  source_language: string;
  target_language: string;
  secondary_languages: string[];
};

export function addLead(input: AddLeadInput): RecruiterLead {
  const lead: RecruiterLead = {
    id: `l_${Math.random().toString(36).slice(2, 10)}`,
    owner_recruiter_id: CURRENT_RECRUITER_ID,
    ...input,
    reachout_date: input.reachout_date || null,
    application_date: null,
    services: input.services.length ? input.services : null,
    source_language: input.source_language || null,
    target_language: input.target_language || null,
    secondary_languages: input.secondary_languages.length ? input.secondary_languages : null,
    years_of_exp: null,
    vendor_experience: null,
    enrichment_status: "pending",
    just_enriched_until: null,
    created_at: Date.now(),
  };
  store.leads = [lead, ...store.leads];
  emit();

  const targetLang = input.target_language || input.source_language;
  if (targetLang) {
    incrementLanguageFilled(targetLang, input.services[0]);
  }

  return lead;
}

// -------------------- contractor actions --------------------

export function addContractorLead(input: AddLeadInput, opts: { dup_flagged: boolean }): RecruiterLead {
  const lead: RecruiterLead = {
    id: `l_${Math.random().toString(36).slice(2, 10)}`,
    owner_recruiter_id: "",
    owner_contractor_id: CURRENT_CONTRACTOR_ID,
    dup_flagged: opts.dup_flagged,
    ...input,
    reachout_date: input.reachout_date || null,
    application_date: null,
    services: input.services.length ? input.services : null,
    source_language: input.source_language || null,
    target_language: input.target_language || null,
    secondary_languages: input.secondary_languages.length ? input.secondary_languages : null,
    years_of_exp: null,
    vendor_experience: null,
    enrichment_status: "pending",
    just_enriched_until: null,
    created_at: Date.now(),
  };
  store.leads = [lead, ...store.leads];
  emit();

  const cTargetLang = input.target_language || input.source_language;
  if (cTargetLang) {
    incrementLanguageFilled(cTargetLang, input.services[0]);
  }

  return lead;
}

export function myContractorLeads(): RecruiterLead[] {
  return store.leads.filter((l) => l.owner_contractor_id === CURRENT_CONTRACTOR_ID);
}

export function assignContractor(id: string) {
  const c = store.unassignedContractors.find((x) => x.id === id);
  if (!c) return;
  store.unassignedContractors = store.unassignedContractors.filter((x) => x.id !== id);
  store.contractors = [...store.contractors, { ...c, assigned_at: Date.now(), last_active: "just now" }];
  emit();
}

export function removeContractor(id: string) {
  const c = store.contractors.find((x) => x.id === id);
  if (!c) return;
  store.contractors = store.contractors.filter((x) => x.id !== id);
  store.unassignedContractors = [...store.unassignedContractors, { ...c, assigned_at: 0, last_active: "—" }];
  emit();
}

export function myLeads(): RecruiterLead[] {
  return store.leads.filter((l) => l.owner_recruiter_id === CURRENT_RECRUITER_ID);
}

export function leadsOnboardedCount() {
  // mocked derived metric
  return 124;
}
export function leadsOffboardedCount() {
  return 18;
}


// -------------------- shared lead status store --------------------
// Cards on My Leads / Global Leads can update the pipeline status directly.
// The change persists in-memory and is reflected wherever `useLeadStatus` reads.

export const LEAD_STATUSES = [
  "New",
  "Contacted",
  "Awaiting Reply",
  "Replied",
  "Screening",
  "Interview Scheduled",
  "Interview Completed",
  "Negotiation",
  "Offered",
  "Placed",
  "On Hold",
  "Closed",
  "Rejected",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

// Map "legacy" Stage values from global mock into the extended status vocabulary.
export function stageToStatus(stage?: string): LeadStatus {
  switch (stage) {
    case "New": return "New";
    case "Contacted": return "Contacted";
    case "Replied": return "Replied";
    case "Negotiating": return "Negotiation";
    case "Invite Sent": return "Interview Scheduled";
    case "Onboarded": return "Placed";
    case "Cold": return "On Hold";
    default: return "New";
  }
}

const statusOverrides: Record<string, LeadStatus> = {};
const statusListeners = new Set<() => void>();
function emitStatus() { statusListeners.forEach((l) => l()); }

export function setLeadStatus(id: string, status: LeadStatus) {
  statusOverrides[id] = status;
  emitStatus();
}

export function useLeadStatus(id: string, initial: LeadStatus): LeadStatus {
  return useSyncExternalStore(
    (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    () => statusOverrides[id] ?? initial,
    () => statusOverrides[id] ?? initial,
  );
}

export function getLeadStatus(id: string, initial: LeadStatus): LeadStatus {
  return statusOverrides[id] ?? initial;
}

// Subscribe to any status change (returns a version number). Use to re-run filters.
let statusVersion = 0;
statusListeners.add(() => { statusVersion++; });
export function useLeadStatusVersion(): number {
  return useSyncExternalStore(
    (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    () => statusVersion,
    () => statusVersion,
  );
}

// -------------------- deterministic mock enrichers --------------------
// Stable across renders — hashed from the lead id.

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export type LeadPriority = "P0" | "P1" | "P2" | "P3";
const PRIORITIES: LeadPriority[] = ["P0", "P1", "P2", "P3"];
const CLIENTS_POOL = ["Client Alpha", "Client Beta", "Client Gamma", "Client Delta"];

export function leadPriority(id: string): LeadPriority {
  return PRIORITIES[hash(id) % PRIORITIES.length];
}

// Priority overrides — recruiter can change a card's priority inline.
const priorityOverrides: Record<string, LeadPriority> = {};
const priorityListeners = new Set<() => void>();
function emitPriority() { priorityListeners.forEach((l) => l()); }
export function setLeadPriority(id: string, p: LeadPriority) {
  priorityOverrides[id] = p;
  emitPriority();
}
export function useLeadPriority(id: string, initial: LeadPriority): LeadPriority {
  return useSyncExternalStore(
    (l) => { priorityListeners.add(l); return () => { priorityListeners.delete(l); }; },
    () => priorityOverrides[id] ?? initial,
    () => priorityOverrides[id] ?? initial,
  );
}
export { PRIORITIES };
export function leadClient(id: string): string {
  return CLIENTS_POOL[hash(id + "c") % CLIENTS_POOL.length];
}
export function leadAiScore(id: string): number {
  return 55 + (hash(id + "s") % 45); // 55–99
}
export function leadDueDate(id: string): string {
  const days = 1 + (hash(id + "d") % 20);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
export function leadLastUpdated(id: string): string {
  const opts = ["just now", "12m ago", "1h ago", "3h ago", "yesterday", "2d ago", "4d ago"];
  return opts[hash(id + "u") % opts.length];
}

// Claim tracking for Global Leads (unassigned → recruiter).
const claimed: Record<string, string> = {};
const claimListeners = new Set<() => void>();
function emitClaim() { claimListeners.forEach((l) => l()); }
export function claimLead(id: string) {
  claimed[id] = CURRENT_RECRUITER_ID;
  emitClaim();
}
export function useClaimedBy(id: string, initial: string): string {
  return useSyncExternalStore(
    (l) => { claimListeners.add(l); return () => { claimListeners.delete(l); }; },
    () => claimed[id] ?? initial,
    () => claimed[id] ?? initial,
  );
}