/**
 * GET /api/enrichment-evaluation — owner-only live analytics over the
 * automatic enrichment waterfall's EnrichmentRun history (see
 * server/prisma/schema.prisma and server/src/jobs/enrichment.job.ts's
 * write site). Backs the Settings page's Enrichment Evaluation box.
 *
 * Every number here is computed fresh from EnrichmentRun rows at request
 * time -- there is no separate aggregate/cache table to invalidate, matching
 * this repo's existing direct-query convention (see reports.routes.ts). The
 * actual metric math lives in enrichmentEvaluationMetrics.ts (pure,
 * independently unit-tested); this route is just the two Prisma queries
 * that feed it.
 */
import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { computeEnrichmentEvaluationMetrics, type LatestRunPerLead } from "../lib/enrichmentEvaluationMetrics";
import type { LeadSource } from "@prisma/client";

export const enrichmentEvaluationRouter = Router();
enrichmentEvaluationRouter.use(authenticateJwt);

const RANGE_KEYS = ["7d", "30d", "90d", "all"] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

// Kept in sync with prisma/schema.prisma's LeadSource enum -- no shared
// export of this list already exists to reuse (checked lead.routes.ts).
const LEAD_SOURCES: LeadSource[] = ["LINKEDIN", "PROZ", "ADA", "ATA", "ATAA", "BODALGO", "FREELANCER", "APOLLO"];

function sinceFor(range: RangeKey): Date | undefined {
  const now = Date.now();
  switch (range) {
    case "7d":
      return new Date(now - 7 * 86400_000);
    case "30d":
      return new Date(now - 30 * 86400_000);
    case "90d":
      return new Date(now - 90 * 86400_000);
    case "all":
      return undefined;
  }
}

enrichmentEvaluationRouter.get(
  "/",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const rangeParam = String(req.query.range ?? "30d");
    if (!(RANGE_KEYS as readonly string[]).includes(rangeParam)) {
      throw new ApiError(400, "INVALID_RANGE", `range must be one of ${RANGE_KEYS.join(", ")}`);
    }
    const range = rangeParam as RangeKey;

    const platformParam = req.query.platform as string | undefined;
    let platform: LeadSource | undefined;
    if (platformParam && platformParam !== "all") {
      if (!LEAD_SOURCES.includes(platformParam as LeadSource)) {
        throw new ApiError(400, "INVALID_PLATFORM", `platform must be "all" or one of ${LEAD_SOURCES.join(", ")}`);
      }
      platform = platformParam as LeadSource;
    }

    const since = sinceFor(range);
    const runWhere = {
      ...(since ? { concludedAt: { gte: since } } : {}),
      ...(platform ? { platform } : {}),
    };

    const runs = await prisma.enrichmentRun.findMany({
      where: runWhere,
      select: { conclusion: true, tier: true, enrichedFieldCount: true, executionTimeMs: true },
    });

    // Metric 5's inputs: each lead's most recent run in the filtered set,
    // joined to whether that lead is currently COMPLETE and its override
    // timestamp -- see enrichmentEvaluationMetrics.ts for the exact
    // denominator/numerator this feeds.
    const latestRunGroups = await prisma.enrichmentRun.groupBy({
      by: ["leadId"],
      where: runWhere,
      _max: { concludedAt: true },
    });
    const leadIds = latestRunGroups.map((r) => r.leadId);
    const leads = leadIds.length
      ? await prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, enrichmentStatus: true, lastManualOverrideAt: true },
        })
      : [];
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const latestRunPerLead: LatestRunPerLead[] = latestRunGroups
      .filter((row) => row._max.concludedAt !== null)
      .map((row) => {
        const lead = leadById.get(row.leadId);
        return {
          leadId: row.leadId,
          latestConcludedAt: row._max.concludedAt as Date,
          isComplete: lead?.enrichmentStatus === "COMPLETE",
          lastManualOverrideAt: lead?.lastManualOverrideAt ?? null,
        };
      });

    return res.json(computeEnrichmentEvaluationMetrics(runs, latestRunPerLead));
  })
);
