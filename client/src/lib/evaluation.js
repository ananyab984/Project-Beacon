// Recruiter Performance Evaluation — Project Beacon rubric.
// Updated metric structure: Activity & Effort, Ownership & Follow-through, Outcome Metrics.

export const METRIC_GROUPS = [
  "Activity & Effort",
  "Ownership & Follow-through",
  "Outcome Metrics",
];

export function formatValue(unit, val) {
  if (val === null || val === undefined) return "—";
  if (unit === "pct") return `${val}%`;
  if (unit === "days") return `${val}d`;
  if (unit === "attempts") return `${val}x`;
  return `${val}`;
}

export const RUBRIC = [
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
  { min: 85, label: "Strong", meaning: "Minimal oversight needed", tone: "positive" },
  { min: 70, label: "Solid", meaning: "Meeting expectations", tone: "neutral" },
  { min: 55, label: "Coaching", meaning: "Needs a coaching conversation, with a named area", tone: "warning" },
  { min: 0, label: "Review", meaning: "Requires review this week, not next cycle", tone: "critical" },
];

export function bandFor(score) {
  return SCORE_BANDS.find((b) => score >= b.min);
}

/* ------------------------------------------------------------------ */
/* Deterministic mock history                                          */
/* ------------------------------------------------------------------ */

export const MONTHS = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function series(subject, metric) {
  const base = hash(subject + metric.id);
  const drift = hash(subject + metric.id + "d") - 0.45;
  return MONTHS.map((m, i) => {
    const wobble = hash(subject + metric.id + m) - 0.5;
    const t = i / (MONTHS.length - 1);
    let v;
    switch (metric.unit) {
      case "pct": {
        const floor = metric.direction === "lower" ? 0 : 45;
        const span = metric.direction === "lower" ? 22 : 55;
        v = floor + base * span + drift * t * 18 + wobble * 8;
        v = Math.min(100, Math.max(0, v));
        break;
      }
      case "days": {
        v = 0.5 + (1 - base) * 3.5 + drift * t + wobble * 0.4;
        v = Math.max(0.1, v);
        break;
      }
      case "attempts": {
        v = 1.0 + base * 2.5 + wobble * 0.3;
        v = Math.max(1, v);
        break;
      }
      case "count":
      default: {
        const center = metric.goodBand * 0.85;
        v = center + (base - 0.5) * (metric.goodBand * 0.4) + drift * t * 20 + wobble * 12;
        v = Math.max(0, v);
        break;
      }
    }
    return Number(v.toFixed(metric.unit === "days" || metric.unit === "attempts" ? 1 : 0));
  });
}

export function getEvaluation(subjectId, subjectName) {
  const snapshots = RUBRIC.map((def) => {
    const hist = series(subjectId, def);
    const current = hist[hist.length - 1];
    const previous = hist[hist.length - 2];

    let status = "on_track";
    if (def.target === null) {
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
    if (def.scored && def.weight > 0) {
      let ratio = 0;
      if (def.direction === "lower") {
        ratio = Math.max(0, 1 - Math.max(0, current - def.goodBand) / Math.max(1, def.goodBand * 2));
      } else {
        ratio = Math.min(1, current / def.goodBand);
      }
      scoreContribution = Math.round(ratio * def.weight);
    }

    return { def, current, previous, history: hist, status, scoreContribution };
  });

  const totalScore = Math.min(
    100,
    Math.max(
      40,
      snapshots.reduce((acc, s) => acc + s.scoreContribution, 0),
    ),
  );

  const outreachSeed = Math.round(30 + hash(subjectId + "out") * 20);
  const outreachCompleted = Math.round(outreachSeed * (0.95 + hash(subjectId + "outc") * 0.25));

  const assignedLeads = Math.round(50 + hash(subjectId + "srca") * 40);
  const selfSourcedLeads = Math.round(10 + hash(subjectId + "srcs") * 20);
  const totalLeads = assignedLeads + selfSourcedLeads;
  const selfPct = Math.round((selfSourcedLeads / totalLeads) * 100);

  return {
    subjectId,
    subjectName,
    score: totalScore,
    band: bandFor(totalScore),
    metrics: snapshots,
    outreach: {
      completed: outreachCompleted,
      assigned: outreachSeed,
      targetAchieved: outreachCompleted >= outreachSeed,
      achievedPct: Math.round((outreachCompleted / outreachSeed) * 100),
    },
    sourcing: {
      assigned: assignedLeads,
      selfSourced: selfSourcedLeads,
      ratioLabel: `${100 - selfPct} : ${selfPct}`,
      selfPct,
    },
  };
}
