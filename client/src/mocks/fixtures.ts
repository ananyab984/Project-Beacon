/**
 * Isolated Seed Fixtures for Testing & Development Mocking.
 * Strictly isolated from production UI component rendering.
 */

export interface InitialNotificationFixture {
  id: string;
  type: "message_received" | "lead_update" | "draft_message" | "due_date_risk";
  title: string;
  leadName: string;
  language: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

export const INITIAL_NOTIFICATIONS_FIXTURE: InitialNotificationFixture[] = [
  {
    id: "notif-1",
    type: "message_received",
    title: "Message received from candidate",
    leadName: "Takeshi Kovacs",
    language: "Japanese",
    detail: "Replied to outreach: 'Interested in Japanese Dubbing role. Available to start next week.'",
    timestamp: "10m ago",
    read: false,
  },
  {
    id: "notif-2",
    type: "lead_update",
    title: "Lead update",
    leadName: "Maria Garcia",
    language: "Spanish (Spain)",
    detail: "Secondary profile & vendor certifications automatically enriched by system.",
    timestamp: "1h ago",
    read: false,
  },
  {
    id: "notif-3",
    type: "draft_message",
    title: "Draft a message for new lead",
    leadName: "Jean Dupont",
    language: "French",
    detail: "New self-sourced lead assigned. Click 'Generate Draft' in Email Queue to reach out.",
    timestamp: "3h ago",
    read: false,
  },
];

export interface PipelineFixture {
  id: string;
  name: string;
  description: string;
  iconName: "Linkedin" | "BrainCircuit" | "Mail" | "Sparkles" | "Zap";
  status: "active" | "inactive" | "running" | "failed";
  enabled: boolean;
  runs_today: number;
  success_rate: number;
  last_run: string;
  category: "matching" | "outreach" | "enrichment";
}

export const PIPELINE_FIXTURES: PipelineFixture[] = [
  { id: "p1", name: "LinkedIn Identity Match", description: "Answers 'who is this person?' — resolves ambiguous LinkedIn profiles, matches incoming candidates to existing records, and links multiple sources into one canonical identity to prevent duplicate leads.", iconName: "Linkedin", status: "active", enabled: true, runs_today: 412, success_rate: 0.87, last_run: "2 min ago", category: "matching" },
  { id: "p2", name: "Reply Intent Classifier", description: "Tags inbound replies as Interested / FAQ / Not now / Decline.", iconName: "BrainCircuit", status: "running", enabled: true, runs_today: 156, success_rate: 0.62, last_run: "just now", category: "outreach" },
  { id: "p3", name: "Cold-Email Drafts", description: "Generates first-touch drafts scoped by language + service.", iconName: "Mail", status: "active", enabled: true, runs_today: 88, success_rate: 0.91, last_run: "8 min ago", category: "outreach" },
  { id: "p4", name: "Profile Enrichment", description: "Answers 'what else do we know?' — enriches an already-identified candidate with verified email, skills, language pairs, experience, resume metadata, employment history, headline, location, tech stack and profile completeness.", iconName: "Sparkles", status: "inactive", enabled: false, runs_today: 0, success_rate: 0.78, last_run: "yesterday", category: "enrichment" },
  { id: "p6", name: "Duplicate Detection", description: "Flags likely duplicates across sources before outreach.", iconName: "Zap", status: "active", enabled: true, runs_today: 27, success_rate: 0.95, last_run: "22 min ago", category: "matching" },
];

export interface ReportItemFixture {
  id: string;
  name: string;
  type: "pdf" | "csv" | "log";
  range: string;
  generated: string;
}

export const RECENT_REPORTS_FIXTURE: ReportItemFixture[] = [
  { id: "r0", name: "Assignment History & Activity Log", type: "log", range: "Real-time", generated: "live updated" },
  { id: "r1", name: "Weekly Recruiter Scorecard", type: "pdf", range: "Nov 11–17", generated: "generated today, 08:12" },
  { id: "r2", name: "Q4 Language Fill Analysis", type: "pdf", range: "Q4", generated: "generated 2d ago" },
  { id: "r3", name: "Leads Pipeline Export", type: "csv", range: "Last 30d", generated: "generated 3d ago" },
  { id: "r4", name: "Outreach Volume Trend", type: "csv", range: "Last 90d", generated: "generated last week" },
];
