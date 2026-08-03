// Recruiter Performance Evaluation — Project Beacon rubric.
// 11 scored/watched core metrics from the rubric + extended business metrics.
// All values are deterministic mock data seeded per subject id.

export type MetricGroup =
  | "Activity & Effort"
  | "Responsiveness"
  | "Ownership & Follow-through"
  | "Outcome Metrics"
  | "Additional Business Metrics";

export const METRIC_GROUPS: MetricGroup[] = [
  "Activity & Effort",
  "Responsiveness",
  "Ownership & Follow-through",
  "Outcome Metrics",
  "Additional Business Metrics",
];

export type Unit = "count" | "pct" | "days" | "attempts";
export type Direction = "higher" | "lower";
export type TrendDir = "up" | "down" | "flat" | "new";
export type MetricStatus = "on_track" | "watch" | "off_track" | "signal";

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

// NOTE: Section 4 of the rubric leaves weights "still to be defined".
// This is a documented default split — Activity 30 / Responsiveness 40 /
// Ownership 30 — retune this single constant once the business signs off.
export const RUBRIC: MetricDef[] = [
  {
    id: "outreach_volume",
    label: "Outreach volume",
    group: "Activity & Effort",
    definition: "How many outreach messages the recruiter sent this month.",
    calculation: "Total count of outreach messages sent.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Track trend, not a fixed number",
    scored: true, weight: 10, goodBand: 420,
  },
  {
    id: "followup_persistence",
    label: "Follow-up persistence",
    group: "Activity & Effort",
    definition: "Whether they follow up more than once before giving up on a lead.",
    calculation: "Average number of times they contact a lead before it's marked Replied or Cold.",
    unit: "attempts", direction: "higher", target: 2,
    targetLabel: "Watch for a drop to just 1 attempt",
    scored: true, weight: 10, goodBand: 3,
  },
  {
    id: "proactive_sourcing",
    label: "Proactive sourcing",
    group: "Activity & Effort",
    definition: "Candidates they found and added themselves, beyond what was assigned to them.",
    calculation: "Count of self-sourced candidates added.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "More is better",
    scored: true, weight: 10, goodBand: 34,
  },
  {
    id: "time_to_first_touch",
    label: "Time-to-first-touch",
    group: "Responsiveness",
    definition: "How quickly they reach out after getting a new lead.",
    calculation: "Average days between a lead being assigned and their first message.",
    unit: "days", direction: "lower", target: 2,
    targetLabel: "2 business days or less",
    scored: true, weight: 14, goodBand: 1,
  },
  {
    id: "sla_adherence",
    label: "SLA adherence (urgent leads)",
    group: "Responsiveness",
    definition: "Whether urgent/flagged leads get a reply within the agreed time window.",
    calculation: "% of flagged leads responded to within the set window (e.g. 2 hours).",
    unit: "pct", direction: "higher", target: 90,
    targetLabel: "90% or higher",
    scored: true, weight: 14, goodBand: 100,
  },
  {
    id: "backlog_aging",
    label: "Backlog aging",
    group: "Responsiveness",
    definition: "Leads that have sat with no contact at all for too long.",
    calculation: "% of assigned leads with zero contact for 3+ business days.",
    unit: "pct", direction: "lower", target: 0,
    targetLabel: "0%",
    scored: true, weight: 12, goodBand: 0,
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
    id: "closure_rate",
    label: "Closure rate",
    group: "Ownership & Follow-through",
    definition: "Whether leads reach a final outcome instead of sitting open forever.",
    calculation: "% of assigned leads that end in Onboarded, confirmed Cold, or confirmed DNC.",
    unit: "pct", direction: "higher", target: 55,
    targetLabel: "Track trend upward",
    scored: true, weight: 10, goodBand: 75,
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
    id: "interview_conversion",
    label: "Interview conversion",
    group: "Outcome Metrics",
    definition: "How often their leads actually reach the interview stage.",
    calculation: "% of their negotiating-stage leads that reach interview.",
    unit: "pct", direction: "higher", target: null,
    targetLabel: "Signal only — no target",
    scored: false, weight: 0, goodBand: 100,
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
    group: "Additional Business Metrics",
    definition: "Leads previously marked Cold that the recruiter revived into an active stage.",
    calculation: "Count of Cold leads moved back into an active stage this month.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Nice to have — more is better",
    scored: false, weight: 0, goodBand: 18,
  },
  {
    id: "manual_interviews",
    label: "Manual interviews conducted",
    group: "Additional Business Metrics",
    definition: "Interviews the recruiter personally ran outside the automated workflow.",
    calculation: "Count of recruiter-led interview sessions logged.",
    unit: "count", direction: "higher", target: null,
    targetLabel: "Nice to have — more is better",
    scored: false, weight: 0, goodBand: 15,
  },
  {
    id: "manual_conversion",
    label: "Manual conversion count",
    group: "Additional Business Metrics",
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
  { min: 0, label: "Review", meaning: "Requires review this week, not next cycle", tone: "critical" as const },
];

export function bandFor(score: number) {
  return SCORE_BANDS.find((b) => score >= b.min)!;
}

/* ------------------------------------------------------------------ */
/* Deterministic mock history                                          */
/* ------------------------------------------------------------------ */

export const MONTHS = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function series(subject: string, metric: MetricDef): number[] {
  const base = hash(subject + metric.id);
  const drift = hash(subject + metric.id + "d") - 0.45;
  return MONTHS.map((m, i) => {
    const wobble = hash(subject + metric.id + m) - 0.5;
    const t = i / (MONTHS.length - 1);
    let v: number;
    switch (metric.unit) {
      case "pct": {
        const floor = metric.direction === "lower" ? 0 : 45;
        const span = metric.direction === "lower" ? 22 : 55;
        v = floor + base * span + drift * t * 18 + wobble * 8;
        v = Math.max(0, Math.min(100, v));
        return Math.round(v);
      }
      case "days":
        v = 0.8 + base * 3.2 - drift * t * 1.2 + wobble * 0.6;
        return Math.round(Math.max(0.3, v) * 10) / 10;
      case "attempts":
        v = 1.1 + base * 2.4 + drift * t * 0.8 + wobble * 0.4;
        return Math.round(Math.max(1, v) * 10) / 10;
      default: {
        const scale = metric.goodBand;
        v = scale * (0.45 + base * 0.7) * (1 + drift * t * 0.5) + wobble * scale * 0.12;
        return Math.max(0, Math.round(v));
      }
    }
  });
}

export interface MetricSnapshot {
  def: MetricDef;
  history: number[];
  current: number;
  previous: number;
  baseline: number | null;   // avg of the 3 months before current
  changePct: number | null;
  trend: TrendDir;
  status: MetricStatus;
  normalized: number;        // 0-100 contribution basis
}

export interface OutreachTarget {
  assigned: number;
  completed: number;
  target: number;
  achievedPct: number;
  targetAchieved: boolean;
  statusLabel: string;
  history: { month: string; assigned: number; completed: number }[];
}

export interface SourcingRatio {
  assigned: number;
  selfSourced: number;
  ratioLabel: string;
  selfPct: number;
  history: { month: string; assigned: number; self: number; ratio: number }[];
  trend: TrendDir;
}

export interface Evaluation {
  subjectId: string;
  subjectName: string;
  isNew: boolean;
  metrics: MetricSnapshot[];
  score: number;
  previousScore: number;
  scoreHistory: { month: string; score: number }[];
  band: (typeof SCORE_BANDS)[number];
  outreach: OutreachTarget;
  sourcing: SourcingRatio;
  strengths: MetricSnapshot[];
  attention: MetricSnapshot[];
  summary: string;
}

function trendFrom(history: number[], idx: number, direction: Direction, isNew: boolean): { baseline: number | null; changePct: number | null; trend: TrendDir } {
  if (isNew || idx < 3) return { baseline: null, changePct: null, trend: "new" };
  const prior = history.slice(idx - 3, idx);
  const baseline = prior.reduce((a, b) => a + b, 0) / 3;
  if (baseline === 0) return { baseline, changePct: null, trend: "flat" };
  const changePct = ((history[idx] - baseline) / baseline) * 100;
  const improving = direction === "higher" ? changePct : -changePct;
  const trend: TrendDir = improving > 15 ? "up" : improving < -15 ? "down" : "flat";
  return { baseline, changePct, trend };
}

function normalize(def: MetricDef, value: number): number {
  if (def.direction === "lower") {
    const worst = def.unit === "days" ? 6 : def.unit === "pct" ? 30 : def.goodBand * 3 || 1;
    const good = def.goodBand;
    if (value <= good) return 100;
    return Math.max(0, Math.round(100 - ((value - good) / Math.max(worst - good, 0.001)) * 100));
  }
  return Math.max(0, Math.min(100, Math.round((value / def.goodBand) * 100)));
}

function statusFor(def: MetricDef, value: number, normalized: number): MetricStatus {
  if (!def.scored) return "signal";
  if (def.target !== null) {
    const meets = def.direction === "higher" ? value >= def.target : value <= def.target;
    if (meets) return "on_track";
    const near = def.direction === "higher" ? value >= def.target * 0.85 : value <= def.target + (def.unit === "pct" ? 5 : 1);
    return near ? "watch" : "off_track";
  }
  return normalized >= 75 ? "on_track" : normalized >= 50 ? "watch" : "off_track";
}

function scoreAt(subject: string, idx: number, isNew: boolean): number {
  let total = 0, weight = 0;
  for (const def of RUBRIC) {
    if (!def.scored) continue;
    const h = series(subject, def);
    total += normalize(def, h[idx]) * def.weight;
    weight += def.weight;
  }
  void isNew;
  return Math.round(total / Math.max(weight, 1));
}

export function getEvaluation(subjectId: string, subjectName: string, isNew = false): Evaluation {
  const last = MONTHS.length - 1;

  const metrics: MetricSnapshot[] = RUBRIC.map((def) => {
    const history = series(subjectId, def);
    const current = history[last];
    const { baseline, changePct, trend } = trendFrom(history, last, def.direction, isNew);
    const normalized = normalize(def, current);
    return {
      def, history, current, previous: history[last - 1], baseline, changePct, trend,
      normalized, status: statusFor(def, current, normalized),
    };
  });

  const score = scoreAt(subjectId, last, isNew);
  const previousScore = scoreAt(subjectId, last - 1, isNew);
  const scoreHistory = MONTHS.map((month, i) => ({ month, score: scoreAt(subjectId, i, isNew) }));

  // Outreach vs assigned workload
  const outreachHistory = MONTHS.map((month, i) => {
    const assigned = 28 + Math.round(hash(subjectId + "assigned" + month) * 26);
    const completedRaw = assigned * (0.62 + hash(subjectId + "done" + month) * 0.5);
    void i;
    return { month, assigned, completed: Math.round(completedRaw) };
  });
  const lastOutreach = outreachHistory[last];
  const achievedPct = Math.round((lastOutreach.completed / lastOutreach.assigned) * 100);
  const outreach: OutreachTarget = {
    assigned: lastOutreach.assigned,
    completed: lastOutreach.completed,
    target: lastOutreach.assigned,
    achievedPct,
    targetAchieved: achievedPct >= 100,
    statusLabel: achievedPct >= 100 ? "Target met" : achievedPct >= 90 ? "On Track" : achievedPct >= 75 ? "Slightly behind" : "Behind",
    history: outreachHistory,
  };

  // Proactive sourcing ratio
  const sourcingHistory = MONTHS.map((month, i) => {
    const assigned = outreachHistory[i].assigned * 2;
    const self = Math.round(assigned * (0.08 + hash(subjectId + "self" + month) * 0.3));
    const total = assigned + self;
    return { month, assigned, self, ratio: Math.round((self / total) * 100) };
  });
  const ls = sourcingHistory[last];
  const selfPct = ls.ratio;
  const sourcingTrend = trendFrom(sourcingHistory.map((h) => h.ratio), last, "higher", isNew).trend;
  const sourcing: SourcingRatio = {
    assigned: ls.assigned,
    selfSourced: ls.self,
    selfPct,
    ratioLabel: `${100 - selfPct} : ${selfPct}`,
    history: sourcingHistory,
    trend: sourcingTrend,
  };

  const scored = metrics.filter((m) => m.def.scored);
  const strengths = [...scored].sort((a, b) => b.normalized - a.normalized).slice(0, 3);
  const attention = [...scored].filter((m) => m.status !== "on_track").sort((a, b) => a.normalized - b.normalized).slice(0, 3);

  const band = bandFor(score);
  const delta = score - previousScore;
  const summary =
    `${subjectName} is scoring ${score}/100 this month (${band.label} band), ` +
    `${delta === 0 ? "flat" : delta > 0 ? `up ${delta} points` : `down ${Math.abs(delta)} points`} versus last month. ` +
    `Outreach hit ${outreach.completed} of ${outreach.assigned} assigned resources (${outreach.achievedPct}% — ${outreach.statusLabel}), ` +
    `with a ${sourcing.ratioLabel} assigned-to-self-sourced split. ` +
    (strengths.length ? `Strongest areas: ${strengths.map((s) => s.def.label).join(", ")}. ` : "") +
    (attention.length ? `Focus next month on ${attention.map((s) => s.def.label).join(", ")}.` : "No metric is currently below target.");

  return {
    subjectId, subjectName, isNew, metrics, score, previousScore, scoreHistory,
    band, outreach, sourcing, strengths, attention, summary,
  };
}

export function formatValue(unit: Unit, v: number): string {
  switch (unit) {
    case "pct": return `${Math.round(v)}%`;
    case "days": return `${v.toFixed(1)}d`;
    case "attempts": return `${v.toFixed(1)}x`;
    default: return String(Math.round(v));
  }
}