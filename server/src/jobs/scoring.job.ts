import { prisma } from "../prisma";

/**
 * Recruiter Rubric Definition per 'final rubrics.pdf' and 'final rubrics calculation.pdf'.
 * - 5 Scored Metrics (Category A) = 100% of Overall Score
 * - 4 Signal Metrics (Category B) = 0% weight, dashboard visibility only
 */
export const RUBRIC = [
  // --- Category A: 5 Scored Metrics (100% of Overall Score) ---
  {
    metricKey: "outreach_volume",
    group: "ACTIVITY_AND_EFFORT" as const,
    label: "Outreach Volume",
    unit: "COUNT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 420,
    goodBand: 420,
    weight: 30,
    scored: true,
    needsUnipile: true,
  },
  {
    metricKey: "proactive_sourcing",
    group: "ACTIVITY_AND_EFFORT" as const,
    label: "Proactive Sourcing",
    unit: "COUNT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 34,
    goodBand: 34,
    weight: 30,
    scored: true,
    needsUnipile: false,
  },
  {
    metricKey: "time_to_first_touch",
    group: "ACTIVITY_AND_EFFORT" as const,
    label: "Time to First Touch",
    unit: "DAYS" as const,
    direction: "LOWER_IS_BETTER" as const,
    target: 1.0,
    goodBand: 1.0,
    weight: 20,
    scored: true,
    needsUnipile: true,
  },
  {
    metricKey: "progression_rate",
    group: "OWNERSHIP_AND_FOLLOW_THROUGH" as const,
    label: "Progression Rate",
    unit: "PCT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 80,
    goodBand: 80,
    weight: 10,
    scored: true,
    needsUnipile: false,
  },
  {
    metricKey: "reason_logged_rate",
    group: "OWNERSHIP_AND_FOLLOW_THROUGH" as const,
    label: "Reason Logged Rate",
    unit: "PCT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 100,
    goodBand: 100,
    weight: 10,
    scored: true,
    needsUnipile: false,
  },
  // --- Category B: Outcome / Signal Metrics (0% weight, dashboard only) ---
  {
    metricKey: "onboard_vs_queue",
    group: "OUTCOME_METRICS" as const,
    label: "Onboarding vs. Queue Size",
    unit: "PCT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: null,
    goodBand: 100,
    weight: 0,
    scored: false,
    needsUnipile: false,
  },
  {
    metricKey: "cold_lead_conversion",
    group: "OUTCOME_METRICS" as const,
    label: "Cold Lead Reactivation",
    unit: "COUNT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 18,
    goodBand: 18,
    weight: 0,
    scored: false,
    needsUnipile: false,
  },
  {
    metricKey: "manual_interviews",
    group: "OUTCOME_METRICS" as const,
    label: "Manual Interviews",
    unit: "COUNT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 15,
    goodBand: 15,
    weight: 0,
    scored: false,
    needsUnipile: false,
  },
  {
    metricKey: "manual_conversion",
    group: "OUTCOME_METRICS" as const,
    label: "Manual Conversion",
    unit: "COUNT" as const,
    direction: "HIGHER_IS_BETTER" as const,
    target: 10,
    goodBand: 10,
    weight: 0,
    scored: false,
    needsUnipile: false,
  },
];

/**
 * Calculates normalized metric score (0 to 100) exactly per 'final rubrics.pdf':
 * - Higher-is-better: min(100, (Actual / Target) * 100)
 * - Lower-is-better: if Actual <= Target -> 100, else min(100, (Target / Actual) * 100)
 */
export function calculateNormalizedMetricScore(
  actual: number,
  target: number,
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" = "HIGHER_IS_BETTER"
): number {
  if (actual <= 0) return 0;
  if (!target || target <= 0) return 0;

  if (direction === "LOWER_IS_BETTER") {
    if (actual <= target) return 100;
    return Math.min(100, Math.max(0, Math.round((target / actual) * 100)));
  }

  return Math.min(100, Math.max(0, Math.round((actual / target) * 100)));
}

/**
 * Calculates weighted score contribution for a metric towards Overall Score.
 */
export function calculateWeightedContribution(
  actual: number,
  target: number,
  weight: number,
  scored: boolean,
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" = "HIGHER_IS_BETTER"
): number {
  if (!scored || weight <= 0) return 0;
  const normalized = calculateNormalizedMetricScore(actual, target, direction);
  return (normalized * weight) / 100;
}

/**
 * Maps 0-100 overall score to band label per 'final rubrics.pdf':
 * - Strong: >= 85
 * - Solid: 70 - 84
 * - Coaching: 50 - 69
 * - Review: < 50
 */
export function getBandLabel(score: number): string {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Solid";
  if (score >= 50) return "Coaching";
  return "Review";
}

/**
 * Computes business days (excluding weekends) between two dates.
 */
function calculateBusinessDays(startDate: Date, endDate: Date): number {
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs <= 0) return 0;

  let count = 0;
  const cur = new Date(startDate);

  while (cur < endDate) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) { // Skip Sunday (0) and Saturday (6)
      const nextDay = new Date(cur);
      nextDay.setDate(cur.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      const segmentEnd = nextDay < endDate ? nextDay : endDate;
      const hours = (segmentEnd.getTime() - cur.getTime()) / 3_600_000;
      count += hours / 24;
    }
    cur.setDate(cur.getDate() + 1);
    cur.setHours(0, 0, 0, 0);
  }

  return Math.round(count * 10) / 10;
}

/** Bootstraps current KpiConfig rows on first run so scoring works without manual seed. */
async function ensureKpiConfigSeeded() {
  const existing = await prisma.kpiConfig.findMany({ orderBy: { effectiveDate: "desc" } });
  const latestByKey = new Map<string, Date>();
  for (const row of existing) {
    if (!latestByKey.has(row.metricKey)) latestByKey.set(row.metricKey, row.effectiveDate);
  }
  const missing = RUBRIC.filter((r) => !latestByKey.has(r.metricKey));
  if (missing.length === 0) return;

  const now = new Date();
  await prisma.$transaction(
    missing.map((r) =>
      prisma.kpiConfig.create({
        data: {
          metricKey: r.metricKey,
          group: r.group,
          label: r.label,
          unit: r.unit,
          weight: r.weight,
          target: r.target ?? undefined,
          goodBand: r.goodBand,
          direction: r.direction,
          scored: r.scored,
          effectiveDate: now,
        },
      })
    )
  );
}

/** Computes one recruiter's monthly score snapshot from real activity data. */
export async function computeRecruiterScoreSnapshot(recruiterId: string, period: Date) {
  await ensureKpiConfigSeeded();

  const periodStart = new Date(period.getFullYear(), period.getMonth(), 1);
  const periodEnd = new Date(period.getFullYear(), period.getMonth() + 1, 1);

  // 1. Category A, Metric 1: Outreach Volume (Unipile Webhook Feed)
  // Counts all outbound email & LinkedIn messages sent by recruiter this period.
  const outreachVolume = await prisma.interactionEvent.count({
    where: {
      recruiterId,
      direction: "OUTBOUND",
      occurredAt: { gte: periodStart, lt: periodEnd },
    },
  });

  // 2. Category A, Metric 2: Proactive Sourcing
  // Candidates self-sourced by recruiter (excl. contractor submissions / bulk imports).
  const proactiveSourcing = await prisma.lead.count({
    where: {
      createdByRecruiterId: recruiterId,
      isSelfSourced: true,
      createdAt: { gte: periodStart, lt: periodEnd },
    },
  });

  // 3. Category A, Metric 3: Time-to-First-Touch (Unipile Webhook Feed)
  // Average business days between lead assignment/claim and recruiter's first outbound message.
  const outboundEvents = await prisma.interactionEvent.findMany({
    where: {
      recruiterId,
      direction: "OUTBOUND",
      occurredAt: { gte: periodStart, lt: periodEnd },
    },
    select: { leadId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });

  const firstTouchByLead = new Map<string, Date>();
  for (const e of outboundEvents) {
    if (!firstTouchByLead.has(e.leadId)) {
      firstTouchByLead.set(e.leadId, e.occurredAt);
    }
  }

  const assignedLeads = await prisma.lead.findMany({
    where: {
      OR: [
        { assignedRecruiterId: recruiterId },
        { claimedByRecruiterId: recruiterId },
        { id: { in: Array.from(firstTouchByLead.keys()) } },
      ],
    },
    select: { id: true, assignedAt: true, claimedAt: true, createdAt: true, stage: true, targetLanguage: true, services: true },
  });

  const touchDelaysDays: number[] = [];
  for (const lead of assignedLeads) {
    const touchedAt = firstTouchByLead.get(lead.id);
    if (touchedAt) {
      const assignedAt = lead.assignedAt || lead.claimedAt || lead.createdAt;
      if (assignedAt && touchedAt >= assignedAt) {
        touchDelaysDays.push(calculateBusinessDays(assignedAt, touchedAt));
      }
    }
  }

  const timeToFirstTouch = touchDelaysDays.length
    ? touchDelaysDays.reduce((a, b) => a + b, 0) / touchDelaysDays.length
    : 0;

  // 4. Category A, Metric 4: Progression Rate
  // % of assigned leads that advance past NEW / CONTACTED stage into active progression.
  const advancedLeads = await prisma.stageHistory.findMany({
    where: {
      changedByRecruiterId: recruiterId,
      changedAt: { gte: periodStart, lt: periodEnd },
      toStage: { notIn: ["NEW", "CONTACTED", "COLD"] },
    },
    select: { leadId: true },
    distinct: ["leadId"],
  });

  const progressionRate = assignedLeads.length
    ? Math.min(100, Math.round((advancedLeads.length / assignedLeads.length) * 1000) / 10)
    : 0;

  // 5. Category A, Metric 5: Reason-Logged Rate
  // % of COLD/DNC leads where the recruiter documented a non-null reason.
  const [coldClosures, dncFlags] = await Promise.all([
    prisma.stageHistory.findMany({
      where: {
        changedByRecruiterId: recruiterId,
        toStage: "COLD",
        changedAt: { gte: periodStart, lt: periodEnd },
      },
      select: { reason: true },
    }),
    prisma.leadFlagEvent.findMany({
      where: {
        setByRecruiterId: recruiterId,
        flag: "DNC",
        setAt: { gte: periodStart, lt: periodEnd },
      },
      select: { reason: true },
    }),
  ]);

  const totalClosures = coldClosures.length + dncFlags.length;
  const withReason =
    coldClosures.filter((c) => !!c.reason?.trim()).length +
    dncFlags.filter((d) => !!d.reason?.trim()).length;

  const reasonLoggedRate = totalClosures > 0
    ? Math.min(100, Math.round((withReason / totalClosures) * 1000) / 10)
    : (assignedLeads.length > 0 && touchDelaysDays.length > 0 ? 100 : 0);

  // --- Category B: Outcome / Signal Metrics ---
  const onboardedCount = assignedLeads.filter((l) => l.stage === "ONBOARDED").length;
  const onboardVsQueue = assignedLeads.length
    ? Math.min(100, Math.round((onboardedCount / assignedLeads.length) * 1000) / 10)
    : 0;

  const coldReactivations = await prisma.stageHistory.count({
    where: {
      changedByRecruiterId: recruiterId,
      fromStage: "COLD",
      toStage: { not: "COLD" },
      changedAt: { gte: periodStart, lt: periodEnd },
    },
  });

  const interviews = await prisma.manualActivityLog.count({
    where: {
      recruiterId,
      type: "INTERVIEW",
      scheduledAt: { gte: periodStart, lt: periodEnd },
    },
  });

  const manualConversions = await prisma.manualActivityLog.count({
    where: {
      recruiterId,
      type: "CALL",
      scheduledAt: { gte: periodStart, lt: periodEnd },
    },
  });

  // Fetch active assigned requirements and market demand for this recruiter
  const assignedReqs = await prisma.requirement.findMany({
    where: { recruiterId, status: { in: ["ACTIVE", "UNASSIGNED"] } },
  });
  const totalAssignedHeadcount = assignedReqs.reduce((sum, r) => sum + r.headcountNeeded, 0);

  // Read latest versioned KpiConfig from DB
  const kpiConfigs = await prisma.kpiConfig.findMany({ orderBy: { effectiveDate: "desc" } });
  const configMap = new Map<string, (typeof kpiConfigs)[0]>();
  for (const cfg of kpiConfigs) {
    if (!configMap.has(cfg.metricKey)) configMap.set(cfg.metricKey, cfg);
  }

  // Dynamically resolve targets based on assigned client/market demand
  const dynamicRubric = RUBRIC.map((def) => {
    const dbConfig = configMap.get(def.metricKey);
    const baseTarget = dbConfig?.target != null ? Number(dbConfig.target) : def.target ?? def.goodBand;
    const baseGoodBand = dbConfig?.goodBand != null ? Number(dbConfig.goodBand) : def.goodBand;
    const weight = dbConfig?.weight != null ? Number(dbConfig.weight) : def.weight;
    const scored = dbConfig?.scored != null ? dbConfig.scored : def.scored;
    const direction = (dbConfig?.direction ?? def.direction) as "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";

    let effectiveTarget = baseTarget;
    let effectiveGoodBand = baseGoodBand;

    // Dynamic market demand scaling:
    // If recruiter has active assigned demand, scale volumetric targets proportionally
    if (totalAssignedHeadcount > 0) {
      if (def.metricKey === "outreach_volume") {
        effectiveTarget = Math.max(100, Math.round(totalAssignedHeadcount * 42));
        effectiveGoodBand = effectiveTarget;
      } else if (def.metricKey === "proactive_sourcing") {
        effectiveTarget = Math.max(10, Math.round(totalAssignedHeadcount * 3.4));
        effectiveGoodBand = effectiveTarget;
      } else if (def.metricKey === "cold_lead_conversion") {
        effectiveTarget = Math.max(5, Math.round(totalAssignedHeadcount * 1.8));
        effectiveGoodBand = effectiveTarget;
      }
    }

    return {
      ...def,
      target: effectiveTarget,
      goodBand: effectiveGoodBand,
      weight,
      scored,
      direction,
    };
  });

  const currentByKey: Record<string, number> = {
    outreach_volume: outreachVolume,
    proactive_sourcing: proactiveSourcing,
    time_to_first_touch: Math.round(timeToFirstTouch * 10) / 10,
    progression_rate: progressionRate,
    reason_logged_rate: reasonLoggedRate,
    onboard_vs_queue: onboardVsQueue,
    cold_lead_conversion: coldReactivations,
    manual_interviews: interviews,
    manual_conversion: manualConversions,
  };

  // Calculate real database-backed rates
  const totalOutbound = outreachVolume;
  const repliedInteractions = await prisma.interactionEvent.count({
    where: {
      recruiterId,
      direction: "INBOUND",
      occurredAt: { gte: periodStart, lt: periodEnd },
    },
  });

  // Outreach Effectiveness: % of outbound outreach that yielded a response or pipeline progression
  const outreachEffectiveness = totalOutbound > 0
    ? Math.min(100, Math.round(((repliedInteractions + advancedLeads.length) / totalOutbound) * 100))
    : 0;

  // Response Rate: % of outbound outreach that received an inbound reply
  const responseRate = totalOutbound > 0
    ? Math.min(100, Math.round((repliedInteractions / totalOutbound) * 100))
    : 0;

  // SLA Adherence: % of assigned leads contacted within 1 business day
  const withinSlaCount = touchDelaysDays.filter((d) => d <= 1.0).length;
  const slaAdherence = touchDelaysDays.length > 0
    ? Math.min(100, Math.round((withinSlaCount / touchDelaysDays.length) * 100))
    : 0;

  // DNC Rate
  const dncPct = assignedLeads.length > 0
    ? Math.min(100, Math.round((dncFlags.length / assignedLeads.length) * 100))
    : 0;

  // Pipeline Health: % of leads actively in progress (not COLD / DNC)
  const activeLeadsCount = assignedLeads.filter((l) => l.stage !== "COLD" && l.stage !== "NEW").length;
  const pipelineHealth = assignedLeads.length > 0
    ? Math.min(100, Math.round((activeLeadsCount / assignedLeads.length) * 100))
    : 0;

  // Profile Quality: % of assigned leads with complete data
  const completeLeadsCount = assignedLeads.filter((l) => l.targetLanguage && l.services && l.services.length > 0).length;
  const profileQuality = assignedLeads.length > 0
    ? Math.min(100, Math.round((completeLeadsCount / assignedLeads.length) * 100))
    : 0;

  // Calculate composite Overall Score (0-100) using dynamic rubric targets
  // Only score when actual candidate outreach or sourcing activity has been executed
  const hasOutreachActivity = outreachVolume > 0 || touchDelaysDays.length > 0;
  const overallScoreRaw = hasOutreachActivity
    ? dynamicRubric.reduce(
        (sum, def) =>
          sum +
          calculateWeightedContribution(
            currentByKey[def.metricKey] ?? 0,
            def.goodBand ?? def.target ?? 100,
            def.weight,
            def.scored,
            def.direction
          ),
        0
      )
    : 0;

  const overallScore = Math.round(overallScoreRaw * 10) / 10;
  const bandLabel = hasOutreachActivity ? getBandLabel(overallScore) : "New";

  const previousSnapshot = await prisma.recruiterScoreSnapshot.findFirst({
    where: { recruiterId },
    orderBy: { period: "desc" },
  });

  const snapshot = await prisma.recruiterScoreSnapshot.upsert({
    where: { recruiterId_period: { recruiterId, period: periodStart } },
    create: {
      recruiterId,
      period: periodStart,
      isNew: !previousSnapshot,
      overallScore,
      previousScore: previousSnapshot?.overallScore,
      bandLabel,
      kpiConfigSnapshot: dynamicRubric,
    },
    update: {
      overallScore,
      previousScore: previousSnapshot?.overallScore,
      bandLabel,
      kpiConfigSnapshot: dynamicRubric,
      computedAt: new Date(),
    },
  });

  // Upsert per-metric snapshots with normalized scores (0-100)
  await prisma.$transaction(
    dynamicRubric.map((def) => {
      const cur = currentByKey[def.metricKey] ?? 0;
      const normalized = calculateNormalizedMetricScore(cur, def.goodBand ?? def.target ?? 100, def.direction);
      return prisma.recruiterMetricSnapshot.upsert({
        where: { scoreSnapshotId_metricKey: { scoreSnapshotId: snapshot.id, metricKey: def.metricKey } },
        create: {
          scoreSnapshotId: snapshot.id,
          metricKey: def.metricKey,
          currentValue: cur,
          normalized,
          metricStatus: normalized >= 80 ? "STRONG" : normalized >= 60 ? "SOLID" : "NEEDS_ATTENTION",
        },
        update: {
          currentValue: cur,
          normalized,
          metricStatus: normalized >= 80 ? "STRONG" : normalized >= 60 ? "SOLID" : "NEEDS_ATTENTION",
        },
      });
    })
  );

  // Update cached summary for roster view strictly from live database activity
  await prisma.recruiterKpiSummary.upsert({
    where: { recruiterId },
    create: {
      recruiterId,
      outreachEffectiveness,
      responseRate,
      slaAdherence,
      overallScore,
      outreachVolume,
      dncPct,
      interviewToOffer: 0,
      offerAcceptance: 0,
      profileQuality,
      clientSatisfaction: 0,
      aiAdoption: 0,
      pipelineHealth,
      emailOpenRate: 0,
      avgTurnaroundDays: currentByKey.time_to_first_touch,
    },
    update: {
      outreachEffectiveness,
      responseRate,
      slaAdherence,
      overallScore,
      outreachVolume,
      dncPct,
      profileQuality,
      pipelineHealth,
      avgTurnaroundDays: currentByKey.time_to_first_touch,
      computedAt: new Date(),
    },
  });

  return snapshot;
}

/** Runs the monthly snapshot for every active recruiter. */
export async function runMonthlyScoring(period: Date = new Date()) {
  const recruiters = await prisma.user.findMany({
    where: { role: "RECRUITER", isActive: true },
    select: { id: true },
  });
  for (const r of recruiters) {
    try {
      await computeRecruiterScoreSnapshot(r.id, period);
    } catch (err) {
      console.error(`[scoring.job] failed for recruiter ${r.id}:`, err);
    }
  }
}
