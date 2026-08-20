import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole, Role } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { findDuplicateLead, getLeadTimeline, claimLead, buildLeadWhere } from "../services/lead.service";
import { buildEmailDraft, candidateRoleOf } from "../lib/messageTemplates";
import { enrichLeadById } from "../jobs/enrichment.job";

export const leadRouter = Router();

leadRouter.use(authenticateJwt);

const LEAD_SOURCES = ["LINKEDIN", "PROZ", "ADA", "ATA", "ATAA", "BODALGO", "FREELANCER", "APOLLO"] as const;
const LEAD_STAGES = ["NEW", "CONTACTED", "REPLIED", "NEGOTIATING", "INVITE_SENT", "ONBOARDED", "COLD"] as const;
const LEAD_FLAGS = ["DNC", "ON_HOLD", "WATCHING", "HIGH_PRIORITY"] as const;

const createLeadSchema = z.object({
  firstName: z.string().max(80).optional(),
  fullName: z.string().min(1).max(160),
  email: z.string().trim().transform((val) => (val === "" ? undefined : val)).refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), { message: "Invalid email" }).optional(),
  contactNumber: z.string().trim().transform((val) => (val === "" ? undefined : val)).optional(),
  profileLink: z.string().trim().transform((val) => {
    if (!val) return undefined;
    return /^https?:\/\//i.test(val) ? val : `https://${val}`;
  }).optional(),
  country: z.string().trim().transform((val) => (val === "" ? undefined : val)).optional(),
  source: z.enum(LEAD_SOURCES),
  services: z.array(z.string()).default([]),
  sourceLanguage: z.string().trim().transform((val) => (val === "" ? undefined : val)).optional(),
  targetLanguage: z.string().trim().transform((val) => (val === "" ? undefined : val)).optional(),
  secondaryLanguages: z.array(z.string()).default([]),
  yearsOfExperience: z.number().min(0).max(99).optional(),
  vendorExperience: z.string().trim().transform((val) => (val === "" ? undefined : val)).optional(),
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

    // Contractors are walled off: they only see their own submitted leads.
    if (role === "contractor") {
      where.createdByContractorId = req.user!.id;
    } else if (role === "recruiter") {
      // Recruiters see the global (identity-resolved, complete) pool + their own assigned/created leads.
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

// GET /api/leads/mine — contractor's own submissions, or recruiter's assigned+claimed+created leads
leadRouter.get(
  "/mine",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase() as Role;
    const userId = req.user!.id;

    const where =
      role === "contractor"
        ? { createdByContractorId: userId }
        : {
            OR: [
              { assignedRecruiterId: userId },
              { claimedByRecruiterId: userId },
              { createdByRecruiterId: userId },
            ],
          };

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

// POST /api/leads/check-bulk-duplicates — pre-validate uploaded CSV/Excel file for duplicate leads
leadRouter.post(
  "/check-bulk-duplicates",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const leads = (req.body?.leads || []) as Array<{
      fullName?: string;
      email?: string;
      contactNumber?: string;
      profileLink?: string;
    }>;
    const duplicates: Array<{
      index: number;
      fullName: string;
      email?: string;
      matchedField: string;
      existingLeadId: string;
      existingLeadName?: string;
    }> = [];
    const duplicateNamesSet = new Set<string>();

    const seenInBatch = new Set<string>();

    for (let i = 0; i < leads.length; i++) {
      const item = leads[i];
      if (!item.fullName && !item.email && !item.contactNumber && !item.profileLink) continue;

      // Intra-batch duplicate check
      const emailKey = item.email ? `email:${item.email.toLowerCase().trim()}` : null;
      const profileKey = item.profileLink
        ? `link:${item.profileLink.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase()}`
        : null;
      const phoneKey = item.contactNumber ? `phone:${item.contactNumber.replace(/\D/g, "")}` : null;
      const nameKey = item.fullName ? `name:${item.fullName.toLowerCase().trim()}` : null;

      const isIntraDup =
        (emailKey && seenInBatch.has(emailKey)) ||
        (profileKey && seenInBatch.has(profileKey)) ||
        (phoneKey && phoneKey.length >= 7 && seenInBatch.has(phoneKey));

      if (emailKey) seenInBatch.add(emailKey);
      if (profileKey) seenInBatch.add(profileKey);
      if (phoneKey && phoneKey.length >= 7) seenInBatch.add(phoneKey);
      if (nameKey) seenInBatch.add(nameKey);

      if (isIntraDup) {
        const leadName = item.fullName || `Row #${i + 1}`;
        duplicateNamesSet.add(leadName);
        duplicates.push({
          index: i,
          fullName: leadName,
          email: item.email,
          matchedField: "csv_duplicate",
          existingLeadId: "intra_batch",
          existingLeadName: leadName,
        });
        continue;
      }

      const dup = await findDuplicateLead({
        email: item.email,
        contactNumber: item.contactNumber,
        fullName: item.fullName,
        profileLink: item.profileLink,
      });

      if (dup.isDuplicate && dup.leadId) {
        const existing = await prisma.lead.findUnique({
          where: { id: dup.leadId },
          select: { fullName: true, displayName: true },
        });
        const leadName = item.fullName || existing?.displayName || existing?.fullName || `Row #${i + 1}`;
        duplicateNamesSet.add(leadName);
        duplicates.push({
          index: i,
          fullName: leadName,
          email: item.email,
          matchedField: dup.matchedField ?? "full_name",
          existingLeadId: dup.leadId,
          existingLeadName: existing?.displayName || existing?.fullName || undefined,
        });
      }
    }

    const duplicateNames = Array.from(duplicateNamesSet);
    const duplicateCount = duplicates.length;
    const totalCount = leads.length;
    const newCount = Math.max(0, totalCount - duplicateCount);

    return res.json({
      hasDuplicates: duplicateCount > 0,
      duplicateCount,
      duplicateNames,
      duplicates,
      totalCount,
      newCount,
    });
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

    const dup = await findDuplicateLead({
      email: parsed.email,
      contactNumber: parsed.contactNumber,
      fullName: parsed.fullName,
      profileLink: parsed.profileLink,
    });

    if (dup.isDuplicate) {
      throw new ApiError(409, "DUPLICATE_LEAD", `Duplicate lead detected: already exists via ${dup.matchedField?.replace("_", " ") || "record"} (${dup.matchedName})`);
    }

    const hasContact = !!(parsed.email || parsed.contactNumber || parsed.profileLink);

    const lead = await prisma.lead.create({
      data: {
        ...parsed,
        maskedLabel: `Lead #${Date.now().toString(36).toUpperCase()}`,
        identityResolved: false,
        emailVerified: !!parsed.email,
        enrichmentStatus: hasContact ? "IN_PROGRESS" : "PENDING",
        flags: hasContact ? [] : ["ON_HOLD"],
        createdByContractorId: role === "contractor" ? req.user!.id : undefined,
        createdByRecruiterId: role !== "contractor" ? req.user!.id : undefined,
        isSelfSourced: role !== "contractor",
        assignedRecruiterId: parsed.assignedRecruiterId ?? (role === "recruiter" ? req.user!.id : undefined),
        assignedAt: parsed.assignedRecruiterId || role === "recruiter" ? new Date() : undefined,
        dupFlagged: false,
        dupFlaggedField: undefined,
      },
    });

    // 1. Auto-add to email queue if created by recruiter/owner, using the
    // approved template filled ONLY with this lead's real fields
    if (role !== "contractor") {
      const { subject, body } = buildEmailDraft(lead);
      await prisma.emailQueueItem.create({
        data: {
          leadId: lead.id,
          recruiterId: req.user!.id,
          candidateName: lead.fullName || "Candidate",
          candidateRole: candidateRoleOf(parsed.services, parsed.targetLanguage),
          status: "REVIEW_NEEDED",
          subject,
          body,
          aiGenerated: false,
        },
      }).catch((err) => console.error("Failed to auto-create email queue item:", err));

      // Auto-create conversation thread if LinkedIn profile exists
      if (parsed.profileLink || parsed.source === "LINKEDIN") {
        await prisma.conversation.create({
          data: {
            leadId: lead.id,
            recruiterId: req.user!.id,
            candidateName: lead.fullName || "Candidate",
            candidateRole: candidateRoleOf(parsed.services, parsed.targetLanguage),
            channel: "LINKEDIN",
          },
        }).catch(() => {});
      }
    }

    // 2. Trigger background enrichment pipeline immediately
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
    const skipDuplicates = req.body?.skipDuplicates === true;
    const role = req.user!.role.toLowerCase() as Role;
    const results: Array<{ index: number; status: "accepted" | "duplicate" | "skipped" | "error"; leadId?: string; message?: string }> = [];
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // 1. Intra-batch duplicate check
        const emailKey = row.email ? `email:${row.email.toLowerCase().trim()}` : null;
        const profileKey = row.profileLink
          ? `link:${row.profileLink.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase()}`
          : null;
        const phoneKey = row.contactNumber ? `phone:${row.contactNumber.replace(/\D/g, "")}` : null;
        const nameKey = row.fullName ? `name:${row.fullName.toLowerCase().trim()}` : null;

        const isIntraDup =
          (emailKey && seenInBatch.has(emailKey)) ||
          (profileKey && seenInBatch.has(profileKey)) ||
          (phoneKey && phoneKey.length >= 7 && seenInBatch.has(phoneKey));

        if (emailKey) seenInBatch.add(emailKey);
        if (profileKey) seenInBatch.add(profileKey);
        if (phoneKey && phoneKey.length >= 7) seenInBatch.add(phoneKey);
        if (nameKey) seenInBatch.add(nameKey);

        if (isIntraDup) {
          results.push({ index: i, status: "duplicate", message: "Duplicate record within uploaded file" });
          continue;
        }

        // 2. Database duplicate check
        const dup = await findDuplicateLead({
          email: row.email,
          contactNumber: row.contactNumber,
          fullName: row.fullName,
          profileLink: row.profileLink,
        });

        if (dup.isDuplicate) {
          results.push({
            index: i,
            status: "duplicate",
            message: `Duplicate lead matching ${dup.matchedField} (${dup.matchedName})`,
          });
          continue; // Strictly omit duplicate leads from database insertion
        }

        const hasContact = !!(row.email || row.contactNumber || row.profileLink);

        const lead = await prisma.lead.create({
          data: {
            ...row,
            maskedLabel: `Lead #${Date.now().toString(36).toUpperCase()}${i}`,
            identityResolved: false,
            emailVerified: !!row.email,
            enrichmentStatus: hasContact ? "IN_PROGRESS" : "PENDING",
            flags: hasContact ? [] : ["ON_HOLD"],
            createdByContractorId: role === "contractor" ? req.user!.id : undefined,
            createdByRecruiterId: role !== "contractor" ? req.user!.id : undefined,
            isSelfSourced: role !== "contractor",
            assignedRecruiterId: row.assignedRecruiterId ?? (role === "recruiter" ? req.user!.id : undefined),
            assignedAt: row.assignedRecruiterId || role === "recruiter" ? new Date() : undefined,
            dupFlagged: false,
            dupFlaggedField: undefined,
          },
        });

        // Auto-create email queue and conversation items
        if (role !== "contractor") {
          const { subject, body } = buildEmailDraft(lead);
          await prisma.emailQueueItem.create({
            data: {
              leadId: lead.id,
              recruiterId: req.user!.id,
              candidateName: lead.fullName || "Candidate",
              candidateRole: candidateRoleOf(row.services, row.targetLanguage),
              status: "REVIEW_NEEDED",
              subject,
              body,
              aiGenerated: false,
            },
          }).catch(() => {});

          if (row.profileLink || row.source === "LINKEDIN") {
            await prisma.conversation.create({
              data: {
                leadId: lead.id,
                recruiterId: req.user!.id,
                candidateName: lead.fullName || "Candidate",
                candidateRole: candidateRoleOf(row.services, row.targetLanguage),
                channel: "LINKEDIN",
              },
            }).catch(() => {});
          }
        }

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
      country: z.string().optional(),
      profileLink: z.string().optional(),
      email: z.string().trim().transform((val) => (val === "" ? undefined : val)).refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), { message: "Invalid email" }).optional(),
      contactNumber: z.string().optional(),
      yearsOfExperience: z.number().optional(),
      vendorExperience: z.string().optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      stage: z.enum(LEAD_STAGES).optional(),
      closureReason: z.string().optional(),
    });
    const patch = schema.parse(req.body);

    const hasContact = !!(patch.email || patch.contactNumber || patch.profileLink || existing.email || existing.contactNumber || existing.profileLink);
    const shouldStayComplete =
      existing.enrichmentStatus === "COMPLETE" || patch.identityResolved === true || patch.enrichmentStatus === "COMPLETE" || hasContact;
    if (shouldStayComplete) {
      patch.identityResolved = true;
      patch.enrichmentStatus = "COMPLETE";
      const nextFlags = Array.from(new Set([...(patch.flags ?? existing.flags)].filter((f) => f !== "ON_HOLD")));
      patch.flags = nextFlags;
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

    // Automatically sync updated candidate name and details to email queue and conversation threads
    if (updated.email || updated.displayName || updated.fullName) {
      await prisma.emailQueueItem.updateMany({
        where: { leadId: updated.id },
        data: {
          candidateName: updated.displayName || updated.fullName || "Candidate",
        },
      }).catch(() => {});
    }
    if (updated.profileLink || updated.displayName || updated.fullName) {
      await prisma.conversation.updateMany({
        where: { leadId: updated.id },
        data: {
          candidateName: updated.displayName || updated.fullName || "Candidate",
        },
      }).catch(() => {});
    }

    // Automated Demand / Requirement headcount synchronization on stage change
    if (patch.stage && patch.stage !== existing.stage) {
      const language = updated.targetLanguage || updated.sourceLanguage;
      if (language) {
        if (patch.stage === "ONBOARDED") {
          const matchingReq = await prisma.requirement.findFirst({
            where: {
              language: { contains: language, mode: "insensitive" },
              status: { in: ["ACTIVE", "UNASSIGNED"] },
              gap: { gt: 0 },
            },
            orderBy: { priority: "desc" },
          });

          if (matchingReq) {
            const newFilled = matchingReq.filled + 1;
            const newGap = Math.max(0, matchingReq.headcountNeeded - newFilled);
            await prisma.requirement.update({
              where: { id: matchingReq.id },
              data: {
                filled: newFilled,
                gap: newGap,
                status: newGap === 0 ? "FULFILLED" : matchingReq.status,
              },
            });

            const matchingDemand = await prisma.clientDemand.findFirst({
              where: {
                clientId: matchingReq.clientId,
                language: { contains: language, mode: "insensitive" },
                gap: { gt: 0 },
              },
            });
            if (matchingDemand) {
              const dFilled = matchingDemand.filled + 1;
              const dGap = Math.max(0, matchingDemand.headcountNeeded - dFilled);
              await prisma.clientDemand.update({
                where: { id: matchingDemand.id },
                data: { filled: dFilled, gap: dGap },
              });
            }
          }
        } else if (existing.stage === "ONBOARDED") {
          const matchingReq = await prisma.requirement.findFirst({
            where: {
              language: { contains: language, mode: "insensitive" },
              filled: { gt: 0 },
            },
            orderBy: { createdAt: "desc" },
          });

          if (matchingReq) {
            const newFilled = Math.max(0, matchingReq.filled - 1);
            const newGap = Math.max(0, matchingReq.headcountNeeded - newFilled);
            await prisma.requirement.update({
              where: { id: matchingReq.id },
              data: {
                filled: newFilled,
                gap: newGap,
                status: matchingReq.status === "FULFILLED" ? "ACTIVE" : matchingReq.status,
              },
            });

            const matchingDemand = await prisma.clientDemand.findFirst({
              where: {
                clientId: matchingReq.clientId,
                language: { contains: language, mode: "insensitive" },
                filled: { gt: 0 },
              },
            });
            if (matchingDemand) {
              const dFilled = Math.max(0, matchingDemand.filled - 1);
              const dGap = Math.max(0, matchingDemand.headcountNeeded - dFilled);
              await prisma.clientDemand.update({
                where: { id: matchingDemand.id },
                data: { filled: dFilled, gap: dGap },
              });
            }
          }
        }
      }
    }

    // Auto-update Email Queue items for this lead with corrected email & enriched portfolio details
    if (patch.identityResolved || patch.email || patch.yearsOfExperience || patch.vendorExperience || patch.targetLanguage || patch.services || patch.sourceLanguage || patch.country) {
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
