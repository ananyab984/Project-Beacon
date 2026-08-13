import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import type { KpiConfig } from "@prisma/client";

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
  requireRole("owner", "recruiter"),
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

// GET /api/recruiters/:id/score — latest RecruiterScoreSnapshot + its
// RecruiterMetricSnapshot rows. No snapshot yet is a normal state (freshly
// onboarded recruiter), so return 200 with nulls rather than 404.
evaluationRouter.get(
  "/recruiters/:id/score",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
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

// GET /api/recruiters/:id/kpi-summary — cached roster-view scorecard.
// No summary yet is a normal state, so return 200 with null rather than 404.
evaluationRouter.get(
  "/recruiters/:id/kpi-summary",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await prisma.recruiterKpiSummary.findUnique({
      where: { recruiterId: req.params.id },
    });

    return res.json({ summary: summary ?? null });
  })
);
