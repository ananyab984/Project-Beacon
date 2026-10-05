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
import { hasEnrichedContact } from "../lib/enrichmentCount";
import type { LeadSource } from "@prisma/client";

export const enrichmentEvaluationRouter = Router();
enrichmentEvaluationRouter.use(authenticateJwt);

const RANGE_KEYS = ["7d", "30d", "90d", "all"] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

// Re-exported from the one place that defines this list (which also owns the
// URL-based detection that assigns it). This used to be a hand-maintained
// copy "kept in sync with prisma/schema.prisma" -- it was already stale,
// missing OTHER, which would have made the dashboard reject `platform=OTHER`
// as invalid while leads were being filed under it.
import { LEAD_SOURCES as LEAD_SOURCE_VALUES } from "../lib/detectLeadSource";

const LEAD_SOURCES: readonly LeadSource[] = LEAD_SOURCE_VALUES;

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
      select: { leadId: true, conclusion: true, tier: true, enrichedFieldCount: true, executionTimeMs: true },
    });

    // Metric 5's inputs: each lead's most recent run in the filtered set,
    // joined to its override timestamp -- see enrichmentEvaluationMetrics.ts
    // for the exact denominator/numerator this feeds.
    const latestRunGroups = await prisma.enrichmentRun.groupBy({
      by: ["leadId"],
      where: runWhere,
      _max: { concludedAt: true },
    });
    const leadIds = latestRunGroups.map((r) => r.leadId);
    const leads = leadIds.length
      ? await prisma.lead.findMany({
          where: { id: { in: leadIds } },
          // email/contactNumber/fieldSources feed the "found an email or
          // phone" half of the Enriched rule (see runOutcome).
          select: { id: true, lastManualOverrideAt: true, email: true, contactNumber: true, fieldSources: true },
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
          lastManualOverrideAt: lead?.lastManualOverrideAt ?? null,
        };
      });

    // Coverage: how much of the CURRENT lead pool this period's runs speak
    // for. Leads enriched before run history was recorded (or by a path that
    // doesn't record one) have no run at all -- surfaced, not hidden.
    const [leadsInPool, lastRun] = await Promise.all([
      prisma.lead.count({ where: { deletedAt: null, ...(platform ? { source: platform } : {}) } }),
      prisma.enrichmentRun.findFirst({ where: platform ? { platform } : {}, orderBy: { concludedAt: "desc" }, select: { concludedAt: true } }),
    ]);

    return res.json({
      // ponytail: contactFound reads the lead's CURRENT email/phone
      // provenance, not a snapshot taken when each run ended -- exact for a
      // lead's latest run, approximate for older runs of a re-enriched lead.
      // Upgrade path: record it on EnrichmentRun at the write site in
      // jobs/enrichment.job.ts if per-run history ever needs to be exact.
      ...computeEnrichmentEvaluationMetrics(
        runs.map((r) => {
          const lead = leadById.get(r.leadId);
          return { ...r, contactFound: lead ? hasEnrichedContact(lead) : false };
        }),
        latestRunPerLead
      ),
      coverage: { leadsInPool, leadsWithRunInPeriod: latestRunPerLead.length },
      lastRunAt: lastRun?.concludedAt ?? null,
      computedAt: new Date(),
    });
  })
);
