// Mock data for Ethan's owner dashboard.
// Uses schema field names from reference doc: stage, availability, flags, source, language, services.

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
  services: string[];
  stage: Stage;
  availability: Availability;
  flags: Flag[];
  source: Source;
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

export interface ServiceRequirement {
  service: string;
  needed: number;
  filled: number;
  gap: number;
}

export interface Escalation {
  id: string;
  priority: "P1" | "P2" | "P3";
  status: "Open" | "Acknowledged" | "In Progress";
  category:
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
    category: "Client Risk",
    owner: "Ethan",
    title: "Client Alpha threatening cancellation — French subtitling gap 8/12",
    detail:
      "Alpha's programme manager escalated: 4 of 12 seats filled, delivery risk on Q3 slate. Two prior asks left unresolved for 5+ days.",
    recommended_action: "Owner call with Alpha today; reallocate Divya + 2 contractors to French subtitling.",
    age_days: 5,
    sla_hours_remaining: -18,
    impact: "$1.4M ARR at risk",
    recruiter_id: "r1",
  },
  {
    id: "e2",
    priority: "P1",
    status: "Acknowledged",
    category: "SLA Breach",
    owner: "Sharmista",
    title: "SLA breach — Client Beta Japanese VO 72h overdue",
    detail: "Committed 48h turnaround on shortlist for Beta's Japanese voiceover; currently 120h with no delivery.",
    recommended_action: "Reassign to Sharmista; notify Beta with revised ETA within 4 hours.",
    age_days: 5,
    sla_hours_remaining: -72,
    impact: "Contract penalty clause triggers at 96h overrun",
    recruiter_id: "r2",
    lead_id: "l2",
  },
  {
    id: "e3",
    priority: "P2",
    status: "Open",
    category: "Recruiter Performance",
    owner: "Ethan",
    title: "Contractor B — reply rate down 68% MoM",
    detail: "Overall score 38 (team avg 67). Placement success 22% and SLA adherence 54% for 3 consecutive weeks.",
    recommended_action: "Schedule 1:1 performance review; pause new lead assignment until plan agreed.",
    age_days: 4,
    impact: "Blocking 2 Korean + 1 Arabic seats",
    recruiter_id: "c2",
  },
  {
    id: "e4",
    priority: "P2",
    status: "In Progress",
    category: "AI Pipeline",
    owner: "Engineering",
    title: "Enrichment pipeline failed on 42 leads overnight",
    detail:
      "Background enrichment job errored at 02:14 UTC. 42 leads sitting with SEARCH fields only; recruiters cannot triage.",
    recommended_action: "Restart job + audit LinkedIn scraper token; backfill within 6h.",
    age_days: 1,
    sla_hours_remaining: 5,
    impact: "Recruiter throughput ↓ ~15% today",
  },
  {
    id: "e5",
    priority: "P2",
    status: "Open",
    category: "Client Demand",
    owner: "Madhu",
    title: "Client Gamma — Korean intake 5 days unactioned",
    detail: "10 headcount request logged 5 days ago, no outreach batch triggered.",
    recommended_action: "Kick off Korean outreach batch by EOD; brief Gamma on staged delivery.",
    age_days: 5,
    sla_hours_remaining: -24,
    recruiter_id: "r2",
  },
  {
    id: "e6",
    priority: "P3",
    status: "Open",
    category: "Invoicing",
    owner: "Finance",
    title: "Client Alpha — 3 placements unbilled, PO pending",
    detail: "PO #ALP-2211 pending Alpha approval for 21 days. $186k unbilled.",
    recommended_action: "Finance to chase Alpha AP; hold further placements against this PO.",
    age_days: 21,
    impact: "$186k cash lock",
  },
  {
    id: "e7",
    priority: "P3",
    status: "Open",
    category: "Compliance",
    owner: "Madhu",
    title: "DNC conflict — Lead #F-5502 received outreach draft",
    detail: "Lead flagged On Hold / DNC but AI drafter queued a follow-up. Compliance risk.",
    recommended_action: "Purge draft; add lead to global DNC list; retrain drafter filter.",
    age_days: 2,
    recruiter_id: "r2",
    lead_id: "l8",
  },
  {
    id: "e8",
    priority: "P3",
    status: "Open",
    category: "Strategic Drop-off",
    owner: "Divya",
    title: "2 strategic Mandarin candidates went cold post-offer",
    detail: "Both were Alpha shortlist finalists at offer stage. No response for 6 days.",
    recommended_action: "Warm re-engagement from Divya; counter-offer review with Ethan if needed.",
    age_days: 6,
    impact: "Delays Alpha Q3 dubbing slate",
    recruiter_id: "r1",
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
import { useSyncExternalStore } from "react";
const stageOverrides: Record<string, Stage> = {};
const stageListeners = new Set<() => void>();
function emitStage() {
  stageListeners.forEach((l) => l());
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
