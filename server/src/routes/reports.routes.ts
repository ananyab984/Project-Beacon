import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";

export const reportsRouter = Router();

reportsRouter.use(authenticateJwt);

function getSinceDate(range: string): Date {
  const now = Date.now();
  switch (range) {
    case "7d":
      return new Date(now - 7 * 86400_000);
    case "90d":
      return new Date(now - 90 * 86400_000);
    case "ytd":
      return new Date(new Date().getFullYear(), 0, 1);
    case "30d":
    default:
      return new Date(now - 30 * 86400_000);
  }
}

// GET /api/reports/analytics?range=30d — comprehensive performance snapshot
reportsRouter.get(
  "/analytics",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "30d";
    const since = getSinceDate(range);

    // 1. Total Outreaches in range
    const outreachCount = await prisma.interactionEvent.count({
      where: {
        direction: "OUTBOUND",
        occurredAt: { gte: since },
      },
    });

    // 2. Active Recruiters and Team Scores
    const recruiters = await prisma.user.findMany({
      where: { role: "RECRUITER" },
      select: { id: true, name: true, email: true },
    });

    const snapshots = await prisma.recruiterScoreSnapshot.findMany({
      where: {
        recruiterId: { in: recruiters.map((r) => r.id) },
      },
      orderBy: { period: "desc" },
    });

    // Pick latest snapshot per recruiter
    const latestScoreMap = new Map<string, number>();
    for (const snap of snapshots) {
      if (!latestScoreMap.has(snap.recruiterId)) {
        const numScore = typeof snap.overallScore === "number" ? snap.overallScore : (snap.overallScore as any).toNumber?.() ?? Number(snap.overallScore);
        latestScoreMap.set(snap.recruiterId, numScore);
      }
    }

    const teamScores = Array.from(latestScoreMap.values());
    const teamAvgScore = teamScores.length
      ? Math.round(teamScores.reduce((a, b) => a + b, 0) / teamScores.length)
      : 75;

    // 3. Market Demand & Fill Rate
    const demands = await prisma.clientDemand.findMany({
      include: { serviceBreakdown: true, client: { select: { name: true } } },
    });

    const totalDemand = demands.reduce((acc, d) => acc + d.headcountNeeded, 0);
    const totalFilled = demands.reduce((acc, d) => acc + d.filled, 0);
    const fillRate = totalDemand > 0 ? Math.round((totalFilled / totalDemand) * 100) : 0;

    // 4. AI Drafts and Time Saved
    const aiDraftsCount = await prisma.emailQueueItem.count({
      where: {
        aiGenerated: true,
        receivedAt: { gte: since },
      },
    });
    const savedHours = Math.round((aiDraftsCount * 9) / 60);

    // 5. Language Breakdown
    const langMap = new Map<string, { needed: number; filled: number; gap: number }>();
    for (const d of demands) {
      const cur = langMap.get(d.language) ?? { needed: 0, filled: 0, gap: 0 };
      langMap.set(d.language, {
        needed: cur.needed + d.headcountNeeded,
        filled: cur.filled + d.filled,
        gap: cur.gap + d.gap,
      });
    }
    const languageBreakdown = Array.from(langMap, ([language, stats]) => ({
      language,
      ...stats,
    })).sort((a, b) => b.needed - a.needed);

    // 6. Recruiter Throughput (Leads onboarded in range)
    const onboardedStageEvents = await prisma.stageHistory.findMany({
      where: {
        toStage: "ONBOARDED",
        changedAt: { gte: since },
      },
      select: { changedByRecruiterId: true },
    });

    const recruiterThroughput = recruiters.map((r) => {
      const count = onboardedStageEvents.filter((e) => e.changedByRecruiterId === r.id).length;
      return {
        id: r.id,
        name: r.name,
        leadsOnboarded: count,
        score: latestScoreMap.get(r.id) ?? 75,
      };
    }).sort((a, b) => b.leadsOnboarded - a.leadsOnboarded);

    return res.json({
      range,
      since: since.toISOString(),
      summary: {
        outreachVolume: outreachCount,
        activeRecruitersCount: recruiters.length,
        teamAvgScore,
        totalDemand,
        totalFilled,
        fillRate,
        aiDraftsCount,
        savedHours,
      },
      languageBreakdown,
      recruiterThroughput,
    });
  })
);

// GET /api/reports/recent — list of persistent audit reports & exports
reportsRouter.get(
  "/recent",
  requireRole("owner", "recruiter"),
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const reports = [
      {
        id: "rep-monthly-recruiter-scorecard",
        name: "Monthly Recruiter Performance & Evaluation Scorecard",
        type: "pdf",
        range: "Monthly Snapshot",
        generated: now.toISOString(),
        description: "Composite Category A (100%) and Category B outcome metrics across all active recruiters.",
      },
      {
        id: "rep-market-demand-gap",
        name: "Market Demand & Headcount Gap Analysis",
        type: "csv",
        range: "Live Pipeline",
        generated: now.toISOString(),
        description: "Language pair headcount needed vs. filled with critical priority indicators.",
      },
      {
        id: "rep-outreach-activity-log",
        name: "Outreach & Response Rate Audit Log",
        type: "log",
        range: "Last 30 Days",
        generated: now.toISOString(),
        description: "Multi-channel (LinkedIn DM & Resend Email) delivery and reply timestamps.",
      },
      {
        id: "rep-lead-stage-progression",
        name: "Lead Pipeline Progression & Sourcing Report",
        type: "csv",
        range: "Quarter to Date",
        generated: now.toISOString(),
        description: "Stage-by-stage progression from New/Contacted to Onboarded with self-sourced attribution.",
      },
    ];

    return res.json({ reports });
  })
);

// GET /api/reports/export/:type — generate downloadable CSV files
reportsRouter.get(
  "/export/:type",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const { type } = req.params;

    if (type === "recruiters.csv" || type === "scorecard") {
      const recruiters = await prisma.user.findMany({
        where: { role: "RECRUITER" },
        include: { scoreSnapshots: { orderBy: { period: "desc" }, take: 1 } },
      });

      let csv = "Recruiter Name,Email,Overall Score,Band Label,Summary,Snapshot Period\n";
      for (const r of recruiters) {
        const snap = r.scoreSnapshots[0];
        const score = snap?.overallScore != null ? Number(snap.overallScore) : "N/A";
        const band = snap?.bandLabel ?? "No data";
        const summary = (snap?.summary ?? "").replace(/"/g, '""');
        const period = snap?.period ? snap.period.toISOString().slice(0, 7) : "N/A";
        csv += `"${r.name}","${r.email}",${score},"${band}","${summary}","${period}"\n`;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="recruiter-evaluation-scorecard.csv"');
      return res.send(csv);
    }

    if (type === "demands.csv" || type === "market-demand") {
      const demands = await prisma.clientDemand.findMany({
        include: { client: { select: { name: true } }, serviceBreakdown: true },
        orderBy: { priority: "desc" },
      });

      let csv = "Client,Language,Services,Headcount Needed,Filled,Gap,Priority,Status,Project Name\n";
      for (const d of demands) {
        const services = d.serviceBreakdown.map((s) => `${s.service} (${s.needed})`).join("; ");
        csv += `"${d.client.name}","${d.language}","${services}",${d.headcountNeeded},${d.filled},${d.gap},"${d.priority}","${d.status}","${d.projectName ?? ""}"\n`;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="market-demand-matrix.csv"');
      return res.send(csv);
    }

    if (type === "leads.csv" || type === "leads-pipeline") {
      const leads = await prisma.lead.findMany({
        include: { assignedTo: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });

      let csv = "Lead Name,Email,Language,Stage,Services,Years of Exp,Vendor Exp,Assigned Recruiter,Enrichment Status,Created At\n";
      for (const l of leads) {
        const name = l.displayName || l.fullName || l.maskedLabel;
        const email = l.email ?? "";
        const lang = l.targetLanguage || l.sourceLanguage || "";
        const stage = l.stage;
        const services = (l.services ?? []).join("; ");
        const yoe = l.yearsOfExperience ?? "";
        const vendor = l.vendorExperience ?? "";
        const rec = l.assignedTo?.name ?? "Unassigned";
        const enrich = l.enrichmentStatus;
        const created = l.createdAt.toISOString();
        csv += `"${name}","${email}","${lang}","${stage}","${services}","${yoe}","${vendor}","${rec}","${enrich}","${created}"\n`;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="leads-pipeline-export.csv"');
      return res.send(csv);
    }

    // Default Full Summary CSV
    const demands = await prisma.clientDemand.findMany({ include: { client: true } });
    let csv = "Category,Metric,Value\n";
    csv += `Pipeline,Total Demand Headcount,${demands.reduce((s, d) => s + d.headcountNeeded, 0)}\n`;
    csv += `Pipeline,Total Placed Seats,${demands.reduce((s, d) => s + d.filled, 0)}\n`;
    csv += `Pipeline,Unfilled Gap,${demands.reduce((s, d) => s + d.gap, 0)}\n`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="global3-executive-summary.csv"');
    return res.send(csv);
  })
);
