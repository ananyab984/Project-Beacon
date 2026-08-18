// Mock data for Global3 owner dashboard.
// Data model: Client (org) → Requirements (independent assignable units) → Recruiter (manual assignment).
import { useSyncExternalStore, useMemo } from "react";

export type Stage = "New" | "Contacted" | "Replied" | "Negotiating" | "Invite Sent" | "Onboarded" | "Cold";

export type Availability = "Available Now" | "Available from date" | "Unavailable" | "Unknown";
export type Flag = "DNC" | "On Hold" | "Watching" | "High Priority";
export type Source = "LinkedIn" | "ProZ" | "Ada" | "ATA" | "ATAA" | "Bodalgo" | "Freelancer" | "Apollo" | "Referral" | "Import" | string;

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
  vendor_experience?: string;
  verified_email: boolean;
  confirmed_language_pair: boolean;
  match_confidence?: number; // 0-1, for ambiguous records
  last_activity: string;
  created_at?: string;
}

export interface Recruiter {
  id: string;
  name: string;
  role: "full_access" | "contractor";
  /** Independent of `role` above: whether this recruiter is permanent staff or a
   *  non-permanent/contract recruiter (Granola 2026-08-13: "Work Status" field). */
  work_status: "permanent" | "contractor";
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

export const recruiters: Recruiter[] = [];

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

/** `workStatus` is the only real distinction the owner picks when onboarding
 *  here (Granola 2026-08-13: everyone created via this form is a RECRUITER;
 *  Permanent vs Contractor is a Work Status, not a different role). `role`
 *  below is derived from it and kept only because the rest of this page groups
 *  the roster by it. */
export function addNewRecruiter(
  name: string,
  languages: string[] = [],
  workStatus: "permanent" | "contractor" = "permanent",
): Recruiter {
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
    role: workStatus === "contractor" ? "contractor" : "full_access",
    work_status: workStatus,
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

export const languageDemand: LanguageDemand[] = [];

/* ------------------------------------------------------------------ */
/* Reactive ClientDemand store                                         */
/* ------------------------------------------------------------------ */

const _clientDemands: ClientDemand[] = [];

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

// Official Region-Wise Language Recruitment Mapping (Madhu, Divya, Sharmistha, Varsha, Sunaina)
let _recruiterLanguageMappings: RecruiterLanguageMapping[] = [
  {
    recruiter_id: "r2", // Madhu (Recruiter 1 - South Asian & English Canada/UK)
    languages: [
      "Bengali", "Gujarati", "Hindi", "Kannada", "Malayalam", "Marathi",
      "Oriya", "Panjabi", "Tamil", "Telugu", "Urdu", "English (Canada)", "English (UK)", "English (British)"
    ]
  },
  {
    recruiter_id: "r1", // Divya (Recruiter 2 - East/Southeast Asian, Italian & English)
    languages: [
      "Mandarin (Simplified)", "Chinese (Simplified)", "Mandarin (Traditional)", "Chinese (Traditional)",
      "Indonesian", "Japanese", "Korean", "Malay", "Thai", "Urdu", "Vietnamese", "Italian", "English", "English (AUS)"
    ]
  },
  {
    recruiter_id: "r3", // Sharmistha (Contractor / Partner - Finno-Ugric, Germanic & Romance)
    languages: [
      "Cantonese", "Finnish", "Hungarian", "Kazakh", "Icelandic", "Norwegian", "Hebrew", "Spanish (Latin American)", "Spanish (LatAm)"
    ]
  },
  {
    recruiter_id: "r4", // Varsha (Contractor / Partner - Slavic & Turkic)
    languages: [
      "Bulgarian", "Croatian", "Czech", "Polish", "Russian", "Slovak", "Slovenian", "Turkish", "Ukrainian"
    ]
  },
  {
    recruiter_id: "r5", // Sunaina (Contractor / Partner - Germanic, Hellenic/Semitic & Romance)
    languages: [
      "Danish", "Dutch", "German", "Swedish", "Arabic", "Greek", "Castilian Spanish", "Catalan",
      "French (Canadian)", "French (Parisian)", "French", "Portuguese (Brazilian)", "Portuguese (BR)", "Portuguese (Portugal)", "Romanian"
    ]
  }
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

const _clients: Client[] = [];

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

const _requirements: Requirement[] = [];

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

/** Helper: Parse CSV/Excel sheet text content into ClientDemand objects. */
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

  const rawHeaders = parseRow(lines[0]);
  const normHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const findIdx = (keywords: string[]) => normHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));

  const clientIdx = findIdx(["clientname", "client", "company", "customer"]);
  const projectIdx = findIdx(["projectname", "project", "campaign"]);
  const lang1Idx = findIdx(["targetlanguage", "targetlang", "language", "lang"]);
  const service1Idx = findIdx(["servicetype", "service", "services"]);
  const headcount1Idx = findIdx(["numberofresourcesneeded", "resourcesneeded", "headcount", "needed", "qty", "seats"]);
  const priorityIdx = findIdx(["prioritylevel", "priority", "urgency"]);

  const result: Omit<ClientDemand, "id">[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (row.length < 2) continue;

    const client = (clientIdx >= 0 && row[clientIdx] ? row[clientIdx] : "") || "Sample Client";
    const rawLang = lang1Idx >= 0 && row[lang1Idx] ? row[lang1Idx] : "";
    const rawService = service1Idx >= 0 && row[service1Idx] ? row[service1Idx] : "Subtitling";
    const needed = headcount1Idx >= 0 && !isNaN(Number(row[headcount1Idx])) ? Math.max(1, Number(row[headcount1Idx])) : 1;
    const priorityVal = priorityIdx >= 0 && row[priorityIdx] ? row[priorityIdx].toLowerCase() : "standard";
    const priority = priorityVal.includes("urgent") || priorityVal.includes("<15") || priorityVal.includes("crit") ? "critical" : priorityVal.includes("high") ? "high" : "standard";
    const project_name = projectIdx >= 0 && row[projectIdx] ? row[projectIdx] : undefined;

    if (!client && !rawLang && !rawService) continue;

    const targetLanguages = rawLang.split(/[,;/]+/).map(l => l.trim()).filter(Boolean);
    const serviceTypes = rawService.split(/[,;/]+/).map(s => s.trim()).filter(Boolean);

    for (const singleLang of targetLanguages.length > 0 ? targetLanguages : [rawLang || "English"]) {
      for (const singleService of serviceTypes.length > 0 ? serviceTypes : [rawService || "Subtitling"]) {
        result.push({
          client,
          language: singleLang,
          services: [singleService],
          headcount_needed: needed,
          filled: 0,
          gap: needed,
          recruiter_id: "r1",
          service_breakdown: [{ service: singleService, needed, filled: 0, gap: needed }],
          priority,
          status: "active",
          project_name,
          sheet_row_id: `sheet_row_${i}_${client.replace(/\s+/g, "_")}_${singleLang.replace(/\s+/g, "_")}_${singleService.replace(/\s+/g, "_")}`,
        });
      }
    }
  }

  return result;
}

/** Helper: Parse CSV/Excel sheet text content into Lead objects. */
export function parseCsvLeads(csvText: string): Omit<Lead, "id">[] {
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

  const nameIdx = findIdx(["fullname", "name", "candidate", "candidatename", "lead", "leadname"]);
  const emailIdx = findIdx(["email", "mail", "contactemail", "emailaddress", "emailid"]);
  const phoneIdx = findIdx(["contact", "contactnumber", "phone", "phonenumber", "mobile", "whatsapp", "tel", "cell"]);
  const profileIdx = findIdx(["profilelink", "linkedin", "linkedinurl", "link", "url", "profile", "social", "prozlink"]);
  const countryIdx = findIdx(["country", "location", "residence", "nation", "region", "city", "state"]);
  const langIdx = findIdx(["targetlanguage", "targetlang", "target_language", "language", "lang", "tolanguage"]);
  const sourceLangIdx = findIdx(["sourcelanguage", "srclang", "source_language", "fromlanguage"]);
  const serviceIdx = findIdx(["services", "service", "role", "specialization", "skills"]);
  const expIdx = findIdx(["yearsofexperience", "experience", "years", "exp", "yoexp", "yearsofexp"]);
  const vendorIdx = findIdx(["vendorexperience", "vendor", "clients", "history"]);
  const sourceIdx = findIdx(["source", "channel", "platform", "origin"]);

  const result: Array<Omit<Lead, "id"> & { email?: string; phone?: string; profile_link?: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (row.length < 2) continue;

    const name = nameIdx >= 0 && row[nameIdx] ? row[nameIdx].trim() : "";
    const email = emailIdx >= 0 && row[emailIdx] ? row[emailIdx].trim() : "";
    const phone = phoneIdx >= 0 && row[phoneIdx] ? row[phoneIdx].trim() : "";
    const profileLink = profileIdx >= 0 && row[profileIdx] ? row[profileIdx].trim() : "";
    const country = countryIdx >= 0 && row[countryIdx] ? row[countryIdx].trim() : "";
    const language = langIdx >= 0 && row[langIdx] ? row[langIdx].trim() : "";
    const sourceLanguage = sourceLangIdx >= 0 && row[sourceLangIdx] ? row[sourceLangIdx].trim() : "English";
    const rawServices = serviceIdx >= 0 && row[serviceIdx] ? row[serviceIdx].trim() : "";
    const services = rawServices
      ? rawServices.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean)
      : ["Subtitling"];
    const exp = expIdx >= 0 && !isNaN(Number(row[expIdx])) ? Number(row[expIdx]) : undefined;
    const vendor = vendorIdx >= 0 && row[vendorIdx] ? row[vendorIdx].trim() : undefined;
    const rawSource = sourceIdx >= 0 && row[sourceIdx] ? row[sourceIdx].trim() : "";
    const source: Source = rawSource.toLowerCase().includes("linkedin")
      ? "LinkedIn"
      : rawSource.toLowerCase().includes("proz")
      ? "ProZ"
      : rawSource.toLowerCase().includes("apollo")
      ? "Apollo"
      : rawSource.toLowerCase().includes("referral")
      ? "Referral"
      : rawSource.toLowerCase().includes("ada")
      ? "Ada"
      : rawSource.toLowerCase().includes("ata")
      ? "ATA"
      : "Import";

    if (!name && !email && !language && !profileLink) continue;

    const hasContact = !!(email || phone || profileLink);

    result.push({
      masked_label: name ? `Lead #${name}` : `Lead #${i}`,
      display_name: name || `Candidate #${i}`,
      identity_resolved: hasContact,
      email: email || undefined,
      phone: phone || undefined,
      profile_link: profileLink || (rawSource.includes("http") ? rawSource : undefined),
      country: country || undefined,
      language: language || "English",
      source_language: sourceLanguage,
      target_language: language || "English",
      services: services.length > 0 ? services : ["Subtitling"],
      stage: "New",
      availability: "Available Now",
      flags: hasContact ? [] : ["On Hold"],
      source,
      recruiter_id: "r1",
      verified_email: !!email,
      confirmed_language_pair: !!language,
      years_experience: exp,
      vendor_experience: vendor,
      last_activity: "Just now",
      created_at: new Date().toISOString(),
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
      // Network or CORS handling
    }
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

export const leads: Lead[] = [];

export const escalations: Escalation[] = [];

export const outreachBatch = {
  contacted: 0,
  awaiting_reply: 0,
  replied: 0,
  in_negotiation: 0,
  dnc: 0,
};

export function teamKpis() {
  const rs = recruiters;
  const avg = (fn: (r: Recruiter) => number) => (rs.length ? Math.round(rs.reduce((a, r) => a + fn(r), 0) / rs.length) : 0);
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

// AI Draft Analytics
export const aiDraftStats = {
  total_generated: 0,
  sent_without_edit_pct: 0,
  edited_before_send_pct: 0,
  discarded_pct: 0,
  avg_edit_rate_pct: 0,
  acceptance_rate_pct: 0,
};

export const profileCompleteness = {
  before_enrichment: 0,
  after_enrichment: 0,
  verified_email_pct: 0,
  confirmed_language_pair_pct: 0,
  experience_data_pct: 0,
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
