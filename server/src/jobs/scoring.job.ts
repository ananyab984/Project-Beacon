import { prisma } from "../prisma";

// Mirrors client/src/lib/evaluation.ts's RUBRIC exactly (weight/goodBand/direction/target),
// so the score this job computes matches what the dashboard already expects to render.
const RUBRIC = [
  { metricKey: "outreach_volume", group: "ACTIVITY_AND_EFFORT" as const, label: "Outreach Volume", unit: "COUNT" as const, direction: "HIGHER_IS_BETTER" as const, target: null, weight: 30, goodBand: 420, scored: true },
  { metricKey: "proactive_sourcing", group: "ACTIVITY_AND_EFFORT" as const, label: "Proactive Sourcing", unit: "COUNT" as const, direction: "HIGHER_IS_BETTER" as const, target: null, weight: 30, goodBand: 34, scored: true },
  { metricKey: "time_to_first_touch", group: "ACTIVITY_AND_EFFORT" as const, label: "Time to First Touch", unit: "DAYS" as const, direction: "LOWER_IS_BETTER" as const, target: 2, weight: 20, goodBand: 1, scored: true },
  { metricKey: "progression_rate", group: "OWNERSHIP_AND_FOLLOW_THROUGH" as const, label: "Progression Rate", unit: "PCT" as const, direction: "HIGHER_IS_BETTER" as const, target: 60, weight: 10, goodBand: 80, scored: true },
  { metricKey: "reason_logged_rate", group: "OWNERSHIP_AND_FOLLOW_THROUGH" as const, label: "Reason Logged Rate", unit: "PCT" as const, direction: "HIGHER_IS_BETTER" as const, target: 90, weight: 10, goodBand: 100, scored: true },
  { metricKey: "onboard_vs_queue", group: "OUTCOME_METRICS" as const, label: "Onboard vs Queue", unit: "PCT" as const, direction: "HIGHER_IS_BETTER" as const, target: null, weight: 0, goodBand: 100, scored: false },
  { metricKey: "cold_lead_conversion", group: "OUTCOME_METRICS" as const, label: "Cold Lead Reactivation", unit: "COUNT" as const, direction: "HIGHER_IS_BETTER" as const, target: null, weight: 0, goodBand: 18, scored: false },
  { metricKey: "manual_interviews", group: "OUTCOME_METRICS" as const, label: "Manual Interviews", unit: "COUNT" as const, direction: "HIGHER_IS_BETTER" as const, target: null, weight: 0, goodBand: 15, scored: false },
  { metricKey: "manual_conversion", group: "OUTCOME_METRICS" as const, label: "Manual Conversion", unit: "COUNT" as const, direction: "HIGHER_IS_BETTER" as const, target: null, weight: 0, goodBand: 10, scored: false },
];

/** Bootstraps current KpiConfig rows on first run so scoring works without a
 *  separate manual seed step -- idempotent, only creates what's missing. */
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

function normalizedContribution(current: number, def: (typeof RUBRIC)[number]): number {
  if (!def.scored || def.weight <= 0 || current <= 0) return 0;
  const ratio =
    def.direction === "LOWER_IS_BETTER"
      ? Math.max(0, 1 - Math.max(0, current - def.goodBand) / Math.max(1, def.goodBand * 2))
      : Math.min(1, current / def.goodBand);
  return Math.round(ratio * def.weight);
}

/** Computes one recruiter's monthly score snapshot from real activity data --
 *  replaces the old mock's static, never-updated per-recruiter constants. */
export async function computeRecruiterScoreSnapshot(recruiterId: string, period: Date) {
  await ensureKpiConfigSeeded();

  const periodStart = new Date(period.getFullYear(), period.getMonth(), 1);
  const periodEnd = new Date(period.getFullYear(), period.getMonth() + 1, 1);

  const [outreachVolume, selfSourcedCount, outboundEvents, assignedLeads, stageHistoryRows, coldReactivations, interviews] =
    await Promise.all([
      prisma.interactionEvent.count({
        where: { recruiterId, direction: "OUTBOUND", occurredAt: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.lead.count({
        where: { createdByRecruiterId: recruiterId, isSelfSourced: true, createdAt: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.interactionEvent.findMany({
        where: { recruiterId, direction: "OUTBOUND", occurredAt: { gte: periodStart, lt: periodEnd } },
        select: { leadId: true, occurredAt: true },
      }),
      prisma.lead.findMany({
        where: { assignedRecruiterId: recruiterId },
        select: { id: true, stage: true, createdAt: true },
      }),
      prisma.stageHistory.findMany({
        where: { changedByRecruiterId: recruiterId, changedAt: { gte: periodStart, lt: periodEnd } },
        select: { toStage: true, fromStage: true, reason: true },
      }),
      prisma.stageHistory.count({
        where: { changedByRecruiterId: recruiterId, fromStage: "COLD", changedAt: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.manualActivityLog.count({
        where: { recruiterId, type: "INTERVIEW", scheduledAt: { gte: periodStart, lt: periodEnd } },
      }),
    ]);

  // time_to_first_touch: avg days between a lead's creation and its first outbound touch this period.
  const firstTouchByLead = new Map<string, Date>();
  for (const e of outboundEvents) {
    const existing = firstTouchByLead.get(e.leadId);
    if (!existing || e.occurredAt < existing) firstTouchByLead.set(e.leadId, e.occurredAt);
  }
  const leadCreatedAt = new Map(assignedLeads.map((l) => [l.id, l.createdAt]));
  const touchDelaysDays: number[] = [];
  for (const [leadId, touchedAt] of firstTouchByLead) {
    const createdAt = leadCreatedAt.get(leadId);
    if (createdAt) touchDelaysDays.push((touchedAt.getTime() - createdAt.getTime()) / 86_400_000);
  }
  const timeToFirstTouch = touchDelaysDays.length
    ? touchDelaysDays.reduce((a, b) => a + b, 0) / touchDelaysDays.length
    : 0;

  // progression_rate: % of this period's stage transitions that moved forward (not into COLD).
  const forwardMoves = stageHistoryRows.filter((s) => s.toStage !== "COLD").length;
  const progressionRate = stageHistoryRows.length ? (forwardMoves / stageHistoryRows.length) * 100 : 0;

  // reason_logged_rate: % of this period's COLD closures that logged a reason.
  const coldClosures = stageHistoryRows.filter((s) => s.toStage === "COLD");
  const reasonLoggedRate = coldClosures.length
    ? (coldClosures.filter((s) => !!s.reason).length / coldClosures.length) * 100
    : 0;

  const onboardedCount = assignedLeads.filter((l) => l.stage === "ONBOARDED").length;
  const onboardVsQueue = assignedLeads.length ? (onboardedCount / assignedLeads.length) * 100 : 0;

  const currentByKey: Record<string, number> = {
    outreach_volume: outreachVolume,
    proactive_sourcing: selfSourcedCount,
    time_to_first_touch: Math.round(timeToFirstTouch * 10) / 10,
    progression_rate: Math.round(progressionRate * 10) / 10,
    reason_logged_rate: Math.round(reasonLoggedRate * 10) / 10,
    onboard_vs_queue: Math.round(onboardVsQueue * 10) / 10,
    cold_lead_conversion: coldReactivations,
    manual_interviews: interviews,
    manual_conversion: assignedLeads.filter((l) => l.stage === "ONBOARDED").length, // approximation, see note below
  };

  const overallScore = RUBRIC.reduce((sum, def) => sum + normalizedContribution(currentByKey[def.metricKey] ?? 0, def), 0);

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
      kpiConfigSnapshot: RUBRIC,
    },
    update: {
      overallScore,
      previousScore: previousSnapshot?.overallScore,
      kpiConfigSnapshot: RUBRIC,
      computedAt: new Date(),
    },
  });

  await prisma.$transaction(
    RUBRIC.map((def) =>
      prisma.recruiterMetricSnapshot.upsert({
        where: { scoreSnapshotId_metricKey: { scoreSnapshotId: snapshot.id, metricKey: def.metricKey } },
        create: {
          scoreSnapshotId: snapshot.id,
          metricKey: def.metricKey,
          currentValue: currentByKey[def.metricKey] ?? 0,
          normalized: normalizedContribution(currentByKey[def.metricKey] ?? 0, def),
        },
        update: {
          currentValue: currentByKey[def.metricKey] ?? 0,
          normalized: normalizedContribution(currentByKey[def.metricKey] ?? 0, def),
        },
      })
    )
  );

  await prisma.recruiterKpiSummary.upsert({
    where: { recruiterId },
    create: {
      recruiterId,
      outreachEffectiveness: overallScore,
      responseRate: 0,
      slaAdherence: 0,
      overallScore,
      outreachVolume,
      dncPct: 0,
      interviewToOffer: 0,
      offerAcceptance: 0,
      profileQuality: 0,
      clientSatisfaction: 0,
      aiAdoption: 0,
      pipelineHealth: 0,
      emailOpenRate: 0,
      avgTurnaroundDays: currentByKey.time_to_first_touch,
    },
    update: {
      overallScore,
      outreachVolume,
      avgTurnaroundDays: currentByKey.time_to_first_touch,
      computedAt: new Date(),
    },
  });

  return snapshot;
}

/** Runs the monthly snapshot for every active recruiter (owner/contractor excluded --
 *  scoring is a recruiter-performance concept per evaluation.ts). */
export async function runMonthlyScoring(period: Date = new Date()) {
  const recruiters = await prisma.user.findMany({ where: { role: "RECRUITER", isActive: true }, select: { id: true } });
  for (const r of recruiters) {
    try {
      await computeRecruiterScoreSnapshot(r.id, period);
    } catch (err) {
      console.error(`[scoring.job] failed for recruiter ${r.id}:`, err);
    }
  }
}
