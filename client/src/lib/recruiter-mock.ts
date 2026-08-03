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

const seedLeads: RecruiterLead[] = [
  seed("Adrian", "Adrian Steiner", "Germany", "LinkedIn", "adrian@example.com", ["Subtitling"], "German", "English", 9, "Netflix, Prime Video", "r_riya"),
  seed("Marta", "Marta Lopez", "Spain", "ProZ", "marta@example.com", ["Dubbing"], "Spanish", "English", 6, "Disney+, HBO", "r_riya"),
  seed("Kenji", "Kenji Watanabe", "Japan", "LinkedIn", "kenji@example.com", ["SDH", "CC"], "Japanese", "English", 12, "Sony Pictures", "r_riya"),
  seed("Sasha", "Sasha Romanov", "Russia", "GitHub", "sasha@example.com", ["Dubbing", "Subtitling"], "Russian", "English", 5, "Independent", "r_riya"),
  seed("Jane", "Jane Doe", "France", "Referral", "jane@example.com", ["AD"], "French", "English", 8, "Various", "r_other"),
  seed("Lena", "Lena Hoffmann", "Austria", "LinkedIn", "lena@example.com", ["Subtitling"], "German", "English", 4, "Sky Deutschland", "r_other"),
  seed("Diego", "Diego Martinez", "Argentina", "ProZ", "diego@example.com", ["Dubbing"], "Spanish", "English", 7, "Netflix LatAm", "r_riya"),
  seedContractor("Mateo", "Mateo Rossi", "Italy", "LinkedIn", "mateo.rossi@example.com", "+39 06 6987 1234", ["Subtitling", "Dubbing"], "Italian", "English", 7, "Netflix Europe", "complete", false),
  seedContractor("Hana", "Hana Tanaka", "Japan", "ProZ", "hana.t@example.co.jp", "+81 3 5555 0142", ["Voiceover"], "Japanese", "English", 11, "Sony Pictures, Hulu", "pending", true),
  seedContractor("Carlos", "Carlos Gomez", "Mexico", "Referral", "carlos.gomez@example.com", "+52 55 1234 5678", ["Subtitling"], "Spanish (LatAm)", "English", 5, "Prime Video LatAm", "pending", false),
  seedContractor("Freja", "Freja Lind", "Sweden", "LinkedIn", "freja.lind@example.se", "+46 8 123 4567", ["Dubbing", "QA"], "Swedish", "English", 8, "Viaplay", "complete", false),
  seedContractor("Yusuf", "Yusuf Al-Mansoor", "UAE", "ProZ", "yusuf.m@example.ae", "+971 4 321 9876", ["Voiceover", "Subtitling"], "Arabic", "English", 9, "MBC Group, OSN", "pending", true),
  seedContractor("Chloe", "Chloe Dubois", "France", "Import", "chloe.dubois@example.fr", "+33 1 42 68 55 00", ["Subtitling"], "French", "English", 4, "Canal+", "complete", false),
];

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
  leads: seedLeads,
  emailQueue: [
    { id: "eq1", lead_id: seedLeads[0].id, candidate_name: "Alex Chen", candidate_role: "Principal Software Engineer @ Meta", status: "AI Drafted", subject: "Architecting the Future: A specific note on your Failover work", body: "Hi Alex,\n\nI've been following your work at Meta, particularly your recent contributions to the distributed database resilience framework. The way you approached the quorum consensus problem in high-latency environments was masterfully executed.\n\nI'm currently leading a stealth-mode technical search for an Elite Systems Architecture firm founded by former AWS and Stripe leads. They're building a novel consensus engine for real-time edge computing. Given your background in Rust and multi-region failover systems, your expertise aligns perfectly with the technical challenges they are tackling.\n\nThey offer an environment that prioritizes deep engineering work over bureaucratic overhead, with a compensation package that reflects that level of impact ($450k - $600k TC + equity).\n\nWould you be open to a brief 10-minute technical sync next Tuesday or Wednesday afternoon?\n\n— Riya", preview: "Hi Alex, I was incredibly impressed by your recent open-source…", received_ago: "2m ago", ai_generated: true },
    { id: "eq2", lead_id: seedLeads[1].id, candidate_name: "Sarah Jenkins", candidate_role: "VP of Engineering @ Stripe", status: "Follow-up", subject: "Following up on the Technical Leadership role", body: "Hi Sarah,\n\nWanted to circle back on the Technical Leadership role we discussed last week. Let me know if you'd like to schedule a call.\n\n— Riya", preview: "Wanted to circle back on the Technical Leadership role we…", received_ago: "45m ago", ai_generated: false },
    { id: "eq3", lead_id: seedLeads[2].id, candidate_name: "Marcus Thorne", candidate_role: "Senior DevOps Architect @ Datadog", status: "AI Drafted", subject: "Your work on multi-region failover", body: "The way you architected the multi-region failover cluster is exactly the kind of problem-solving our client needs.\n\n— Riya", preview: "The way you architected the multi-region failover cluster is…", received_ago: "2h ago", ai_generated: true },
    { id: "eq4", lead_id: seedLeads[3].id, candidate_name: "Elena Rodriguez", candidate_role: "Lead Data Scientist @ OpenAI", status: "Review Needed", subject: "Sparse autoencoders research collaboration", body: "I noticed your research on sparse autoencoders and thought you'd be interested in what our client is building.\n\n— Riya", preview: "I noticed your research on sparse autoencoders and…", received_ago: "5h ago", ai_generated: false },
  ],
  conversations: [
    {
      id: "c1", lead_id: seedLeads[0].id, candidate_name: "Marcus Holloway", candidate_role: "Principal Architect @ CloudScale",
      channel: "LinkedIn", last_message: "I've reviewed the technical specs and…", last_ago: "2m ago", unread: true,
      messages: [
        { from: "them", text: "Hi there! Thanks for reaching out.", at: "10:12 AM" },
        { from: "me", text: "Great to connect — quick 15 min sync tomorrow?", at: "10:14 AM" },
      ],
    },
    {
      id: "c2", lead_id: seedLeads[1].id, candidate_name: "Sarah Chen", candidate_role: "Principal Architect @ CloudScale",
      channel: "LinkedIn", last_message: "Looking forward to the technical interview.", last_ago: "Active",
      unread: false,
      messages: [
        { from: "them", text: "Hi there! Thanks for reaching out. I've been following G3 Recruitment's work in the fintech space. The Principal Architect role you mentioned sounds incredibly challenging.", at: "10:14 AM" },
        { from: "me", text: "Glad to hear that, Sarah! Your background with distributed systems at CloudScale is exactly what the client is looking for. Would you be open to a 15-minute sync tomorrow to discuss the roadmap?", at: "10:16 AM" },
      ],
    },
    {
      id: "c3", lead_id: seedLeads[2].id, candidate_name: "Elena Rodriguez", candidate_role: "Lead Data Scientist",
      channel: "Instagram", last_message: "Loved your reel on subtitle timing!", last_ago: "1h ago", unread: true,
      messages: [{ from: "them", text: "Thanks for reaching out! Could you share more details?", at: "9:14 AM" }],
    },
    {
      id: "c4", lead_id: seedLeads[3].id, candidate_name: "James Dorian", candidate_role: "Senior Engineer",
      channel: "WhatsApp", last_message: "Sent the portfolio link. Let me know!", last_ago: "4h ago", unread: false,
      messages: [{ from: "them", text: "Sent the portfolio link over email.", at: "6:00 AM" }],
    },
    {
      id: "c5", lead_id: seedLeads[4].id, candidate_name: "Jane Doe", candidate_role: "AD Specialist",
      channel: "Instagram", last_message: "DM'd you my showreel 🎬", last_ago: "30m ago", unread: true,
      messages: [
        { from: "them", text: "Hi! Saw your post about AD roles — DM'd you my showreel 🎬", at: "9:40 AM" },
        { from: "me", text: "Amazing, taking a look now!", at: "9:45 AM" },
      ],
    },
    {
      id: "c6", lead_id: seedLeads[5].id, candidate_name: "Lena Hoffmann", candidate_role: "Subtitler (DE)",
      channel: "WhatsApp", last_message: "Available for a call at 4pm CET?", last_ago: "20m ago", unread: false,
      messages: [
        { from: "me", text: "Hi Lena — do you have 10 min today?", at: "2:10 PM" },
        { from: "them", text: "Available for a call at 4pm CET?", at: "2:22 PM" },
      ],
    },
    {
      id: "c7", lead_id: seedLeads[6].id, candidate_name: "Diego Martinez", candidate_role: "Dubbing Director",
      channel: "SMS", last_message: "Sure, send the brief over.", last_ago: "10m ago", unread: true,
      messages: [
        { from: "me", text: "Hi Diego, quick opportunity for a LatAm dubbing project — interested?", at: "3:01 PM" },
        { from: "them", text: "Sure, send the brief over.", at: "3:05 PM" },
      ],
    },
    {
      id: "c8", lead_id: seedLeads[0].id, candidate_name: "Adrian Steiner", candidate_role: "Subtitler (DE→EN)",
      channel: "SMS", last_message: "Got it, thanks!", last_ago: "2h ago", unread: false,
      messages: [
        { from: "me", text: "Sending contract details shortly.", at: "1:00 PM" },
        { from: "them", text: "Got it, thanks!", at: "1:04 PM" },
      ],
    },
  ],
  contractors: [
    { id: "ct1", name: "Alex Kim", email: "alex@global3.co", assigned_at: Date.now() - 1000 * 60 * 60 * 24 * 30, leads_added_30d: 12, last_active: "3h ago" },
    { id: "ct2", name: "Priya Nair", email: "priya@global3.co", assigned_at: Date.now() - 1000 * 60 * 60 * 24 * 14, leads_added_30d: 6, last_active: "Yesterday" },
  ],
  unassignedContractors: [
    { id: "ct3", name: "Diego Vargas", email: "diego@global3.co", assigned_at: 0, leads_added_30d: 0, last_active: "—" },
    { id: "ct4", name: "Mei Tanaka", email: "mei@global3.co", assigned_at: 0, leads_added_30d: 0, last_active: "—" },
  ],
  weekly: [
    { week: "W1", emails_sent: 62, emails_replied: 14, dms_sent: 38, dms_replied: 11 },
    { week: "W2", emails_sent: 74, emails_replied: 19, dms_sent: 42, dms_replied: 13 },
    { week: "W3", emails_sent: 58, emails_replied: 12, dms_sent: 51, dms_replied: 17 },
    { week: "W4", emails_sent: 81, emails_replied: 22, dms_sent: 47, dms_replied: 14 },
    { week: "W5", emails_sent: 69, emails_replied: 18, dms_sent: 55, dms_replied: 19 },
  ],
};

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

  // Simulated background enrichment job.
  setTimeout(() => {
    const idx = store.leads.findIndex((l) => l.id === lead.id);
    if (idx === -1) return;
    const enriched: RecruiterLead = {
      ...store.leads[idx],
      years_of_exp: 3 + Math.floor(Math.random() * 12),
      vendor_experience: "Netflix, Prime Video",
      enrichment_status: "complete",
      just_enriched_until: Date.now() + 60_000,
    };
    store.leads = store.leads.map((l) => (l.id === lead.id ? enriched : l));
    emit();
  }, 2000);

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

// -------------------- contractor profile --------------------

export interface ContractorProfile {
  full_name: string;
  headline: string;
  country_of_residence: string;
  timezone: string;
  bio: string;
  avatar_data_url: string | null;
  email: string;
  email_verified: boolean;
  phone: string;
  whatsapp: string;
  preferred_contact: "Email" | "Phone" | "WhatsApp";
  services: string[];
  source_language: string;
  target_languages: string[];
  secondary_languages: string[];
  years_of_exp: number;
  vendor_experience: string;
  rate_amount: number;
  rate_unit: "hour" | "minute" | "project";
  currency: "USD" | "EUR" | "GBP" | "INR";
  resume_filename: string | null;
  resume_size_kb: number | null;
  portfolio_url: string;
  linkedin_url: string;
  proz_url: string;
  website_url: string;
  availability_status: "Available Now" | "Available from date" | "Unavailable";
  available_from: string | null;
  weekly_capacity_hours: number;
  blackout_dates: string[];
  notify_new_lead: boolean;
  notify_duplicate: boolean;
  notify_message: boolean;
  notify_weekly_digest: boolean;
  two_fa_enabled: boolean;
}

const contractorProfile: ContractorProfile = {
  full_name: "Alex Kim",
  headline: "Senior Subtitler · EN ↔ KO",
  country_of_residence: "South Korea",
  timezone: "Asia/Seoul (GMT+9)",
  bio: "10+ years subtitling and QC for streaming platforms. Focus on drama and documentary.",
  avatar_data_url: null,
  email: "alex@global3.co",
  email_verified: true,
  phone: "+82 10 5555 0134",
  whatsapp: "+82 10 5555 0134",
  preferred_contact: "Email",
  services: ["Subtitling", "SDH"],
  source_language: "Korean",
  target_languages: ["English"],
  secondary_languages: ["Japanese"],
  years_of_exp: 11,
  vendor_experience: "Netflix, Disney+, Sony Pictures",
  rate_amount: 6.5,
  rate_unit: "minute",
  currency: "USD",
  resume_filename: "alex-kim-cv-2026.pdf",
  resume_size_kb: 284,
  portfolio_url: "https://alexkim.work",
  linkedin_url: "https://linkedin.com/in/alexkim",
  proz_url: "https://proz.com/profile/alexkim",
  website_url: "",
  availability_status: "Available Now",
  available_from: null,
  weekly_capacity_hours: 28,
  blackout_dates: [],
  notify_new_lead: true,
  notify_duplicate: true,
  notify_message: true,
  notify_weekly_digest: false,
  two_fa_enabled: false,
};

const profileListeners = new Set<() => void>();
function emitProfile() { profileListeners.forEach((l) => l()); }

export function useContractorProfile(): ContractorProfile {
  return useSyncExternalStore(
    (l) => { profileListeners.add(l); return () => { profileListeners.delete(l); }; },
    () => contractorProfile,
    () => contractorProfile,
  );
}

export function updateContractorProfile(patch: Partial<ContractorProfile>) {
  Object.assign(contractorProfile, patch);
  emitProfile();
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