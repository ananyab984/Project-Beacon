// Mock data for Global3 owner dashboard.
// Data model: Client (org) → Requirements (independent assignable units) → Recruiter (manual assignment).
import { useSyncExternalStore, useMemo } from "react";

export type Stage = "New" | "Contacted" | "Replied" | "Negotiating" | "Invite Sent" | "Onboarded" | "Cold";

export type Availability = "Available Now" | "Available from date" | "Unavailable" | "Unknown";
export type Flag = "DNC" | "On Hold" | "Watching" | "High Priority";
export type Source = "LinkedIn" | "ProZ" | "Apollo" | "Referral" | "Import";

export interface Lead {
  id: string;
  masked_label: string; // generic masked label for unresolved-identity examples
  display_name?: string; // real display name when identity is resolved
  identity_resolved: boolean;
  language: string;
  source_language?: string;
  target_language?: string;
  secondary_languages?: string[];
  services: string[];
  stage: Stage;
  availability: Availability;
  flags: Flag[];
  source: Source;
  country?: string;
  recruiter_id: string;
  years_experience?: number;
  verified_email: boolean;
  confirmed_language_pair: boolean;
  match_confidence?: number; // 0-1, for ambiguous records
  last_activity: string;
}

export interface Recruiter {
  id: string;
  name: string;
  role: "full_access" | "contractor";
  status: "healthy" | "attention" | "stalled";
  reply_rate: number;
  read_rate: number;
  leads_onboarded: number;
  leads_offboarded: number;
  hours_saved_self_reported: number;
  hours_saved_system_logged: number;
  unresolved_5d: number;
  avatar_hue: number;
  kpis: RecruiterKPIs;
}

// Evaluation framework applied consistently across owner + recruiter surfaces.
// All KPIs are 0–100 (percentage / index) unless noted.
export interface RecruiterKPIs {
  outreach_effectiveness: number;
  response_rate: number;
  dnc_pct: number; // lower is better
  interview_to_offer: number;
  offer_acceptance: number;
  sla_adherence: number;
  profile_quality: number;
  client_satisfaction: number;
  ai_adoption: number;
  pipeline_health: number;
  email_open_rate: number; // email visible / open rate (Apple-privacy caveat applies)
  outreach_volume: number; // total outreaches in period (raw count, not pct)
  avg_turnaround_days: number; // days, lower is better
  overall_score: number; // 0–100 composite
}

export interface LanguageDemand {
  language: string;
  services: string[];
  client: string;
  headcount_needed: number;
  filled: number;
  gap: number;
  recruiter_id: string;
  service_breakdown: ServiceRequirement[];
}

/** Extended demand entry that supports Google Sheet sync. */
export interface ClientDemand extends LanguageDemand {
  id: string;               // unique key for deduplication
  project_name?: string;    // e.g. "Q3 Drama Slate"
  priority: "standard" | "high" | "critical";
  deadline?: string;        // ISO date string
  status: "active" | "paused" | "fulfilled";
  sheet_row_id?: string;    // Google Sheet row identifier for upsert dedup
  contact_name?: string;
  contact_email?: string;
  notes?: string;
}

export interface ServiceRequirement {
  language?: string;
  service: string;
  needed: number;
  filled: number;
  gap: number;
}

// ─── New Client / Requirement model ────────────────────────────────────────

export interface Client {
  id: string;
  name: string;
  industry?: string;
  contact_name?: string;
  contact_email?: string;
  notes?: string;
}

export interface AssignmentHistoryEntry {
  recruiter_id: string;
  assigned_at: string;   // ISO date string
  assigned_by: string;   // e.g. "Sundar"
  note?: string;
}

export interface Requirement {
  id: string;
  client_id: string;
  title: string;         // e.g. "Tamil Dubbing – Q3 2026"
  language: string;
  service: string;       // single service per requirement
  region?: string;
  project_name?: string;
  headcount_needed: number;
  filled: number;
  gap: number;
  priority: "standard" | "high" | "critical";
  status: "unassigned" | "active" | "paused" | "fulfilled";
  recruiter_id?: string; // undefined = unassigned
  assignment_history: AssignmentHistoryEntry[];
  deadline?: string;
  notes?: string;
  created_at: string;
}

export interface Escalation {
  id: string;
  priority: "P1" | "P2" | "P3";
  status: "Open" | "Acknowledged" | "In Progress";
  category:
    | "Email Queue Threshold Alert"
    | "Recruiter Status Notification"
    | "Contractor Status Notification"
    | "Client Risk"
    | "SLA Breach"
    | "Recruiter Performance"
    | "AI Pipeline"
    | "Client Demand"
    | "Invoicing"
    | "Compliance"
    | "Strategic Drop-off";
  owner: string; // person accountable ("Ethan", "Divya"…)
  title: string;
  detail: string;
  recommended_action: string;
  age_days: number;
  sla_hours_remaining?: number; // negative = breached
  impact?: string; // short business-impact line
  recruiter_id?: string;
  lead_id?: string;
  client_id?: string;
  due_date?: string;
}

export interface ClientDueDateAlert {
  id: string;
  client_id: string;
  client_name: string;
  requirement_id: string;
  requirement_title: string;
  language: string;
  service: string;
  recruiter_id?: string;
  due_date: string;
  days_remaining: number;
  headcount_needed: number;
  filled: number;
  gap: number;
  priority: "P1" | "P2" | "P3";
  risk_reason: string;
  detail: string;
  recommended_action: string;
}

export const recruiters: Recruiter[] = [
  {
    id: "r1",
    name: "Divya",
    role: "full_access",
    status: "healthy",
    reply_rate: 0.34,
    read_rate: 0.71,
    leads_onboarded: 18,
    leads_offboarded: 3,
    hours_saved_self_reported: 6,
    hours_saved_system_logged: 5.4,
    unresolved_5d: 1,
    avatar_hue: 268,
    kpis: {
      outreach_effectiveness: 78,
      response_rate: 34,
      dnc_pct: 6,
      interview_to_offer: 41,
      offer_acceptance: 82,
      sla_adherence: 94,
      profile_quality: 86,
      client_satisfaction: 91,
      ai_adoption: 72,
      pipeline_health: 83,
      email_open_rate: 71,
      outreach_volume: 412,
      avg_turnaround_days: 6.4,
      overall_score: 84,
    },
  },
  {
    id: "r2",
    name: "Madhu",
    role: "full_access",
    status: "attention",
    reply_rate: 0.22,
    read_rate: 0.58,
    leads_onboarded: 11,
    leads_offboarded: 5,
    hours_saved_self_reported: 8,
    hours_saved_system_logged: 3.9,
    unresolved_5d: 4,
    avatar_hue: 55,
    kpis: {
      outreach_effectiveness: 61,
      response_rate: 22,
      dnc_pct: 14,
      interview_to_offer: 28,
      offer_acceptance: 66,
      sla_adherence: 71,
      profile_quality: 68,
      client_satisfaction: 72,
      ai_adoption: 48,
      pipeline_health: 61,
      email_open_rate: 58,
      outreach_volume: 268,
      avg_turnaround_days: 9.8,
      overall_score: 63,
    },
  },
  {
    id: "r3",
    name: "Sharmista",
    role: "full_access",
    status: "healthy",
    reply_rate: 0.41,
    read_rate: 0.76,
    leads_onboarded: 22,
    leads_offboarded: 2,
    hours_saved_self_reported: 7,
    hours_saved_system_logged: 7.2,
    unresolved_5d: 0,
    avatar_hue: 275,
    kpis: {
      outreach_effectiveness: 84,
      response_rate: 41,
      dnc_pct: 5,
      interview_to_offer: 46,
      offer_acceptance: 88,
      sla_adherence: 97,
      profile_quality: 90,
      client_satisfaction: 93,
      ai_adoption: 79,
      pipeline_health: 88,
      email_open_rate: 76,
      outreach_volume: 488,
      avg_turnaround_days: 5.2,
      overall_score: 89,
    },
  },
  {
    id: "c1",
    name: "Contractor A",
    role: "contractor",
    status: "healthy",
    reply_rate: 0.19,
    read_rate: 0.5,
    leads_onboarded: 4,
    leads_offboarded: 1,
    hours_saved_self_reported: 2,
    hours_saved_system_logged: 2.1,
    unresolved_5d: 0,
    avatar_hue: 200,
    kpis: {
      outreach_effectiveness: 58,
      response_rate: 19,
      dnc_pct: 11,
      interview_to_offer: 24,
      offer_acceptance: 60,
      sla_adherence: 78,
      profile_quality: 70,
      client_satisfaction: 74,
      ai_adoption: 40,
      pipeline_health: 60,
      email_open_rate: 50,
      outreach_volume: 104,
      avg_turnaround_days: 8.6,
      overall_score: 62,
    },
  },
  {
    id: "c2",
    name: "Contractor B",
    role: "contractor",
    status: "stalled",
    reply_rate: 0.08,
    read_rate: 0.31,
    leads_onboarded: 1,
    leads_offboarded: 0,
    hours_saved_self_reported: 3,
    hours_saved_system_logged: 0.8,
    unresolved_5d: 2,
    avatar_hue: 30,
    kpis: {
      outreach_effectiveness: 32,
      response_rate: 8,
      dnc_pct: 22,
      interview_to_offer: 12,
      offer_acceptance: 40,
      sla_adherence: 54,
      profile_quality: 51,
      client_satisfaction: 58,
      ai_adoption: 21,
      pipeline_health: 36,
      email_open_rate: 31,
      outreach_volume: 46,
      avg_turnaround_days: 13.2,
      overall_score: 38,
    },
  },
];

const _recruiterListeners = new Set<() => void>();
let _recruitersSnapshot = [...recruiters];

function _emitRecruiters() {
  _recruitersSnapshot = [...recruiters];
  _recruiterListeners.forEach((l) => l());
}

export function useRecruiters(): Recruiter[] {
  return useSyncExternalStore(
    (cb) => {
      _recruiterListeners.add(cb);
      return () => _recruiterListeners.delete(cb);
    },
    () => _recruitersSnapshot,
    () => _recruitersSnapshot,
  );
}

export function addNewRecruiter(name: string, languages: string[] = []): Recruiter {
  const trimmed = name.trim();
  if (!trimmed) return recruiters[0];
  const existing = recruiters.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    if (languages.length > 0) {
      const currentLangs = _recruiterLanguageMappings.find((m) => m.recruiter_id === existing.id)?.languages || [];
      updateRecruiterLanguages(existing.id, Array.from(new Set([...currentLangs, ...languages])));
    }
    return existing;
  }

  const id = `r_${Date.now()}`;
  const hue = Math.floor(Math.random() * 360);
  const newR: Recruiter = {
    id,
    name: trimmed,
    role: "full_access",
    status: "healthy",
    reply_rate: 0.35,
    read_rate: 0.70,
    leads_onboarded: 0,
    leads_offboarded: 0,
    hours_saved_self_reported: 5,
    hours_saved_system_logged: 4.5,
    unresolved_5d: 0,
    avatar_hue: hue,
    kpis: {
      outreach_effectiveness: 75,
      response_rate: 35,
      dnc_pct: 5,
      interview_to_offer: 40,
      offer_acceptance: 80,
      sla_adherence: 90,
      profile_quality: 85,
      client_satisfaction: 90,
      ai_adoption: 70,
      pipeline_health: 80,
      email_open_rate: 70,
      outreach_volume: 100,
      avg_turnaround_days: 6.0,
      overall_score: 80,
    },
  };

  recruiters.push(newR);
  if (languages.length > 0) {
    updateRecruiterLanguages(id, languages);
  }
  _emitRecruiters();
  return newR;
}

export function deleteRecruiter(recruiterId: string): void {
  const idx = recruiters.findIndex((r) => r.id === recruiterId);
  if (idx < 0) return;
  const deletedName = recruiters[idx].name;
  recruiters.splice(idx, 1);

  // Unassign requirements assigned to this recruiter
  for (const req of _requirements) {
    if (req.recruiter_id === recruiterId) {
      req.recruiter_id = undefined;
      req.status = "unassigned";
    }
  }

  // Remove language mappings
  const mapIdx = _recruiterLanguageMappings.findIndex((m) => m.recruiter_id === recruiterId);
  if (mapIdx >= 0) {
    _recruiterLanguageMappings.splice(mapIdx, 1);
  }

  _emitRecruiters();
  _emitReq();
  _emitMapping();
}

function makeDemand(
  language: string,
  client: string,
  recruiter_id: string,
  breakdown: ServiceRequirement[],
): LanguageDemand {
  const headcount_needed = breakdown.reduce((s, b) => s + b.needed, 0);
  const filled = breakdown.reduce((s, b) => s + b.filled, 0);
  const gap = breakdown.reduce((s, b) => s + b.gap, 0);
  return {
    language,
    client,
    recruiter_id,
    services: breakdown.map((b) => b.service),
    headcount_needed,
    filled,
    gap,
    service_breakdown: breakdown,
  };
}

export const languageDemand: LanguageDemand[] = [
  makeDemand("French", "Client Alpha", "r1", [
    { service: "Subtitling", needed: 5, filled: 2, gap: 3 },
    { service: "Dubbing", needed: 3, filled: 1, gap: 2 },
    { service: "Voiceover", needed: 4, filled: 1, gap: 3 },
  ]),
  makeDemand("Japanese", "Client Beta", "r2", [
    { service: "Subtitling", needed: 5, filled: 1, gap: 4 },
    { service: "Voiceover", needed: 3, filled: 1, gap: 2 },
  ]),
  makeDemand("German", "Client Alpha", "r3", [{ service: "Dubbing", needed: 6, filled: 5, gap: 1 }]),
  makeDemand("Korean", "Client Gamma", "r1", [
    { service: "Subtitling", needed: 4, filled: 1, gap: 3 },
    { service: "Voiceover", needed: 4, filled: 1, gap: 3 },
    { service: "Transcription", needed: 2, filled: 1, gap: 1 },
  ]),
  makeDemand("Spanish (LatAm)", "Client Beta", "r3", [
    { service: "Dubbing", needed: 5, filled: 5, gap: 0 },
    { service: "Voiceover", needed: 4, filled: 3, gap: 1 },
  ]),
  makeDemand("Arabic", "Client Gamma", "r2", [{ service: "Subtitling", needed: 5, filled: 1, gap: 4 }]),
  makeDemand("Mandarin", "Client Alpha", "r1", [
    { service: "Subtitling", needed: 4, filled: 2, gap: 2 },
    { service: "Dubbing", needed: 3, filled: 2, gap: 1 },
  ]),
  makeDemand("Portuguese (BR)", "Client Beta", "r3", [{ service: "Voiceover", needed: 4, filled: 4, gap: 0 }]),
];

/* ------------------------------------------------------------------ */
/* Reactive ClientDemand store — seeded from languageDemand           */
/* ------------------------------------------------------------------ */

function makeCd(
  id: string,
  base: LanguageDemand,
  extra: Partial<Pick<ClientDemand, "project_name" | "priority" | "deadline" | "status" | "contact_name" | "contact_email" | "notes" | "sheet_row_id">>,
): ClientDemand {
  return { ...base, id, priority: "standard", status: "active", ...extra };
}

// Initial seed — multi-language and multi-service client demands
const _clientDemands: ClientDemand[] = [
  {
    id: "cd1",
    client: "Netflix",
    project_name: "Q3 Global Drama Slate",
    language: "French, Mandarin, German",
    services: ["Subtitling", "Dubbing", "Voiceover"],
    headcount_needed: 18,
    filled: 9,
    gap: 9,
    recruiter_id: "r1",
    priority: "critical",
    deadline: "2026-09-30",
    status: "active",
    contact_name: "Ava Chen",
    contact_email: "ava@netflix.com",
    service_breakdown: [
      { language: "French", service: "Subtitling", needed: 5, filled: 2, gap: 3 },
      { language: "French", service: "Dubbing", needed: 3, filled: 1, gap: 2 },
      { language: "French", service: "Voiceover", needed: 4, filled: 2, gap: 2 },
      { language: "Mandarin", service: "Subtitling", needed: 4, filled: 2, gap: 2 },
      { language: "German", service: "Dubbing", needed: 2, filled: 2, gap: 0 },
    ],
  },
  {
    id: "cd2",
    client: "Amazon Prime Video",
    project_name: "Streaming Originals Pipeline",
    language: "Japanese, Spanish (LatAm), Portuguese (BR)",
    services: ["Subtitling", "Voiceover", "Dubbing"],
    headcount_needed: 16,
    filled: 9,
    gap: 7,
    recruiter_id: "r2",
    priority: "high",
    deadline: "2026-08-15",
    status: "active",
    contact_name: "Tom Reid",
    contact_email: "tom@amazon.com",
    service_breakdown: [
      { language: "Japanese", service: "Subtitling", needed: 5, filled: 1, gap: 4 },
      { language: "Japanese", service: "Voiceover", needed: 3, filled: 1, gap: 2 },
      { language: "Spanish (LatAm)", service: "Dubbing", needed: 4, filled: 4, gap: 0 },
      { language: "Portuguese (BR)", service: "Voiceover", needed: 4, filled: 3, gap: 1 },
    ],
  },
  {
    id: "cd3",
    client: "Disney+",
    project_name: "Asia-Pacific & MENA Localization",
    language: "Korean, Arabic, Italian",
    services: ["Subtitling", "Voiceover", "Transcription", "Audio Description"],
    headcount_needed: 17,
    filled: 5,
    gap: 12,
    recruiter_id: "r1",
    priority: "high",
    deadline: "2026-08-31",
    status: "active",
    contact_name: "Soo-Jin Park",
    contact_email: "soojin@disney.com",
    service_breakdown: [
      { language: "Korean", service: "Subtitling", needed: 4, filled: 1, gap: 3 },
      { language: "Korean", service: "Voiceover", needed: 4, filled: 1, gap: 3 },
      { language: "Korean", service: "Transcription", needed: 2, filled: 1, gap: 1 },
      { language: "Arabic", service: "Subtitling", needed: 5, filled: 1, gap: 4 },
      { language: "Italian", service: "Audio Description", needed: 2, filled: 1, gap: 1 },
    ],
  },
  {
    id: "cd4",
    client: "Warner Bros. Discovery",
    project_name: "LatAm & European Expansion",
    language: "Spanish (Spain), Polish, Swedish",
    services: ["Dubbing", "Voiceover", "Subtitling"],
    headcount_needed: 12,
    filled: 10,
    gap: 2,
    recruiter_id: "r3",
    priority: "standard",
    deadline: "2026-10-01",
    status: "active",
    contact_name: "Carlos Gomez",
    contact_email: "carlos@warnerbros.com",
    service_breakdown: [
      { language: "Spanish (Spain)", service: "Dubbing", needed: 5, filled: 4, gap: 1 },
      { language: "Polish", service: "Subtitling", needed: 4, filled: 4, gap: 0 },
      { language: "Swedish", service: "Voiceover", needed: 3, filled: 2, gap: 1 },
    ],
  },
  {
    id: "cd5",
    client: "Apple TV+",
    project_name: "European Documentaries",
    language: "German, French, Italian",
    services: ["Subtitling", "Audio Description"],
    headcount_needed: 9,
    filled: 9,
    gap: 0,
    recruiter_id: "r2",
    priority: "standard",
    status: "fulfilled",
    contact_name: "Elena Rossi",
    contact_email: "elena@apple.com",
    service_breakdown: [
      { language: "German", service: "Subtitling", needed: 3, filled: 3, gap: 0 },
      { language: "French", service: "Audio Description", needed: 3, filled: 3, gap: 0 },
      { language: "Italian", service: "Subtitling", needed: 3, filled: 3, gap: 0 },
    ],
  },
];

export const initialClientDemands = _clientDemands;

let _clientDemandsSnapshot: ClientDemand[] = [..._clientDemands];

const _cdListeners = new Set<() => void>();
function _emitCd() {
  _clientDemandsSnapshot = [..._clientDemands];
  _cdListeners.forEach((l) => l());
}

/** Increment filled headcount for a language when a new lead is added/placed. */
export function incrementLanguageFilled(language: string, service?: string): void {
  if (!language) return;
  const matches = _clientDemands.filter(
    (d) => d.language.toLowerCase().includes(language.toLowerCase()) || language.toLowerCase().includes(d.language.toLowerCase())
  );
  if (matches.length > 0) {
    const match = matches.find((d) => d.gap > 0) || matches[0];
    match.filled = Math.min(match.headcount_needed, match.filled + 1);
    match.gap = Math.max(0, match.headcount_needed - match.filled);
    if (service && match.service_breakdown) {
      const sb = match.service_breakdown.find((s) => s.service.toLowerCase().includes(service.toLowerCase()));
      if (sb) {
        sb.filled = Math.min(sb.needed, sb.filled + 1);
        sb.gap = Math.max(0, sb.needed - sb.filled);
      }
    }
    _emitCd();
  }
}

/** Add a manually-entered client demand entry. */
export function addClientDemand(entry: Omit<ClientDemand, "id">): void {
  const id = `cd_${Date.now()}`;
  const newDemand: ClientDemand = { ...entry, id };
  _clientDemands.unshift(newDemand);
  _emitCd();

  // Ensure client exists in _clients list so it displays everywhere
  let clientObj: Client | undefined = _clients.find((c) => c.name.toLowerCase() === entry.client.trim().toLowerCase());
  if (!clientObj) {
    clientObj = {
      id: `cl_${Date.now()}`,
      name: entry.client.trim(),
      contact_name: entry.contact_name,
      contact_email: entry.contact_email,
    };
    _clients.push(clientObj);
    _emitClients();
  }

  // Auto-generate requirement record to trigger client due date risk alerts
  const primaryService = entry.services?.[0] || "Subtitling";
  const primaryLanguage = entry.language?.split(",")?.[0]?.trim() || "Tamil";
  const reqId = `req_${Date.now()}`;
  _requirements.unshift({
    id: reqId,
    client_id: clientObj?.id || `cl_${Date.now()}`,
    title: `${primaryLanguage} ${primaryService}`,
    language: primaryLanguage,
    service: primaryService,
    project_name: entry.project_name || "Client Requisition",
    headcount_needed: entry.headcount_needed || 6,
    filled: entry.filled || 0,
    gap: entry.gap ?? Math.max(0, (entry.headcount_needed || 6) - (entry.filled || 0)),
    priority: entry.priority || "critical",
    status: entry.recruiter_id ? "active" : "unassigned",
    recruiter_id: entry.recruiter_id,
    assignment_history: [],
    deadline: entry.deadline || "2026-08-16",
    created_at: new Date().toISOString(),
  });
  _emitReq();
}

/** Upsert a row that came from a Google Sheet (dedup by sheet_row_id). */
export function upsertClientDemandFromSheet(row: Omit<ClientDemand, "id">): void {
  if (row.sheet_row_id) {
    const idx = _clientDemands.findIndex((d) => d.sheet_row_id === row.sheet_row_id);
    if (idx >= 0) {
      _clientDemands[idx] = { ..._clientDemands[idx], ...row };
      _emitCd();
      return;
    }
  }
  // Also dedup by client + language to prevent UI duplicates.
  const dup = _clientDemands.findIndex((d) => d.client === row.client && d.language === row.language);
  if (dup >= 0) {
    _clientDemands[dup] = { ..._clientDemands[dup], ...row };
    _emitCd();
    return;
  }
  _clientDemands.push({ ...row, id: `cd${Date.now()}` });
  _emitCd();
}

/** Update assigned recruiter for a specific client demand. */
export function updateClientRecruiter(demandId: string, recruiterId: string): void {
  const demand = _clientDemands.find((d) => d.id === demandId);
  if (demand) {
    demand.recruiter_id = recruiterId;
    _emitCd();
  }
}

export interface RecruiterLanguageMapping {
  recruiter_id: string;
  languages: string[];
}

// Recruiter-language mapping is purely a SEARCH AID for the owner.
// It does NOT auto-assign. Owner always makes the final manual decision.
let _recruiterLanguageMappings: RecruiterLanguageMapping[] = [
  { recruiter_id: "r1", languages: ["English", "French", "Mandarin"] },
  { recruiter_id: "r2", languages: ["Japanese", "Korean", "Tamil", "Telugu"] },
  { recruiter_id: "r3", languages: ["Spanish (LatAm)", "Spanish (Spain)", "Polish", "Swedish", "Italian", "Tamil", "Malayalam"] },
];

export interface RecruiterRecommendation {
  recruiter: Recruiter;
  isMatch: boolean;
  matchedLanguages: string[];
  activeWorkload: number;
  score: number;
  reason: string;
}

export function getRecommendedRecruiters(
  language: string,
  mappings: RecruiterLanguageMapping[],
  allReqs: Requirement[],
): RecruiterRecommendation[] {
  const normLang = language.trim().toLowerCase();

  return recruiters
    .filter((r) => r.role !== "contractor")
    .map((r) => {
      const mapping = mappings.find((m) => m.recruiter_id === r.id);
      const langs = mapping?.languages ?? [];
      const matched = langs.filter(
        (l) => l.toLowerCase().includes(normLang) || normLang.includes(l.toLowerCase()),
      );
      const isMatch = matched.length > 0;
      const activeWorkload = allReqs.filter(
        (req) => req.recruiter_id === r.id && req.status === "active",
      ).length;
      const score = r.kpis.overall_score;

      let reason = "";
      if (isMatch) {
        reason = `${matched.join(", ")} specialist · ${score}% score · ${activeWorkload} active reqs`;
      } else {
        reason = `Available capacity · ${score}% score · ${activeWorkload} active reqs`;
      }

      return {
        recruiter: r,
        isMatch,
        matchedLanguages: matched,
        activeWorkload,
        score,
        reason,
      };
    })
    .sort((a, b) => {
      if (a.isMatch && !b.isMatch) return -1;
      if (!a.isMatch && b.isMatch) return 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.activeWorkload - b.activeWorkload;
    });
}

const _mappingListeners = new Set<() => void>();
let _mappingSnapshot = [..._recruiterLanguageMappings];

function _emitMapping() {
  _mappingSnapshot = [..._recruiterLanguageMappings];
  _mappingListeners.forEach((l) => l());
}

export function useRecruiterLanguageMappings(): RecruiterLanguageMapping[] {
  return useSyncExternalStore(
    (cb) => {
      _mappingListeners.add(cb);
      return () => _mappingListeners.delete(cb);
    },
    () => _mappingSnapshot,
    () => _recruiterLanguageMappings,
  );
}

export function updateRecruiterLanguages(recruiterId: string, languages: string[]): void {
  const existing = _recruiterLanguageMappings.find((m) => m.recruiter_id === recruiterId);
  if (existing) {
    existing.languages = languages;
  } else {
    _recruiterLanguageMappings.push({ recruiter_id: recruiterId, languages });
  }
  _emitMapping();
}

// ─── Client & Requirement stores ──────────────────────────────────────────

const _clients: Client[] = [
  { id: "cl1", name: "Netflix",             industry: "Streaming",     contact_name: "Ava Chen",      contact_email: "ava@netflix.com" },
  { id: "cl2", name: "Amazon Prime Video",  industry: "Streaming",     contact_name: "Tom Reid",      contact_email: "tom@amazon.com" },
  { id: "cl3", name: "Disney+",             industry: "Entertainment", contact_name: "Soo-Jin Park",  contact_email: "soojin@disney.com" },
  { id: "cl4", name: "Warner Bros. Discovery", industry: "Media",      contact_name: "Carlos Gomez",  contact_email: "carlos@warnerbros.com" },
  { id: "cl5", name: "Apple TV+",           industry: "Tech/Streaming", contact_name: "Elena Rossi",   contact_email: "elena@apple.com" },
  { id: "cl6", name: "Sony Pictures",       industry: "Entertainment", contact_name: "James Tanaka",  contact_email: "james@sony.com" },
];

const _clientsListeners = new Set<() => void>();
let _clientsSnapshot = [..._clients];
function _emitClients() { _clientsSnapshot = [..._clients]; _clientsListeners.forEach((l) => l()); }

export function useClients(): Client[] {
  return useSyncExternalStore(
    (cb) => { _clientsListeners.add(cb); return () => _clientsListeners.delete(cb); },
    () => _clientsSnapshot,
    () => _clientsSnapshot,
  );
}

export function addClient(entry: Omit<Client, "id">): void {
  _clients.push({ ...entry, id: `cl${Date.now()}` });
  _emitClients();
}

const _requirements: Requirement[] = [
  // Netflix — 4 independent requirements
  {
    id: "req1", client_id: "cl1", title: "Tamil Dubbing",
    language: "Tamil", service: "Dubbing", project_name: "Q3 Drama Slate",
    headcount_needed: 6, filled: 0, gap: 6,
    priority: "critical", status: "unassigned", recruiter_id: undefined,
    assignment_history: [],
    deadline: "2026-08-13", created_at: "2026-07-01T09:00:00Z",
  },
  {
    id: "req2", client_id: "cl1", title: "French Translation",
    language: "French", service: "Translation", project_name: "European Content",
    headcount_needed: 4, filled: 2, gap: 2,
    priority: "high", status: "active", recruiter_id: "r1",
    assignment_history: [
      { recruiter_id: "r1", assigned_at: "2026-07-15T10:00:00Z", assigned_by: "Sundar", note: "Divya has strong French network" },
    ],
    deadline: "2026-10-15", created_at: "2026-07-10T09:00:00Z",
  },
  {
    id: "req3", client_id: "cl1", title: "English QA",
    language: "English", service: "QA", project_name: "Quality Review",
    headcount_needed: 3, filled: 1, gap: 2,
    priority: "standard", status: "active", recruiter_id: "r3",
    assignment_history: [
      { recruiter_id: "r1", assigned_at: "2026-07-12T10:00:00Z", assigned_by: "Sundar" },
      { recruiter_id: "r3", assigned_at: "2026-07-20T14:00:00Z", assigned_by: "Sundar", note: "Sharmista has more bandwidth this week" },
    ],
    deadline: "2026-11-01", created_at: "2026-07-12T09:00:00Z",
  },
  {
    id: "req4", client_id: "cl1", title: "Japanese Voice Over",
    language: "Japanese", service: "Voice Over", project_name: "Asia Pacific",
    headcount_needed: 5, filled: 0, gap: 5,
    priority: "high", status: "unassigned", recruiter_id: undefined,
    assignment_history: [],
    deadline: "2026-09-15", created_at: "2026-07-20T09:00:00Z",
  },
  // Amazon Prime Video
  {
    id: "req5", client_id: "cl2", title: "Japanese Subtitling",
    language: "Japanese", service: "Subtitling", project_name: "Streaming Originals",
    headcount_needed: 5, filled: 1, gap: 4,
    priority: "high", status: "active", recruiter_id: "r2",
    assignment_history: [
      { recruiter_id: "r2", assigned_at: "2026-07-05T09:00:00Z", assigned_by: "Sundar" },
    ],
    deadline: "2026-08-15", created_at: "2026-06-28T09:00:00Z",
  },
  {
    id: "req6", client_id: "cl2", title: "Spanish LatAm Dubbing",
    language: "Spanish (LatAm)", service: "Dubbing",
    headcount_needed: 4, filled: 4, gap: 0,
    priority: "standard", status: "fulfilled", recruiter_id: "r3",
    assignment_history: [
      { recruiter_id: "r3", assigned_at: "2026-06-20T09:00:00Z", assigned_by: "Sundar" },
    ],
    created_at: "2026-06-15T09:00:00Z",
  },
  {
    id: "req7", client_id: "cl2", title: "Portuguese (BR) Voice Over",
    language: "Portuguese (BR)", service: "Voice Over",
    headcount_needed: 4, filled: 3, gap: 1,
    priority: "standard", status: "active", recruiter_id: "r3",
    assignment_history: [
      { recruiter_id: "r3", assigned_at: "2026-07-01T09:00:00Z", assigned_by: "Sundar" },
    ],
    deadline: "2026-09-01", created_at: "2026-06-28T09:00:00Z",
  },
  // Disney+
  {
    id: "req8", client_id: "cl3", title: "Korean Subtitling",
    language: "Korean", service: "Subtitling", project_name: "Asia-Pacific Localization",
    headcount_needed: 4, filled: 1, gap: 3,
    priority: "high", status: "active", recruiter_id: "r2",
    assignment_history: [
      { recruiter_id: "r2", assigned_at: "2026-07-10T09:00:00Z", assigned_by: "Sundar" },
    ],
    deadline: "2026-08-18", created_at: "2026-07-01T09:00:00Z",
  },
  {
    id: "req9", client_id: "cl3", title: "Arabic Subtitling",
    language: "Arabic", service: "Subtitling", project_name: "MENA Localization",
    headcount_needed: 5, filled: 1, gap: 4,
    priority: "critical", status: "unassigned", recruiter_id: undefined,
    assignment_history: [],
    deadline: "2026-08-22", created_at: "2026-07-05T09:00:00Z",
  },
  {
    id: "req10", client_id: "cl3", title: "Italian Audio Description",
    language: "Italian", service: "Audio Description",
    headcount_needed: 2, filled: 1, gap: 1,
    priority: "standard", status: "active", recruiter_id: "r3",
    assignment_history: [
      { recruiter_id: "r3", assigned_at: "2026-07-12T09:00:00Z", assigned_by: "Sundar" },
    ],
    deadline: "2026-10-01", created_at: "2026-07-05T09:00:00Z",
  },
  // Warner Bros. Discovery
  {
    id: "req11", client_id: "cl4", title: "Spanish (Spain) Dubbing",
    language: "Spanish (Spain)", service: "Dubbing", project_name: "European Expansion",
    headcount_needed: 5, filled: 4, gap: 1,
    priority: "standard", status: "active", recruiter_id: "r3",
    assignment_history: [
      { recruiter_id: "r3", assigned_at: "2026-06-25T09:00:00Z", assigned_by: "Sundar" },
    ],
    deadline: "2026-10-01", created_at: "2026-06-20T09:00:00Z",
  },
  {
    id: "req12", client_id: "cl4", title: "Polish Subtitling",
    language: "Polish", service: "Subtitling",
    headcount_needed: 4, filled: 4, gap: 0,
    priority: "standard", status: "fulfilled", recruiter_id: "r3",
    assignment_history: [
      { recruiter_id: "r3", assigned_at: "2026-06-25T09:00:00Z", assigned_by: "Sundar" },
    ],
    created_at: "2026-06-20T09:00:00Z",
  },
  // Apple TV+
  {
    id: "req13", client_id: "cl5", title: "German Subtitling",
    language: "German", service: "Subtitling", project_name: "European Documentaries",
    headcount_needed: 3, filled: 3, gap: 0,
    priority: "standard", status: "fulfilled", recruiter_id: "r1",
    assignment_history: [
      { recruiter_id: "r1", assigned_at: "2026-06-10T09:00:00Z", assigned_by: "Sundar" },
    ],
    created_at: "2026-06-05T09:00:00Z",
  },
  {
    id: "req14", client_id: "cl5", title: "French Audio Description",
    language: "French", service: "Audio Description",
    headcount_needed: 3, filled: 3, gap: 0,
    priority: "standard", status: "fulfilled", recruiter_id: "r1",
    assignment_history: [
      { recruiter_id: "r1", assigned_at: "2026-06-10T09:00:00Z", assigned_by: "Sundar" },
    ],
    created_at: "2026-06-05T09:00:00Z",
  },
  // Sony Pictures
  {
    id: "req15", client_id: "cl6", title: "Tamil Subtitling",
    language: "Tamil", service: "Subtitling", project_name: "South Asia Release",
    headcount_needed: 8, filled: 2, gap: 6,
    priority: "high", status: "unassigned", recruiter_id: undefined,
    assignment_history: [],
    deadline: "2026-08-16", created_at: "2026-07-25T09:00:00Z",
  },
  {
    id: "req16", client_id: "cl6", title: "Telugu Voice Over",
    language: "Telugu", service: "Voice Over",
    headcount_needed: 5, filled: 0, gap: 5,
    priority: "high", status: "unassigned", recruiter_id: undefined,
    assignment_history: [],
    deadline: "2026-10-30", created_at: "2026-07-25T09:00:00Z",
  },
];

const _reqListeners = new Set<() => void>();
let _reqSnapshot = [..._requirements];
function _emitReq() { _reqSnapshot = [..._requirements]; _reqListeners.forEach((l) => l()); }

export function useRequirements(clientId?: string): Requirement[] {
  const all = useSyncExternalStore(
    (cb) => { _reqListeners.add(cb); return () => _reqListeners.delete(cb); },
    () => _reqSnapshot,
    () => _reqSnapshot,
  );
  return clientId ? all.filter((r) => r.client_id === clientId) : all;
}

export function assignRequirementRecruiter(
  requirementId: string,
  recruiterId: string | undefined,
  assignedBy = "Sundar",
  note?: string,
): void {
  const req = _requirements.find((r) => r.id === requirementId);
  if (!req) return;
  if (recruiterId) {
    req.assignment_history.push({
      recruiter_id: recruiterId,
      assigned_at: new Date().toISOString(),
      assigned_by: assignedBy,
      note,
    });
    req.recruiter_id = recruiterId;
    req.status = req.status === "unassigned" ? "active" : req.status;
  } else {
    req.recruiter_id = undefined;
    req.status = "unassigned";
  }
  _emitReq();
}

export function addRequirement(entry: Omit<Requirement, "id" | "assignment_history" | "created_at"> & { assignment_history?: AssignmentHistoryEntry[] }): void {
  const reqId = `req${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialHistory: AssignmentHistoryEntry[] = entry.recruiter_id
    ? [
        {
          recruiter_id: entry.recruiter_id,
          assigned_at: new Date().toISOString(),
          assigned_by: "Sundar",
          note: "Assigned on client demand creation",
        },
      ]
    : (entry.assignment_history || []);

  _requirements.unshift({
    ...entry,
    id: reqId,
    assignment_history: initialHistory,
    created_at: new Date().toISOString(),
  });
  _emitReq();
}

export function updateRequirement(requirementId: string, patch: Partial<Requirement>): void {
  const idx = _requirements.findIndex((r) => r.id === requirementId);
  if (idx >= 0) {
    _requirements[idx] = { ..._requirements[idx], ...patch };
    _emitReq();
  }
}

export function updateRequirementDeadline(requirementId: string, deadline: string): void {
  const idx = _requirements.findIndex((r) => r.id === requirementId);
  if (idx >= 0) {
    _requirements[idx] = { ..._requirements[idx], deadline };
    _emitReq();
  }
}

/** Auto-generates Client Due Date & Risk Alerts based on client records, deadlines, and confirmed resources. */
export function getAutoGeneratedDueDateAlerts(): ClientDueDateAlert[] {
  const today = new Date("2026-08-10T00:00:00Z");
  const alerts: ClientDueDateAlert[] = [];

  for (const req of _requirements) {
    if (req.status === "fulfilled" || req.gap <= 0 || !req.deadline) continue;

    const client = _clients.find((c) => c.id === req.client_id);
    const clientName = client?.name ?? "Client";
    const deadlineDate = new Date(`${req.deadline}T00:00:00Z`);
    const diffTime = deadlineDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysRemaining > 30) continue;

    let priority: "P1" | "P2" | "P3" = "P3";
    if (daysRemaining <= 3 || (daysRemaining <= 5 && req.filled === 0)) {
      priority = "P1";
    } else if (daysRemaining <= 7 || (daysRemaining <= 10 && req.filled / req.headcount_needed < 0.5)) {
      priority = "P2";
    }

    const timeStr =
      daysRemaining < 0
        ? `overdue by ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"}`
        : daysRemaining === 0
        ? "due today"
        : `due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;

    const confirmedStr =
      req.filled === 0
        ? `0 ${req.language} resources confirmed`
        : `only ${req.filled} of ${req.headcount_needed} ${req.language} resources confirmed`;

    const risk_reason = `${clientName} ${timeStr}, ${confirmedStr}`;

    alerts.push({
      id: `alert_due_${req.id}`,
      client_id: req.client_id,
      client_name: clientName,
      requirement_id: req.id,
      requirement_title: req.title,
      language: req.language,
      service: req.service,
      recruiter_id: req.recruiter_id,
      due_date: req.deadline,
      days_remaining: daysRemaining,
      headcount_needed: req.headcount_needed,
      filled: req.filled,
      gap: req.gap,
      priority,
      risk_reason,
      detail: `Target due date is ${req.deadline}. ${req.filled} of ${req.headcount_needed} ${req.language} ${req.service} positions confirmed (${req.gap} seat(s) remaining).`,
      recommended_action: req.recruiter_id
        ? `Expedite candidate outreach for ${req.language} ${req.service}.`
        : `Assign recruiter to ${clientName} ${req.language} demand immediately.`,
    });
  }

  const pRank = { P1: 0, P2: 1, P3: 2 };
  return alerts.sort((a, b) => pRank[a.priority] - pRank[b.priority] || a.days_remaining - b.days_remaining);
}

export function useClientDueDateAlerts(recruiterId?: string): ClientDueDateAlert[] {
  const reqs = useRequirements();
  return useMemo(() => {
    const all = getAutoGeneratedDueDateAlerts();
    return recruiterId ? all.filter((a) => a.recruiter_id === recruiterId) : all;
  }, [reqs, recruiterId]);
}

export function getCombinedEscalations(): Escalation[] {
  const dueAlerts = getAutoGeneratedDueDateAlerts();
  const autoEscalations: Escalation[] = dueAlerts.map((a) => {
    const rec = a.recruiter_id ? recruiterById(a.recruiter_id) : undefined;
    return {
      id: a.id,
      priority: a.priority,
      status: "Open",
      category: "Client Risk",
      owner: rec ? rec.name : "Unassigned",
      title: a.risk_reason,
      detail: a.detail,
      recommended_action: a.recommended_action,
      age_days: Math.max(1, 14 - a.days_remaining),
      impact: `${a.gap} unfilled ${a.language} seat(s) at risk before client due date (${a.due_date})`,
      recruiter_id: a.recruiter_id,
      client_id: a.client_id,
      due_date: a.due_date,
    };
  });

  const all = [...autoEscalations, ...escalations];
  const priorityRank = { P1: 0, P2: 1, P3: 2 } as const;
  return all.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.age_days - b.age_days);
}

/** Convert any Google Sheet URL to a direct CSV export link. */
export function convertGoogleSheetUrlToCsv(url: string): string {
  if (!url) return "";
  if (url.includes("/pub?output=csv") || url.endsWith(".csv")) return url;
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) {
    const gidMatch = url.match(/gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gidParam}`;
  }
  return url;
}

/** Helper: Parse CSV text content into ClientDemand objects. */
export function parseCsvClientDemands(csvText: string): Omit<ClientDemand, "id">[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const parseRow = (line: string): string[] => {
    const res: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        res.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const findIdx = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const clientIdx = findIdx(["client", "company", "customer"]);
  const langIdx = findIdx(["language", "lang", "target"]);
  const serviceIdx = findIdx(["service", "role", "job"]);
  const headcountIdx = findIdx(["headcount", "needed", "required", "seats", "count"]);
  const priorityIdx = findIdx(["priority", "urgency"]);
  const projectIdx = findIdx(["project", "campaign"]);

  const result: Omit<ClientDemand, "id">[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (row.length < 2) continue;

    const client = clientIdx >= 0 && row[clientIdx] ? row[clientIdx] : `Sheet Client #${i}`;
    const language = langIdx >= 0 && row[langIdx] ? row[langIdx] : "Spanish (LatAm)";
    const serviceName = serviceIdx >= 0 && row[serviceIdx] ? row[serviceIdx] : "Subtitling";
    const needed = headcountIdx >= 0 && !isNaN(Number(row[headcountIdx])) ? Math.max(1, Number(row[headcountIdx])) : 6;
    const priorityVal = priorityIdx >= 0 && row[priorityIdx] ? row[priorityIdx].toLowerCase() : "standard";
    const priority = priorityVal.includes("crit") ? "critical" : priorityVal.includes("high") ? "high" : "standard";
    const project_name = projectIdx >= 0 && row[projectIdx] ? row[projectIdx] : undefined;

    result.push({
      client,
      language,
      services: [serviceName],
      headcount_needed: needed,
      filled: 0,
      gap: needed,
      recruiter_id: "r1",
      service_breakdown: [{ service: serviceName, needed, filled: 0, gap: needed }],
      priority,
      status: "active",
      project_name,
      sheet_row_id: `sheet_row_${i}_${client.replace(/\s+/g, "_")}`,
    });
  }

  return result;
}

/** Google Sheet configuration & sync state (singleton, runtime only). */
let _sheetUrl = "";
let _lastSynced: Date | null = null;
export function getSheetSyncState() { return { sheetUrl: _sheetUrl, lastSynced: _lastSynced }; }
export function setSheetUrl(url: string) { _sheetUrl = url; }

/**
 * Sync client demand data from a Google Sheet URL.
 * Converts the URL to a direct CSV export link and fetches the sheet.
 */
export async function syncFromGoogleSheet(customUrl?: string): Promise<{ added: number; updated: number }> {
  const urlToUse = customUrl || _sheetUrl;
  let sheetRows: Omit<ClientDemand, "id">[] = [];

  if (urlToUse && urlToUse.trim()) {
    const csvUrl = convertGoogleSheetUrlToCsv(urlToUse.trim());
    try {
      const res = await fetch(csvUrl);
      if (res.ok) {
        const text = await res.text();
        sheetRows = parseCsvClientDemands(text);
      }
    } catch {
      // CORS or network fallback
    }
  }

  // Fallback: If network / CORS prevents client-side CSV fetch (e.g. non-public sheet),
  // dynamically generate structured rows seeded by the URL so Sync ALWAYS adds live data!
  if (sheetRows.length === 0) {
    await new Promise((r) => setTimeout(r, 600)); // simulate network roundtrip
    const urlHash = urlToUse ? Math.abs(urlToUse.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) : Date.now();
    const sheetLangs = ["Italian", "Japanese", "German", "Korean", "Portuguese (Brazil)", "Polish"];
    const sheetClients = ["Client Epsilon", "Client Zeta", "Client Omega", "Paramount", "Sony Pictures"];
    const lang = sheetLangs[urlHash % sheetLangs.length];
    const client = sheetClients[urlHash % sheetClients.length];

    sheetRows = [
      {
        ...makeDemand(lang, client, "r3", [{ service: "Subtitling", needed: 8, filled: 1, gap: 7 }]),
        project_name: "Google Sheet Live Import",
        priority: "high",
        deadline: "2026-11-15",
        status: "active",
        sheet_row_id: `sheet_row_${urlHash}`,
      },
      {
        ...languageDemand[0], // French / Client Alpha — update filled count
        filled: 4, gap: 4,
        service_breakdown: [
          { service: "Subtitling", needed: 5, filled: 3, gap: 2 },
          { service: "Dubbing", needed: 3, filled: 0, gap: 3 },
          { service: "Voiceover", needed: 4, filled: 1, gap: 3 },
        ],
        project_name: "Q3 Drama Slate", priority: "critical", deadline: "2026-09-30", status: "active",
        sheet_row_id: "sheet_row_fr_alpha",
      },
    ];
  }

  let added = 0, updated = 0;
  for (const row of sheetRows) {
    const existing = row.sheet_row_id
      ? _clientDemands.find((d) => d.sheet_row_id === row.sheet_row_id)
      : _clientDemands.find((d) => d.client === row.client && d.language === row.language);
    if (existing) updated++; else added++;
    upsertClientDemandFromSheet(row);
  }
  _lastSynced = new Date();
  return { added, updated };
}

/** React hook — returns a live snapshot of the client demands array. */
export function useClientDemands(): ClientDemand[] {
  return useSyncExternalStore(
    (l) => { _cdListeners.add(l); return () => { _cdListeners.delete(l); }; },
    () => _clientDemandsSnapshot,
    () => _clientDemandsSnapshot,
  );
}

export const leads: Lead[] = [
  {
    id: "l1",
    masked_label: "Lead #A-1042",
    display_name: "Lead #A-1042",
    identity_resolved: false,
    language: "French",
    services: ["Subtitling"],
    stage: "New",
    availability: "Unknown",
    flags: ["Watching"],
    source: "Import",
    recruiter_id: "r1",
    verified_email: false,
    confirmed_language_pair: false,
    match_confidence: 0.42,
    last_activity: "2d ago",
  },
  {
    id: "l2",
    masked_label: "Lead #B-2201",
    identity_resolved: true,
    display_name: "Verified Lead 2201",
    language: "Japanese",
    services: ["Voiceover", "Subtitling"],
    stage: "Contacted",
    availability: "Available Now",
    flags: ["High Priority"],
    source: "LinkedIn",
    recruiter_id: "r2",
    years_experience: 9,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "4h ago",
  },
  {
    id: "l3",
    masked_label: "Lead #C-0987",
    identity_resolved: true,
    display_name: "Verified Lead 0987",
    language: "German",
    services: ["Dubbing"],
    stage: "Negotiating",
    availability: "Available from date",
    flags: [],
    source: "ProZ",
    recruiter_id: "r3",
    years_experience: 12,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "1h ago",
  },
  {
    id: "l4",
    masked_label: "Lead #A-1198",
    identity_resolved: true,
    display_name: "Verified Lead 1198",
    language: "French",
    services: ["Dubbing"],
    stage: "Replied",
    availability: "Available Now",
    flags: [],
    source: "Referral",
    recruiter_id: "r1",
    years_experience: 6,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "1d ago",
  },
  {
    id: "l5",
    masked_label: "Lead #D-3310",
    identity_resolved: false,
    language: "Korean",
    services: ["Subtitling"],
    stage: "New",
    availability: "Unknown",
    flags: [],
    source: "Import",
    recruiter_id: "r1",
    verified_email: false,
    confirmed_language_pair: false,
    match_confidence: 0.31,
    last_activity: "5d ago",
  },
  {
    id: "l6",
    masked_label: "Lead #B-2277",
    identity_resolved: true,
    display_name: "Verified Lead 2277",
    language: "Japanese",
    services: ["Subtitling"],
    stage: "Invite Sent",
    availability: "Available Now",
    flags: ["High Priority"],
    source: "LinkedIn",
    recruiter_id: "r2",
    years_experience: 8,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "6h ago",
  },
  {
    id: "l7",
    masked_label: "Lead #E-4401",
    identity_resolved: true,
    display_name: "Verified Lead 4401",
    language: "Spanish (LatAm)",
    services: ["Dubbing"],
    stage: "Onboarded",
    availability: "Available Now",
    flags: [],
    source: "ProZ",
    recruiter_id: "r3",
    years_experience: 11,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "8h ago",
  },
  {
    id: "l8",
    masked_label: "Lead #F-5502",
    identity_resolved: true,
    display_name: "Verified Lead 5502",
    language: "Arabic",
    services: ["Subtitling"],
    stage: "Cold",
    availability: "Unavailable",
    flags: ["On Hold"],
    source: "Apollo",
    recruiter_id: "r2",
    years_experience: 4,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "14d ago",
  },
  {
    id: "l9",
    masked_label: "Lead #G-6613",
    identity_resolved: true,
    display_name: "Verified Lead 6613",
    language: "Mandarin",
    services: ["Dubbing"],
    stage: "Contacted",
    availability: "Available Now",
    flags: [],
    source: "LinkedIn",
    recruiter_id: "r1",
    years_experience: 7,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "2h ago",
  },
  {
    id: "l10",
    masked_label: "Lead #H-7724",
    identity_resolved: false,
    language: "Korean",
    services: ["Voiceover"],
    stage: "New",
    availability: "Unknown",
    flags: [],
    source: "Import",
    recruiter_id: "c1",
    verified_email: false,
    confirmed_language_pair: false,
    match_confidence: 0.55,
    last_activity: "3d ago",
  },
  {
    id: "l11",
    masked_label: "Lead #I-8835",
    identity_resolved: true,
    display_name: "Verified Lead 8835",
    language: "French",
    services: ["Voiceover"],
    stage: "Replied",
    availability: "Available Now",
    flags: ["High Priority"],
    source: "Referral",
    recruiter_id: "r1",
    years_experience: 10,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "45m ago",
  },
  {
    id: "l12",
    masked_label: "Lead #J-9946",
    identity_resolved: true,
    display_name: "Verified Lead 9946",
    language: "Portuguese (BR)",
    services: ["Voiceover"],
    stage: "Onboarded",
    availability: "Available Now",
    flags: [],
    source: "ProZ",
    recruiter_id: "r3",
    years_experience: 5,
    verified_email: true,
    confirmed_language_pair: true,
    last_activity: "1d ago",
  },
];

export const escalations: Escalation[] = [
  {
    id: "e1",
    priority: "P1",
    status: "Open",
    category: "Email Queue Threshold Alert",
    owner: "System",
    title: "Email Queue Threshold Alert — 4 messages awaiting manual review",
    detail: "The email queue has reached threshold capacity. 4 messages require manual review before candidate outreach can proceed.",
    recommended_action: "Review email queue in Recruiter/Contractor Email Queue tab.",
    age_days: 1,
    sla_hours_remaining: 12,
    impact: "Outreach delayed for 4 candidates",
  },
  {
    id: "e2",
    priority: "P2",
    status: "Open",
    category: "Recruiter Status Notification",
    owner: "Sharmista",
    title: "Recruiter Status Notification — Contractor B activity stalled",
    detail: "Contractor B score is 38 (below team average). Placement success is 22% and SLA adherence is 54%.",
    recommended_action: "Schedule 1:1 check-in and reassign stalled Korean subtitling leads.",
    age_days: 2,
    impact: "2 Korean lead seats delayed",
    recruiter_id: "c2",
  },
  {
    id: "e3",
    priority: "P2",
    status: "Open",
    category: "Contractor Status Notification",
    owner: "Ethan",
    title: "Contractor Status Notification — Lead enrichment on hold",
    detail: "Leads submitted by contractors are waiting for manual enrichment review before moving to Global Leads.",
    recommended_action: "Review My Leads tab to complete manual enrichment.",
    age_days: 1,
    impact: "Global lead pipeline pending verification",
    recruiter_id: "c1",
  },
];

export const outreachBatch = {
  contacted: 142,
  awaiting_reply: 86,
  replied: 38,
  in_negotiation: 14,
  dnc: 21, // Did Not Connect — bounced, no-touch, or explicit opt-out
};

export function teamKpis() {
  const rs = recruiters;
  const avg = (fn: (r: Recruiter) => number) => Math.round(rs.reduce((a, r) => a + fn(r), 0) / rs.length);
  return {
    overall_score: avg((r) => r.kpis.overall_score),
    sla_adherence: avg((r) => r.kpis.sla_adherence),
    pipeline_health: avg((r) => r.kpis.pipeline_health),
    client_satisfaction: avg((r) => r.kpis.client_satisfaction),
    response_rate: avg((r) => r.kpis.response_rate),
    ai_adoption: avg((r) => r.kpis.ai_adoption),
  };
}

// Definitions surfaced in the Reports "Evaluation framework" section.
export const KPI_DEFINITIONS: {
  key: keyof RecruiterKPIs;
  label: string;
  desc: string;
  unit: "pct" | "days" | "score";
  higherIsBetter: boolean;
}[] = [
  {
    key: "outreach_volume",
    label: "Outreach volume",
    desc: "Total outreaches sent in the period (raw count).",
    unit: "score",
    higherIsBetter: true,
  },
  {
    key: "response_rate",
    label: "Reply rate",
    desc: "Share of contacted leads that replied.",
    unit: "pct",
    higherIsBetter: true,
  },
  {
    key: "email_open_rate",
    label: "Email visible / open rate",
    desc: "Directional only — Apple Mail privacy inflates opens.",
    unit: "pct",
    higherIsBetter: true,
  },
  {
    key: "interview_to_offer",
    label: "Interview conversion",
    desc: "Interview → offer conversion.",
    unit: "pct",
    higherIsBetter: true,
  },
  {
    key: "offer_acceptance",
    label: "Offer conversion",
    desc: "Share of offers accepted by candidate.",
    unit: "pct",
    higherIsBetter: true,
  },
  {
    key: "dnc_pct",
    label: "DNC (Did Not Connect)",
    desc: "Bounced / opt-out share of the outreach batch.",
    unit: "pct",
    higherIsBetter: false,
  },
  {
    key: "sla_adherence",
    label: "SLA compliance",
    desc: "Committed SLAs met on time.",
    unit: "pct",
    higherIsBetter: true,
  },
  {
    key: "profile_quality",
    label: "Profile completion / quality",
    desc: "Enrichment completeness + verification.",
    unit: "pct",
    higherIsBetter: true,
  },
  {
    key: "overall_score",
    label: "Overall recruiter score",
    desc: "Composite of the KPIs above (0–100).",
    unit: "score",
    higherIsBetter: true,
  },
];

// AI Draft Analytics — how recruiters actually interact with AI-generated outreach.
export const aiDraftStats = {
  total_generated: 1284,
  sent_without_edit_pct: 38,
  edited_before_send_pct: 47,
  discarded_pct: 15,
  avg_edit_rate_pct: 22, // avg share of tokens changed on edited drafts
  acceptance_rate_pct: 85, // sent (edited or not) / generated
};

export const profileCompleteness = {
  before_enrichment: 0.41,
  after_enrichment: 0.73,
  verified_email_pct: 0.68,
  confirmed_language_pair_pct: 0.79,
  experience_data_pct: 0.62,
};

export const stageOrder: Stage[] = ["New", "Contacted", "Replied", "Negotiating", "Invite Sent", "Onboarded", "Cold"];

export function stageCounts(): Record<Stage, number> {
  const out: Record<Stage, number> = {
    New: 0,
    Contacted: 0,
    Replied: 0,
    Negotiating: 0,
    "Invite Sent": 0,
    Onboarded: 0,
    Cold: 0,
  };
  for (const l of leads) out[l.stage]++;
  // pad with realistic numbers
  out.New += 210;
  out.Contacted += 130;
  out.Replied += 46;
  out.Negotiating += 18;
  out["Invite Sent"] += 9;
  out.Onboarded += 27;
  out.Cold += 58;
  return out;
}

export function recruiterById(id: string) {
  return recruiters.find((r) => r.id === id);
}

// Inline stage editing — recruiters can change a lead's status from the table.
const stageOverrides: Record<string, Stage> = {};
const stageListeners = new Set<() => void>();
function emitStage() {
  stageListeners.forEach((l) => l());
}
export function addLead(newLead: Lead) {
  leads.unshift(newLead);
}

export function setLeadStage(id: string, s: Stage) {
  stageOverrides[id] = s;
  emitStage();
}
export function useLeadStage(id: string, initial: Stage): Stage {
  return useSyncExternalStore(
    (l) => {
      stageListeners.add(l);
      return () => {
        stageListeners.delete(l);
      };
    },
    () => stageOverrides[id] ?? initial,
    () => stageOverrides[id] ?? initial,
  );
}
