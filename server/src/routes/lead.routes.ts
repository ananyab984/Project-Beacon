import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole, Role } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { findDuplicateLead, getLeadTimeline, claimLead, buildLeadWhere } from "../services/lead.service";
import { buildEmailDraft } from "../lib/messageTemplates";
import { enrichLeadById } from "../jobs/enrichment.job";

export const leadRouter = Router();

leadRouter.use(authenticateJwt);

const LEAD_SOURCES = ["LINKEDIN", "PROZ", "ADA", "ATA", "ATAA", "BODALGO", "FREELANCER", "APOLLO"] as const;
const LEAD_STAGES = ["NEW", "CONTACTED", "REPLIED", "NEGOTIATING", "INVITE_SENT", "ONBOARDED", "COLD"] as const;
const LEAD_FLAGS = ["DNC", "ON_HOLD", "WATCHING", "HIGH_PRIORITY"] as const;

const createLeadSchema = z.object({
  firstName: z.string().max(80).optional(),
  fullName: z.string().min(1).max(160),
  email: z.string().email().optional(),
  contactNumber: z.string().max(40).optional(),
  profileLink: z.string().url().optional(),
  country: z.string().max(80).optional(),
  source: z.enum(LEAD_SOURCES),
  services: z.array(z.string()).default([]),
  sourceLanguage: z.string().optional(),
  targetLanguage: z.string().optional(),
  secondaryLanguages: z.array(z.string()).default([]),
  yearsOfExperience: z.number().min(0).max(99).optional(),
  vendorExperience: z.string().optional(),
  assignedRecruiterId: z.string().uuid().optional(),
});

// GET /api/leads — full pool, owner + recruiter only (contractors use /mine)
leadRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase() as Role;
    const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 100);
    const cursor = req.query.cursor as string | undefined;
    const dateRangeDays: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };
    const requestedRange = req.query.dateRange ? dateRangeDays[String(req.query.dateRange)] : undefined;
    const since = requestedRange ? new Date(Date.now() - requestedRange * 86_400_000) : undefined;

    const where = buildLeadWhere({
      q: req.query.q as string,
      stage: req.query.stage as string,
      language: req.query.language as string,
      country: req.query.country as string,
      service: req.query.service as string,
      recruiterId: req.query.recruiterId as string,
      flag: req.query.flag as string,
      since,
    });

    // Recruiters see the global (identity-resolved, complete) pool + their own assigned/created leads.
    if (role === "recruiter") {
      const scopeConditions = [
        { identityResolved: true, enrichmentStatus: "COMPLETE" as const },
        { assignedRecruiterId: req.user!.id },
        { createdByRecruiterId: req.user!.id },
      ];
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: scopeConditions },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
    });

    const hasMore = leads.length > limit;
    const page = hasMore ? leads.slice(0, limit) : leads;
    return res.json({ leads: page, nextCursor: hasMore ? page[page.length - 1].id : null });
  })
);

// GET /api/leads/mine — contractor's own submissions, or recruiter's assigned+claimed
leadRouter.get(
  "/mine",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase() as Role;
    const userId = req.user!.id;

    const where =
      role === "contractor"
        ? { createdByContractorId: userId }
        : { OR: [{ assignedRecruiterId: userId }, { claimedByRecruiterId: userId }] };

    const leads = await prisma.lead.findMany({ where, orderBy: { createdAt: "desc" } });
    return res.json({ leads });
  })
);

// GET /api/leads/export — CSV export honoring the current filter set
leadRouter.get(
  "/export",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const EXPORT_ROW_CAP = 5000;
    const where = buildLeadWhere({
      q: req.query.q as string,
      stage: req.query.stage as string,
      language: req.query.language as string,
      country: req.query.country as string,
      service: req.query.service as string,
      recruiterId: req.query.recruiterId as string,
      flag: req.query.flag as string,
    });
    const leads = await prisma.lead.findMany({ where, take: EXPORT_ROW_CAP, orderBy: { createdAt: "desc" } });
    if (leads.length === EXPORT_ROW_CAP) {
      console.warn(`Lead export truncated at ${EXPORT_ROW_CAP} rows for filter set`, where);
    }

    const headers = ["id", "fullName", "email", "contactNumber", "stage", "country", "source", "createdAt"];
    const rows = leads.map((l) =>
      headers.map((h) => JSON.stringify((l as any)[h] ?? "")).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=leads_export.csv");
    return res.send(csv);
  })
);

// POST /api/leads/check-duplicate — SEARCH_ONLY access (contractors + recruiters + owner)
leadRouter.post(
  "/check-duplicate",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, contactNumber, fullName } = req.body || {};
    const result = await findDuplicateLead({ email, contactNumber, fullName });
    return res.json(result);
  })
);

// GET /api/leads/:id — single lead + merged activity timeline
leadRouter.get(
  "/:id",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    const role = req.user!.role.toLowerCase() as Role;
    if (role === "contractor" && lead.createdByContractorId !== req.user!.id) {
      throw new ApiError(403, "FORBIDDEN", "Contractors can only view their own submitted leads");
    }

    const timeline = await getLeadTimeline(lead.id);
    return res.json({ lead, timeline });
  })
);

// POST /api/leads — create (manual Add Lead dialog + contractor submission)
leadRouter.post(
  "/",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createLeadSchema.parse(req.body);
    const role = req.user!.role.toLowerCase() as Role;

    const dup = await findDuplicateLead({ email: parsed.email, contactNumber: parsed.contactNumber, fullName: parsed.fullName });

    const lead = await prisma.lead.create({
      data: {
        ...parsed,
        maskedLabel: `Lead #${Date.now().toString(36).toUpperCase()}`,
        identityResolved: false,
        emailVerified: false,
        createdByContractorId: role === "contractor" ? req.user!.id : undefined,
        createdByRecruiterId: role !== "contractor" ? req.user!.id : undefined,
        isSelfSourced: role !== "contractor",
        assignedRecruiterId: parsed.assignedRecruiterId ?? (role === "recruiter" ? req.user!.id : undefined),
        assignedAt: parsed.assignedRecruiterId || role === "recruiter" ? new Date() : undefined,
        dupFlagged: dup.isDuplicate,
        dupFlaggedField: dup.matchedField ?? undefined,
      },
    });

    // 1. Auto-add to email queue if created by recruiter/owner, using the
    // approved template filled ONLY with this lead's real fields -- never a
    // fabricated fact.
    if (role !== "contractor") {
      const { subject, body } = buildEmailDraft(lead);
      await prisma.emailQueueItem.create({
        data: {
          leadId: lead.id,
          recruiterId: req.user!.id,
          candidateName: lead.fullName || "Candidate",
          candidateRole: parsed.services.join(", ") || parsed.targetLanguage || "Freelance Linguist",
          status: "REVIEW_NEEDED",
          subject,
          body,
          aiGenerated: false,
        },
      }).catch((err) => console.error("Failed to auto-create email queue item:", err));
    }

    // 2. Trigger background enrichment pipeline immediately as soon as lead is added
    setImmediate(() => {
      enrichLeadById(lead.id).catch((err) => console.error("Immediate enrichment error:", err));
    });

    return res.status(201).json({ lead, duplicateWarning: dup.isDuplicate ? dup : null });
  })
);

// POST /api/leads/bulk — CSV bulk upload; each row is duplicate-checked independently
leadRouter.post(
  "/bulk",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const rows = z.array(createLeadSchema).max(2000).parse(req.body?.leads ?? []);
    const role = req.user!.role.toLowerCase() as Role;
    const results: Array<{ index: number; status: "accepted" | "duplicate" | "error"; leadId?: string; message?: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const dup = await findDuplicateLead({ email: row.email, contactNumber: row.contactNumber, fullName: row.fullName });
        const lead = await prisma.lead.create({
          data: {
            ...row,
            maskedLabel: `Lead #${Date.now().toString(36).toUpperCase()}${i}`,
            identityResolved: false,
            emailVerified: false,
            createdByContractorId: role === "contractor" ? req.user!.id : undefined,
            createdByRecruiterId: role !== "contractor" ? req.user!.id : undefined,
            isSelfSourced: role !== "contractor",
            dupFlagged: dup.isDuplicate,
            dupFlaggedField: dup.matchedField ?? undefined,
          },
        });

        setImmediate(() => {
          enrichLeadById(lead.id).catch((err) => console.error("Immediate bulk enrichment error:", err));
        });

        results.push({ index: i, status: dup.isDuplicate ? "duplicate" : "accepted", leadId: lead.id });
      } catch (err: any) {
        results.push({ index: i, status: "error", message: err.message });
      }
    }
    return res.status(201).json({ results });
  })
);

// PATCH /api/leads/bulk — bulk stage/recruiter reassignment for the bulk-action bar
leadRouter.patch(
  "/bulk",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(500),
      stage: z.enum(LEAD_STAGES).optional(),
      recruiterId: z.string().uuid().optional(),
    });
    const { ids, stage, recruiterId } = schema.parse(req.body);
    if (!stage && !recruiterId) throw new ApiError(400, "NO_OP", "Provide stage or recruiterId to apply");

    if (stage) {
      await prisma.$transaction(
        ids.map((id) =>
          prisma.stageHistory.create({
            data: { leadId: id, toStage: stage, changedByRecruiterId: req.user!.id },
          })
        )
      );
      await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { stage } });
    }
    if (recruiterId) {
      await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { assignedRecruiterId: recruiterId, assignedAt: new Date() } });
    }
    return res.json({ updated: ids.length });
  })
);

// PATCH /api/leads/:id — partial update; stage changes are logged to StageHistory
leadRouter.patch(
  "/:id",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    const role = req.user!.role.toLowerCase() as Role;
    if (role === "contractor" && existing.createdByContractorId !== req.user!.id) {
      throw new ApiError(403, "FORBIDDEN", "Contractors can only edit their own submitted leads");
    }

    const schema = z.object({
      displayName: z.string().max(160).optional(),
      identityResolved: z.boolean().optional(),
      enrichmentStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "FLAGGED_REVIEW"]).optional(),
      flags: z.array(z.enum(LEAD_FLAGS)).optional(),
      services: z.array(z.string()).optional(),
      sourceLanguage: z.string().optional(),
      targetLanguage: z.string().optional(),
      email: z.string().email().optional(),
      contactNumber: z.string().optional(),
      yearsOfExperience: z.number().optional(),
      vendorExperience: z.string().optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      stage: z.enum(LEAD_STAGES).optional(),
      closureReason: z.string().optional(),
    });
    const patch = schema.parse(req.body);

    if (patch.identityResolved || patch.enrichmentStatus === "COMPLETE") {
      patch.identityResolved = true;
      patch.enrichmentStatus = "COMPLETE";
    }

    if (patch.stage && patch.stage !== existing.stage) {
      if (patch.stage === "COLD" && !patch.closureReason) {
        throw new ApiError(400, "REASON_REQUIRED", "A reason is required when moving a lead to Cold");
      }
      await prisma.stageHistory.create({
        data: {
          leadId: existing.id,
          fromStage: existing.stage,
          toStage: patch.stage,
          changedByRecruiterId: req.user!.id,
          reason: patch.closureReason,
        },
      });
    }

    const updated = await prisma.lead.update({
      where: { id: existing.id },
      data: { ...patch, lastActivityAt: new Date() },
    });

    // Auto-update Email Queue items for this lead with corrected email & enriched portfolio details
    if (patch.identityResolved || patch.email || patch.yearsOfExperience || patch.vendorExperience || patch.targetLanguage) {
      const items = await prisma.emailQueueItem.findMany({ where: { leadId: existing.id } });
      for (const item of items) {
        const candidateName = patch.displayName || updated.fullName || item.candidateName;
        const firstName = candidateName.split(" ")[0] || candidateName;
        const language = patch.targetLanguage || updated.targetLanguage || patch.sourceLanguage || updated.sourceLanguage || item.candidateRole || "Language";
        const yearsOfExp = patch.yearsOfExperience ?? (updated.yearsOfExperience ? updated.yearsOfExperience.toNumber() : null);
        const vendorExp = patch.vendorExperience ?? updated.vendorExperience;

        let enrichNote = "";
        if (yearsOfExp || vendorExp) {
          const expText = yearsOfExp ? `${yearsOfExp} years of experience` : "";
          const vendorText = vendorExp ? `working with ${vendorExp}` : "";
          const combined = [expText, vendorText].filter(Boolean).join(" ");
          if (combined) enrichNote = ` (including your ${combined})`;
        }

        const newSubject = `Global3 Outreach · Freelance Partnership (${candidateName})`;
        const newBody = `Hi ${firstName},\n\nI hope this email finds you well.\n\nI'm reaching out from the Resource Management team at Global3. We recently reviewed your profile${enrichNote} and believe your expertise would be a strong asset to our current and upcoming project pipelines.\n\nWe are actively looking to connect with talented freelance ${language} linguists who value long-term, meaningful collaboration over one-off tasks.\n\nAt Global3, we pride ourselves on building lasting partnerships with our global network of professionals. You can find more details about our mission and the scope of our work at global3.io.\n\nIf you are open to exploring a partnership, please submit your application through our portal so we can align your profile with relevant opportunities: https://app.global3.io/apply\n\nShould you have any questions before applying, please feel free to reach out to us at resources@global3.io. We're happy to provide more information.\n\nBest regards,\nResources Team`;

        await prisma.emailQueueItem.update({
          where: { id: item.id },
          data: {
            subject: newSubject,
            body: newBody,
            candidateName,
            candidateRole: language,
          },
        }).catch(() => null);
      }
    }

    return res.json({ lead: updated });
  })
);

// POST /api/leads/:id/claim — atomic claim from the Global Leads pool
leadRouter.post(
  "/:id/claim",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await claimLead(req.params.id, req.user!.id);
    return res.json({ lead });
  })
);

// POST /api/leads/:id/flags — add a flag (DNC/ON_HOLD/WATCHING/HIGH_PRIORITY)
leadRouter.post(
  "/:id/flags",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ flag: z.enum(LEAD_FLAGS), reason: z.string().optional(), provisional: z.boolean().optional() });
    const { flag, reason, provisional } = schema.parse(req.body);

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    await prisma.leadFlagEvent.create({
      data: {
        leadId: lead.id,
        flag,
        action: "ADDED",
        status: provisional && flag === "DNC" ? "PROVISIONAL" : "CONFIRMED",
        setByRecruiterId: req.user!.id,
        reason,
      },
    });
    const flags = Array.from(new Set([...lead.flags, flag]));
    const updated = await prisma.lead.update({ where: { id: lead.id }, data: { flags } });
    return res.status(201).json({ lead: updated });
  })
);

// DELETE /api/leads/:id/flags/:flag — remove a flag (audit-logged, not hard-deleted)
leadRouter.delete(
  "/:id/flags/:flag",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const flag = req.params.flag.toUpperCase();
    if (!LEAD_FLAGS.includes(flag as any)) throw new ApiError(400, "INVALID_FLAG", "Unknown flag type");

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    await prisma.leadFlagEvent.create({
      data: { leadId: lead.id, flag: flag as any, action: "REMOVED", setByRecruiterId: req.user!.id },
    });
    const flags = lead.flags.filter((f) => f !== flag);
    const updated = await prisma.lead.update({ where: { id: lead.id }, data: { flags } });
    return res.json({ lead: updated });
  })
);

// POST /api/leads/:id/activities — log a manual interview or call
leadRouter.post(
  "/:id/activities",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.discriminatedUnion("type", [
      z.object({ type: z.literal("INTERVIEW"), scheduledAt: z.string().datetime(), notes: z.string().optional() }),
      z.object({
        type: z.literal("CALL"),
        scheduledAt: z.string().datetime(),
        purpose: z.string().optional(),
        outcome: z.string().optional(),
      }),
    ]);
    const parsed = schema.parse(req.body);

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    const activity = await prisma.manualActivityLog.create({
      data: {
        type: parsed.type,
        scheduledAt: new Date(parsed.scheduledAt),
        leadId: lead.id,
        recruiterId: req.user!.id,
        notes: parsed.type === "INTERVIEW" ? parsed.notes : [parsed.purpose, parsed.outcome].filter(Boolean).join(" - "),
      },
    });
    return res.status(201).json({ activity });
  })
);

// POST /api/leads/batch-delete — batch delete leads & cascade cleanup
leadRouter.post(
  "/batch-delete",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const { leadIds } = z.object({ leadIds: z.array(z.string()) }).parse(req.body);
    if (!leadIds || leadIds.length === 0) {
      return res.json({ deletedCount: 0 });
    }

    await prisma.$transaction([
      prisma.emailQueueItem.deleteMany({ where: { leadId: { in: leadIds } } }),
      prisma.conversationMessage.deleteMany({ where: { conversation: { leadId: { in: leadIds } } } }),
      prisma.conversation.deleteMany({ where: { leadId: { in: leadIds } } }),
      prisma.leadFlagEvent.deleteMany({ where: { leadId: { in: leadIds } } }),
      prisma.interactionEvent.deleteMany({ where: { leadId: { in: leadIds } } }),
      prisma.lead.deleteMany({ where: { id: { in: leadIds } } }),
    ]);

    return res.json({ deletedCount: leadIds.length });
  })
);
