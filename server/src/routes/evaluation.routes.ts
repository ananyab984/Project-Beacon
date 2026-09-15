import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import type { KpiConfig } from "@prisma/client";
import { computeRecruiterScoreSnapshot } from "../jobs/scoring.job";

// Mounted at bare /api in index.ts (`app.use("/api", evaluationRouter)`),
// so every path below spells out its own full segment.
export const evaluationRouter = Router();

evaluationRouter.use(authenticateJwt);

const METRIC_GROUPS = [
  "ACTIVITY_AND_EFFORT",
  "RESPONSIVENESS",
  "OWNERSHIP_AND_FOLLOW_THROUGH",
  "OUTCOME_METRICS",
  "ADDITIONAL_BUSINESS_METRICS",
] as const;

const METRIC_UNITS = ["COUNT", "PCT", "DAYS", "ATTEMPTS"] as const;

const METRIC_DIRECTIONS = ["HIGHER_IS_BETTER", "LOWER_IS_BETTER"] as const;

/** Recruiters and owners get full cross-user oversight on these routes --
 * that's the whole point of the roster page (an owner clicking any
 * recruiter, a recruiter's "Contractors" page clicking any contractor).
 * A contractor gets none of that: they may only ever view or recompute
 * their OWN score. Takes plain values rather than the full Express
 * Request so it's directly unit testable without constructing a fake
 * request object -- same pattern as lead.routes.ts's
 * assertContractorOwnsLead. */
export function assertContractorViewsOwnScore(requesterRole: string, requesterId: string, subjectId: string) {
  if (requesterRole.toLowerCase() === "contractor" && requesterId !== subjectId) {
    throw new ApiError(403, "FORBIDDEN_NOT_OWN_SCORE", "Contractors may only view or recompute their own performance");
  }
}

/** KpiConfig is versioned (@@unique([metricKey, effectiveDate])) — "current"
 *  means, per metricKey, the row with the latest effectiveDate. Fetch all
 *  ordered by effectiveDate desc and take the first row seen per metricKey. */
function latestPerMetricKey(rows: KpiConfig[]): KpiConfig[] {
  const seen = new Set<string>();
  const result: KpiConfig[] = [];
  for (const row of rows) {
    if (!seen.has(row.metricKey)) {
      seen.add(row.metricKey);
      result.push(row);
    }
  }
  return result;
}

// GET /api/kpi-config — current (latest effectiveDate) row per metricKey
evaluationRouter.get(
  "/kpi-config",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.kpiConfig.findMany({ orderBy: { effectiveDate: "desc" } });
    const current = latestPerMetricKey(rows);
    return res.json({ kpiConfig: current });
  })
);

// PATCH /api/kpi-config/:metricKey — versioned edit: never mutate an existing
// row, create a new one dated `now` merged on top of the current row.
evaluationRouter.patch(
  "/kpi-config/:metricKey",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      weight: z.number().optional(),
      target: z.number().optional(),
      goodBand: z.number().optional(),
      direction: z.enum(METRIC_DIRECTIONS).optional(),
      group: z.enum(METRIC_GROUPS).optional(),
      label: z.string().optional(),
      unit: z.enum(METRIC_UNITS).optional(),
      scored: z.boolean().optional(),
      notes: z.string().optional(),
    });
    const patch = schema.parse(req.body);
    const metricKey = req.params.metricKey;

    const rows = await prisma.kpiConfig.findMany({
      where: { metricKey },
      orderBy: { effectiveDate: "desc" },
    });
    const base = rows[0];
    if (!base) throw new ApiError(404, "METRIC_NOT_FOUND", `No existing KpiConfig found for metricKey '${metricKey}'`);

    const created = await prisma.kpiConfig.create({
      data: {
        metricKey,
        group: patch.group ?? base.group,
        label: patch.label ?? base.label,
        unit: patch.unit ?? base.unit,
        weight: patch.weight ?? base.weight ?? undefined,
        target: patch.target ?? base.target ?? undefined,
        goodBand: patch.goodBand ?? base.goodBand ?? undefined,
        direction: patch.direction ?? base.direction,
        scored: patch.scored ?? base.scored,
        notes: patch.notes ?? base.notes ?? undefined,
        effectiveDate: new Date(),
      },
    });

    return res.status(201).json({ kpiConfig: created });
  })
);

// GET /api/recruiters/:id/score — the recruiter's current-month
// RecruiterScoreSnapshot + its RecruiterMetricSnapshot rows.
//
// Always recomputes the current month's snapshot before reading it, rather
// than only computing when none exists yet. That "only if missing" guard
// used to be the whole bug: once a snapshot existed for this month, it never
// updated again on its own -- the roster page's own 10s poll of this exact
// route just kept re-fetching the same stale row until someone opened the
// recruiter's detail page and clicked Recalculate Score by hand. Recomputing
// here is cheap (a handful of count/aggregate queries scoped to one
// recruiter's current month, idempotent via the same period-keyed upsert
// recompute-score already used below) so every poll now reflects live data.
evaluationRouter.get(
  "/recruiters/:id/score",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    assertContractorViewsOwnScore(req.user!.role, req.user!.id, req.params.id);
    try {
      await computeRecruiterScoreSnapshot(req.params.id, new Date());
    } catch (err) {
      console.warn("[evaluation] on-demand score computation failed:", err);
    }

    const latest = await prisma.recruiterScoreSnapshot.findFirst({
      where: { recruiterId: req.params.id },
      orderBy: { period: "desc" },
      include: { metricSnapshots: true },
    });

    if (!latest) {
      return res.json({ snapshot: null, metricSnapshots: [] });
    }

    const { metricSnapshots, ...snapshot } = latest;
    return res.json({ snapshot, metricSnapshots });
  })
);

// POST /api/recruiters/:id/recompute-score — triggers an immediate real-time
// recalculation of the recruiter's score snapshot and KPI summary.
evaluationRouter.post(
  "/recruiters/:id/recompute-score",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    assertContractorViewsOwnScore(req.user!.role, req.user!.id, req.params.id);
    const snapshot = await computeRecruiterScoreSnapshot(req.params.id, new Date());
    const full = await prisma.recruiterScoreSnapshot.findUnique({
      where: { id: snapshot.id },
      include: { metricSnapshots: true },
    });
    return res.json({ success: true, snapshot: full });
  })
);

// GET /api/recruiters/:id/kpi-summary — cached roster-view scorecard.
// No summary yet is a normal state, so return 200 with null rather than 404.
evaluationRouter.get(
  "/recruiters/:id/kpi-summary",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    assertContractorViewsOwnScore(req.user!.role, req.user!.id, req.params.id);
    const summary = await prisma.recruiterKpiSummary.findUnique({
      where: { recruiterId: req.params.id },
    });

    return res.json({ summary: summary ?? null });
  })
);
