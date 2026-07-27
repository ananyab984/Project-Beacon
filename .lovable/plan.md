## Goal

Turn "Lead Performance" into a full rubric-driven evaluation dashboard, built on the Project Beacon rubric (11 scored metrics + 2 watched outcome metrics), extended with the new outreach-vs-assigned, proactive-sourcing-ratio, and "nice to have" manual metrics. Recruiters see only themselves; owners see everyone.

## 1. Evaluation data model (new `src/lib/evaluation.ts`)

One rubric definition + 6 months of mock history per recruiter (and contractor), so every metric has a real trend.

Metric groups and metrics:

- **Activity & Effort** — Outreach volume, Follow-up persistence (avg attempts before Replied/Cold), Proactive sourcing
- **Responsiveness** — Time-to-first-touch (target ≤2 business days), SLA adherence on urgent leads (target ≥90%), Backlog aging (target 0%)
- **Ownership & Follow-through** — Progression rate, Closure rate, Reason-logged rate
- **Outcome (watched, not weighted)** — Interview conversion, Onboarded ÷ assigned
- **Additional Business Metrics** — Cold lead conversion count, Manual interviews conducted, Manual conversion count

Each metric carries: id, group, label, definition (verbatim from rubric), unit, target, direction (higher/lower better), weight, scored vs watched, and 6 months of values.

Derived logic, per the rubric:
- Trend: baseline = mean of last 3 months; change = (this month − baseline)/baseline; >+15% Up, <−15% Down, else Flat. Trend suppressed for recruiters with <3 months of history ("new recruiter").
- Status indicator per metric: On track / Watch / Off track, from target + direction.
- Overall score: weighted average of the 9 scored metrics normalized to 0–100 (outcome metrics excluded). Rubric leaves weights undefined, so I'll ship a documented default (Activity 30 / Responsiveness 40 / Ownership 30, split evenly within each group) in one constant that's trivial to retune.
- Performance band: 85–100 Strong, 70–84 Solid, 55–69 Coaching needed, <55 Review this week.

Extended metrics:
- Outreach volume block computes assigned resources, outreach completed, target, % achieved, Yes/No target achieved, and month-over-month trend.
- Proactive sourcing computes assigned : self-sourced ratio (e.g. 80 : 20) plus trend.

## 2. Shared dashboard component (`src/components/g3/evaluation-dashboard.tsx`)

Takes a recruiter id and renders the whole evaluation:

1. **Header** — name, band chip, overall score ring, vs-previous-month delta, date-range toggle.
2. **Highlight row** — Outreach vs Assigned Target card (progress bar, 38/40, 95%, On Track), Proactive Sourcing ratio card (stacked ratio bar 80:20), Goal progress card.
3. **Monthly trend chart** — overall score line over 6 months (recharts).
4. **Target vs Actual chart** — grouped bars across scored metrics.
5. **Grouped metric sections** — one section per group; each metric row shows definition, current value, target, progress bar, trend arrow, status pill, and a sparkline of its 6-month history. Outcome group is visually marked "watched, not scored".
6. **Best performing / Needs attention** — two columns auto-derived from status + trend.
7. **AI Performance Summary** — placeholder card with a generated-from-template narrative, gated by the existing AI feature flag.
8. **Monthly history table** — month × key metrics with per-cell trend.

## 3. Routes

- `/recruiter/performance` — renders the dashboard for the signed-in recruiter only (`CURRENT_RECRUITER_ID`), no recruiter picker. Keeps the existing weekly outreach chart below.
- `/contractor/performance` — same, scoped to the contractor.
- `/owner/recruiters` — recruiter detail sheet gains an "Evaluation" view linking to a new `/owner/recruiters/$id` style page (implemented as `owner.recruiter-evaluation.tsx` with a recruiter selector) rendering the same dashboard for any recruiter, plus a team comparison strip.

Access is enforced in the UI layer only (existing role guards); no backend changes.

## 4. Notes

- All numbers stay mock/deterministic — seeded per recruiter id so values are stable across reloads.
- Uses existing semantic tokens and `KpiTile`/`ScoreRing` primitives; no new colors.
- Weights are a single exported constant, flagged in a comment as pending business sign-off per section 4 of the rubric.
