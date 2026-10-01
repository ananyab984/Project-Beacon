// Recruiter Performance Evaluation — Project Beacon rubric.
// Updated metric structure: Activity & Effort, Ownership & Follow-through, Outcome Metrics.

export type MetricGroup =
  | "Activity & Effort"
  | "Ownership & Follow-through"
  | "Outcome Metrics";

export const METRIC_GROUPS: MetricGroup[] = [
  "Activity & Effort",
  "Ownership & Follow-through",
  "Outcome Metrics",
];

export type Unit = "count" | "pct" | "days" | "attempts";
export type Direction = "higher" | "lower";
export type TrendDir = "up" | "down" | "flat" | "new";
export type MetricStatus = "on_track" | "watch" | "off_track" | "signal";

export function formatValue(unit: Unit, val: number | null): string {
  if (val === null) return "—";
  if (unit === "pct") return `${val}%`;
  if (unit === "days") return `${val}d`;
  if (unit === "attempts") return `${val}x`;
  return `${val}`;
}

export interface MetricDef {
  id: string;
  label: string;
  group: MetricGroup;
  definition: string;
  calculation: string;
  unit: Unit;
  direction: Direction;
  target: number | null;      // null = signal only / trend-tracked
  targetLabel: string;
  scored: boolean;            // counts toward the overall score
  weight: number;             // % out of 100 across scored metrics
  goodBand: number;           // value considered "full marks" when normalising
}

export const RUBRIC: MetricDef[] = [
  {
    id: "outreach_volume",
    label: "Outreach volume",
    group: "Activity & Effort",
    definition: "How many outreach messages the recruiter sent this month.",
    calculation: "Total count of outreach messages sent.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Track trend, not a fixed number",
    scored: true, weight: 30, goodBand: 420,
  },
  {
    id: "proactive_sourcing",
    label: "Proactive sourcing",
    group: "Activity & Effort",
    definition: "Candidates they found and added themselves, beyond what was assigned to them.",
    calculation: "Count of self-sourced candidates added.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "More is better",
    scored: true, weight: 30, goodBand: 34,
  },
  {
    id: "time_to_first_touch",
    label: "Time-to-first-touch",
    group: "Activity & Effort",
    definition: "How quickly they reach out after getting a new lead.",
    calculation: "Average days between a lead being assigned and their first message.",
    unit: "days", direction: "lower", target: 2,
    targetLabel: "2 business days or less",
    scored: true, weight: 20, goodBand: 1,
  },
  {
    id: "progression_rate",
    label: "Progression rate",
    group: "Ownership & Follow-through",
    definition: "Whether contacted leads actually move forward, not just get one message and stall.",
    calculation: "% of contacted leads that advance at least one stage.",
    unit: "pct", direction: "higher", target: 60,
    targetLabel: "Track trend upward",
    scored: true, weight: 10, goodBand: 80,
  },
  {
    id: "reason_logged_rate",
    label: "Reason-logged rate",
    group: "Ownership & Follow-through",
    definition: "Whether they explain why a lead went Cold or DNC, instead of just closing it silently.",
    calculation: "% of their own Cold/DNC leads with a one-line reason noted.",
    unit: "pct", direction: "higher", target: 90,
    targetLabel: "High",
    scored: true, weight: 10, goodBand: 100,
  },
  {
    id: "onboard_vs_queue",
    label: "Onboarding vs. queue size",
    group: "Outcome Metrics",
    definition: "How many leads they close, relative to how many they were given.",
    calculation: "Total candidates onboarded ÷ total leads assigned to them.",
    unit: "pct", direction: "higher", target: null,
    targetLabel: "Signal only — no target",
    scored: false, weight: 0, goodBand: 100,
  },
  {
    id: "cold_lead_conversion",
    label: "Cold lead conversion count",
    group: "Outcome Metrics",
    definition: "Leads previously marked Cold that the recruiter revived into an active stage.",
    calculation: "Count of Cold leads moved back into an active stage this month.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Nice to have — more is better",
    scored: false, weight: 0, goodBand: 18,
  },
  {
    id: "manual_interviews",
    label: "Manual interviews conducted",
    group: "Outcome Metrics",
    definition: "Interviews the recruiter personally ran outside the automated workflow.",
    calculation: "Count of recruiter-led interview sessions logged.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Nice to have — more is better",
    scored: false, weight: 0, goodBand: 15,
  },
  {
    id: "manual_conversion",
    label: "Manual conversion count",
    group: "Outcome Metrics",
    definition: "Cases where the recruiter personally scheduled calls or manually engaged important resources outside the standard automated workflow.",
    calculation: "Count of conversions attributed to manual recruiter engagement.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Nice to have — more is better",
    scored: false, weight: 0, goodBand: 10,
  },
];

export const SCORE_BANDS = [
  { min: 85, label: "Strong", meaning: "Minimal oversight needed", tone: "positive" as const },
  { min: 70, label: "Solid", meaning: "Meeting expectations", tone: "neutral" as const },
  { min: 55, label: "Coaching", meaning: "Needs a coaching conversation, with a named area", tone: "warning" as const },
  { min: 1,  label: "Review", meaning: "Requires review this week, not next cycle", tone: "critical" as const },
  { min: 0,  label: "No Data", meaning: "No activity recorded yet", tone: "neutral" as const },
];

export function bandFor(score: number) {
  return SCORE_BANDS.find((b) => score >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

import { recruiterById, type RecruiterKPIs } from "@/lib/g3-mock";

export interface MetricSnapshot {
  def: MetricDef;
  current: number;
  previous: number;
  history: number[];
  status: MetricStatus;
  scoreContribution: number;
}

export interface Evaluation {
  subjectId: string;
  subjectName: string;
  score: number;
  band: typeof SCORE_BANDS[number];
  metrics: MetricSnapshot[];
  outreach: {
    completed: number;
    assigned: number;
    targetAchieved: boolean;
    achievedPct: number;
  };
  sourcing: {
    assigned: number;
    selfSourced: number;
    ratioLabel: string;
    selfPct: number;
  };
}

export function getEvaluation(subjectId: string, subjectName: string): Evaluation {
  const rec = recruiterById(subjectId);
  const kpis = rec?.kpis;

  const snapshots: MetricSnapshot[] = RUBRIC.map((def) => {
    let current = 0;
    if (kpis && def.id in kpis) {
      current = kpis[def.id as keyof RecruiterKPIs] ?? 0;
    }

    let status: MetricStatus = "signal";
    if (def.target === null || current === 0) {
      status = "signal";
    } else if (def.direction === "lower") {
      if (current <= def.target) status = "on_track";
      else if (current <= def.target * 1.5) status = "watch";
      else status = "off_track";
    } else {
      if (current >= def.target) status = "on_track";
      else if (current >= def.target * 0.8) status = "watch";
      else status = "off_track";
    }

    let scoreContribution = 0;
    if (def.scored && def.weight > 0 && current > 0) {
      let ratio = 0;
      if (def.direction === "lower") {
        ratio = Math.max(0, 1 - Math.max(0, current - def.goodBand) / Math.max(1, def.goodBand * 2));
      } else {
        ratio = Math.min(1, current / def.goodBand);
      }
      scoreContribution = Math.round(ratio * def.weight);
    }

    return {
      def,
      current,
      previous: 0,
      history: [0, 0, 0, 0, 0, current],
      status,
      scoreContribution,
    };
  });

  const totalScore = kpis?.overall_score ?? snapshots.reduce((acc, s) => acc + s.scoreContribution, 0);

  const outreachCompleted = kpis?.outreach_volume ?? 0;
  const outreachAssigned = kpis ? Math.round(outreachCompleted * 1.05) : 0;
  const assignedLeads = rec?.leads_onboarded ? rec.leads_onboarded * 3 : 0;
  const selfSourcedLeads = rec?.leads_onboarded ? Math.round(rec.leads_onboarded * 0.8) : 0;
  const totalLeads = assignedLeads + selfSourcedLeads;
  const selfPct = totalLeads ? Math.round((selfSourcedLeads / totalLeads) * 100) : 0;

  return {
    subjectId,
    subjectName,
    score: totalScore,
    band: bandFor(totalScore),
    metrics: snapshots,
    outreach: {
      completed: outreachCompleted,
      assigned: outreachAssigned,
      targetAchieved: outreachCompleted > 0 && outreachCompleted >= outreachAssigned,
      achievedPct: outreachAssigned ? Math.round((outreachCompleted / outreachAssigned) * 100) : 0,
    },
    sourcing: {
      assigned: assignedLeads,
      selfSourced: selfSourcedLeads,
      ratioLabel: totalLeads ? `${100 - selfPct} : ${selfPct}` : "0 : 0",
      selfPct,
    },
  };
}