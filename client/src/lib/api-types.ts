// Types mirroring server/prisma/schema.prisma exactly (camelCase, matching
// Prisma's generated client) -- the source of truth for every real API call.
// Do not confuse these with the snake_case mock types in g3-mock.ts /
// recruiter-mock.ts, which are a different, legacy shape being replaced.

export type UserRole = "OWNER" | "RECRUITER" | "CONTRACTOR";
export type WorkStatus = "PERMANENT" | "CONTRACTOR";

export type LeadStage = "NEW" | "CONTACTED" | "REPLIED" | "NEGOTIATING" | "INVITE_SENT" | "ONBOARDED" | "COLD";
export type LeadStatus =
  | "NEW" | "CONTACTED" | "AWAITING_REPLY" | "REPLIED" | "SCREENING" | "INTERVIEW_SCHEDULED"
  | "INTERVIEW_COMPLETED" | "NEGOTIATION" | "OFFERED" | "PLACED" | "ON_HOLD" | "CLOSED" | "REJECTED";
export type LeadPriority = "P0" | "P1" | "P2" | "P3";
export type LeadFlagType = "DNC" | "ON_HOLD" | "WATCHING" | "HIGH_PRIORITY";
export type Availability = "AVAILABLE_NOW" | "AVAILABLE_FROM" | "UNAVAILABLE" | "UNKNOWN";
export type EnrichmentStatus = "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FLAGGED_REVIEW";
export type LeadSource = "LINKEDIN" | "PROZ" | "ADA" | "ATA" | "ATAA" | "BODALGO" | "FREELANCER" | "APOLLO";

export interface ApiLead {
  id: string;
  createdByRecruiterId: string | null;
  createdByContractorId: string | null;
  assignedRecruiterId: string | null;
  assignedAt: string | null;
  isSelfSourced: boolean;
  claimedByRecruiterId: string | null;
  claimedAt: string | null;
  dupFlagged: boolean;
  dupFlaggedField: string | null;
  enrichmentStatus: EnrichmentStatus;
  promotedToGlobalAt: string | null;
  justEnrichedUntil: string | null;
  stage: LeadStage;
  status: LeadStatus;
  priority: LeadPriority | null;
  flags: LeadFlagType[];
  closureReason: string | null;
  closureReasonLoggedAt: string | null;
  maskedLabel: string | null;
  identityResolved: boolean;
  displayName: string | null;
  firstName: string | null;
  fullName: string | null;
  profileLink: string | null;
  country: string | null;
  contactNumber: string | null;
  email: string | null;
  emailVerified: boolean;
  reachoutDate: string | null;
  applicationDate: string | null;
  services: string[];
  sourceLanguage: string | null;
  targetLanguage: string | null;
  secondaryLanguages: string[];
  source: LeadSource;
  yearsOfExperience: number | null;
  vendorExperience: string | null;
  availability: Availability;
  availabilityFromDate: string | null;
  createdAt: string;
  lastActivityAt: string | null;
}

export interface LeadTimelineEvent {
  type: "STAGE_CHANGE" | "FLAG" | "INTERACTION" | "MANUAL_ACTIVITY";
  at: string;
  data: Record<string, any>;
}

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  workStatus: WorkStatus;
  languages: string[];
  emailVerified: boolean;
  isActive: boolean;
  startDate: string;
  createdAt: string;
  /** Only present on role=CONTRACTOR listings. */
  managingRecruiterId?: string | null;
  /** Outreach accounts connected by this recruiter */
  connectedAccounts?: Array<{
    id?: string;
    provider: string;
    accountName?: string | null;
    status: string;
    unipileAccountId: string;
  }>;
}

export interface ApiClient {
  id: string;
  name: string;
  industry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  createdAt: string;
}

export type RequirementStatus = "UNASSIGNED" | "ACTIVE" | "PAUSED" | "FULFILLED";
export type ClientDemandPriority = "STANDARD" | "HIGH" | "CRITICAL";

export interface ApiRequirement {
  id: string;
  clientId: string;
  client?: { name: string };
  recruiter?: { name: string } | null;
  title: string;
  language: string;
  service: string;
  region: string | null;
  projectName: string | null;
  headcountNeeded: number;
  filled: number;
  gap: number;
  priority: ClientDemandPriority;
  status: RequirementStatus;
  recruiterId: string | null;
  deadline: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ApiClientDemandService {
  id: string;
  service: string;
  needed: number;
  filled: number;
  gap: number;
}

export interface ApiClientDemand {
  id: string;
  clientId: string;
  client?: { name: string };
  language: string;
  recruiterId: string | null;
  headcountNeeded: number;
  filled: number;
  gap: number;
  projectName: string | null;
  priority: ClientDemandPriority;
  deadline: string | null;
  status: "ACTIVE" | "PAUSED" | "FULFILLED";
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  submittedAt: string;
  serviceBreakdown: ApiClientDemandService[];
}

export type EmailQueueStatus = "AI_DRAFTED" | "FOLLOW_UP" | "REVIEW_NEEDED" | "SENT";

export interface ApiEmailQueueItem {
  id: string;
  leadId: string;
  lead?: { fullName: string | null; displayName: string | null; email?: string | null; profileLink?: string | null };
  recruiterId: string;
  candidateName: string;
  candidateRole: string | null;
  status: EmailQueueStatus;
  subject: string;
  body: string;
  aiGenerated: boolean;
  receivedAt: string;
  sentAt: string | null;
  sentChannel: "LINKEDIN" | "EMAIL" | null;
}

export type ConversationChannel = "LINKEDIN" | "INSTAGRAM" | "WHATSAPP" | "SMS";
export type MessageSender = "ME" | "THEM";

export interface ApiConversationMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;
  sentAt: string;
}

export interface ApiConversation {
  id: string;
  leadId: string;
  lead?: { fullName: string | null; displayName: string | null; email?: string | null; profileLink?: string | null };
  recruiterId: string;
  candidateName: string;
  candidateRole: string | null;
  channel: ConversationChannel;
  unread: boolean;
  lastMessageAt: string | null;
  messages: ApiConversationMessage[];
}

export type EscalationPriority = "P1" | "P2" | "P3";
export type EscalationStatus = "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS";

export interface ApiEscalation {
  id: string;
  priority: EscalationPriority;
  status: EscalationStatus;
  category: string;
  ownerUserId: string | null;
  title: string;
  detail: string;
  recommendedAction: string;
  slaHoursRemaining: number | null;
  impact: string | null;
  recruiterId: string | null;
  leadId: string | null;
  clientId: string | null;
  createdAt: string;
}

export interface ApiKpiConfig {
  id: string;
  metricKey: string;
  group: string;
  label: string;
  unit: string;
  weight: number | null;
  target: number | null;
  goodBand: number | null;
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  scored: boolean;
  effectiveDate: string;
  notes: string | null;
}

export interface ApiRecruiterMetricSnapshot {
  id: string;
  scoreSnapshotId: string;
  metricKey: string;
  currentValue: number;
  previousValue: number | null;
  baseline: number | null;
  changePct: number | null;
  trend: string | null;
  metricStatus: string | null;
  normalized: number;
}

export interface ApiRecruiterScoreSnapshot {
  id: string;
  recruiterId: string;
  period: string;
  isNew: boolean;
  overallScore: number;
  previousScore: number | null;
  bandLabel: string | null;
  summary: string | null;
  computedAt: string;
}

export interface ApiRecruiterKpiSummary {
  id: string;
  recruiterId: string;
  outreachEffectiveness: number;
  responseRate: number;
  slaAdherence: number;
  overallScore: number;
  outreachVolume: number;
  dncPct: number;
  interviewToOffer: number;
  offerAcceptance: number;
  profileQuality: number;
  clientSatisfaction: number;
  aiAdoption: number;
  pipelineHealth: number;
  emailOpenRate: number;
  avgTurnaroundDays: number;
  computedAt: string;
}

export interface ApiSheetSyncConfig {
  sheetUrl: string | null;
  lastSyncedAt: string | null;
}

/** Shape of every thrown error from the `request()` helper in api.ts. */
export interface ApiRequestError extends Error {
  code?: string;
  status?: number;
}
