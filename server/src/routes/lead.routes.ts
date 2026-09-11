import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole, Role } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { fetchCsv } from "../lib/fetchCsv";
import { findDuplicateLead, getLeadTimeline, claimLead, buildLeadWhere } from "../services/lead.service";
import { candidateRoleOf } from "../lib/messageTemplates";
import { enrichLeadById } from "../jobs/enrichment.job";
import { normalizeServices } from "../lib/normalizeServices";
import { resolveManualFieldSources } from "../lib/manualFieldSources";
import { withEnrichedFieldCount } from "../lib/enrichmentCount";
import { attachReenrichmentStatus } from "../lib/reenrichmentStatus";
import { checkReenrichmentRateLimit } from "../lib/reenrichmentRateLimit";
import { applyConflictChoices, type FieldConflict } from "../lib/reenrichmentFieldMapping";
import { runAutumnReenrichment } from "../jobs/reenrichment.job";
import { config } from "../config";
import { convertGoogleSheetUrlToCsv, parseCsvRows } from "./sheet-sync.routes";

export const leadRouter = Router();

leadRouter.use(authenticateJwt);

const LEAD_SOURCES = ["LINKEDIN", "PROZ", "ADA", "ATA", "ATAA", "BODALGO", "FREELANCER", "APOLLO"] as const;
const LEAD_STAGES = ["NEW", "CONTACTED", "REPLIED", "NEGOTIATING", "INVITE_SENT", "ONBOARDED", "COLD"] as const;
const LEAD_FLAGS = ["DNC", "ON_HOLD", "WATCHING", "HIGH_PRIORITY"] as const;

/** Shared ownership check for every single-lead action route now open to
 * contractors (flags, activities, retry-enrichment, reenrich, ...) -- same
 * rule PATCH /:id already enforces. A contractor may act on a lead only if
 * they created it; everyone else (owner/recruiter) is unrestricted. Takes
 * plain values rather than the full Express Request so it's directly unit
 * testable without constructing a fake request object. */
export function assertContractorOwnsLead(
  requesterRole: string,
  requesterId: string,
  lead: { createdByContractorId: string | null }
) {
  if (requesterRole.toLowerCase() === "contractor" && lead.createdByContractorId !== requesterId) {
    throw new ApiError(403, "FORBIDDEN", "Contractors can only act on their own submitted leads");
  }
}

/** Resolves what assignedRecruiterId/assignedAt to store on a newly created
 * lead (single or bulk), given the creating role, their own id, and
 * whatever assignedRecruiterId the request body supplied.
 *
 * Security fix: a contractor's request body could carry an arbitrary
 * assignedRecruiterId with no role restriction of its own, letting them
 * stamp it onto their own new lead -- contractors don't have an "assign"
 * concept at all (they submit, routing is owner/recruiter's job), so it's
 * always ignored for that role regardless of what's sent. Recruiter
 * auto-assigns to themself when the body didn't specify one; owner may set
 * it explicitly or leave it unset. Exported so it's directly unit-testable
 * without constructing a fake request/response. */
export function resolveLeadAssignment(
  role: string,
  requesterId: string,
  requestedRecruiterId: string | undefined
): { assignedRecruiterId: string | undefined; assignedAt: Date | undefined } {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "contractor") {
    return { assignedRecruiterId: undefined, assignedAt: undefined };
  }
  const assignedRecruiterId = requestedRecruiterId ?? (normalizedRole === "recruiter" ? requesterId : undefined);
  const assignedAt = requestedRecruiterId || normalizedRole === "recruiter" ? new Date() : undefined;
  return { assignedRecruiterId, assignedAt };
}

/** How many of the given lead ids are NOT owned by this contractor --
 * PATCH /bulk and POST /batch-delete both use this to reject a batch that
 * reaches outside the contractor's own submissions.
 *
 * Security fix: the original check here was `createdByContractorId: { not:
 * requesterId } }` alone. SQL's three-valued logic means a row where that
 * column is NULL (any recruiter- or owner-sourced lead, which is most of
 * them) satisfies neither `= requesterId` NOR `<> requesterId` -- so it was
 * silently excluded from the "foreign" count instead of counting as
 * foreign, and a contractor could bulk-update or batch-delete ANY
 * recruiter/owner lead as long as it had never been contractor-sourced.
 * Confirmed live via a direct query: `{ not: X }` alone returned
 * foreignCount=0 for a lead with createdByContractorId=null. Explicitly
 * OR-ing in `createdByContractorId: null` closes that gap. */
async function countForeignLeadsForContractor(contractorId: string, leadIds: string[]): Promise<number> {
  return prisma.lead.count({
    where: {
      id: { in: leadIds },
      OR: [{ createdByContractorId: null }, { createdByContractorId: { not: contractorId } }],
    },
  });
}

/** Best-effort mapping of a free-text/legacy source string to the LeadSource
 * enum -- same fallback rule the client's per-dialog copies of this already
 * use (mapToLeadSource in add-lead-dialog.tsx etc.): default to LINKEDIN
 * when nothing recognizable is found. */
function mapToLeadSource(raw: string | undefined | null): (typeof LEAD_SOURCES)[number] {
  if (!raw) return "LINKEDIN";
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "");
  return LEAD_SOURCES.find((s) => s === upper || upper.includes(s)) ?? "LINKEDIN";
}

/** Same header-keyword matching as the client's parseCsvLeads
 * (client/src/lib/g3-mock.ts) -- kept in sync deliberately (see
 * normalizeServices.ts's comment) since this is a second, server-side entry
 * point (Google Sheet import) into the same "raw rows -> Lead fields"
 * mapping the client does for CSV/XLSX uploads. */
export function mapSheetRowsToLeads(rows: string[][]): z.infer<typeof createLeadSchema>[] {
  if (rows.length <= 1) return [];
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const findIdx = (keywords: string[]) => headers.findIndex((h) => keywords.some((k) => h.includes(k)));

  const nameIdx = findIdx(["fullname", "name", "candidate", "candidatename", "lead", "leadname"]);
  const emailIdx = findIdx(["email", "mail", "contactemail", "emailaddress", "emailid"]);
  const phoneIdx = findIdx(["contact", "contactnumber", "phone", "phonenumber", "mobile", "whatsapp", "tel", "cell"]);
  const profileIdx = findIdx(["profilelink", "linkedin", "linkedinurl", "link", "url", "profile", "social", "prozlink"]);
  const countryIdx = findIdx(["country", "location", "residence", "nation", "region", "city", "state"]);
  const langIdx = findIdx(["targetlanguage", "targetlang", "target_language", "language", "lang", "tolanguage"]);
  const sourceLangIdx = findIdx(["sourcelanguage", "srclang", "source_language", "fromlanguage"]);
  const serviceIdx = findIdx(["services", "service", "role", "specialization", "skills"]);
  const expIdx = findIdx(["yearsofexperience", "experience", "years", "exp", "yoexp", "yearsofexp"]);
  const vendorIdx = findIdx(["vendorexperience", "vendor", "clients", "history"]);
  const sourceIdx = findIdx(["source", "channel", "platform", "origin"]);

  const out: z.infer<typeof createLeadSchema>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const fullName = (nameIdx >= 0 && row[nameIdx] ? row[nameIdx] : "").trim();
    if (!fullName) continue; // fullName is required by createLeadSchema -- skip rows with no name rather than fail the whole import

    const rawServices = serviceIdx >= 0 && row[serviceIdx] ? row[serviceIdx] : "";
    const parsed = createLeadSchema.safeParse({
      fullName,
      source: mapToLeadSource(sourceIdx >= 0 ? row[sourceIdx] : undefined),
      services: rawServices ? normalizeServices(rawServices) : [],
      country: countryIdx >= 0 ? row[countryIdx] || undefined : undefined,
      profileLink: profileIdx >= 0 ? row[profileIdx] || undefined : undefined,
      sourceLanguage: (sourceLangIdx >= 0 ? row[sourceLangIdx] : "") || "English",
      targetLanguage: (langIdx >= 0 ? row[langIdx] : "") || "English",
      email: emailIdx >= 0 ? row[emailIdx] || undefined : undefined,
      contactNumber: phoneIdx >= 0 ? row[phoneIdx] || undefined : undefined,
      yearsOfExperience: expIdx >= 0 && !isNaN(Number(row[expIdx])) ? Number(row[expIdx]) : undefined,
      vendorExperience: vendorIdx >= 0 ? row[vendorIdx] || undefined : undefined,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

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
  // Applies to every path that uses this schema -- both single manual
  // create and bulk CSV/XLSX/Google Sheet import (POST /api/leads/bulk
  // parses each row through this same schema) -- so a raw value like
  // "Sub:Dubbing:Audio Description" from an import file gets normalized to
  // canonical services at the one place all lead creation funnels through.
  services: z.array(z.string()).default([]).transform((arr) => normalizeServices(arr)),
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
    return res.json({
      leads: await attachReenrichmentStatus(page.map(withEnrichedFieldCount)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
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
    return res.json({ leads: await attachReenrichmentStatus(leads.map(withEnrichedFieldCount)) });
  })
);

// GET /api/leads/export — CSV export honoring the current filter set.
// Contractors are scoped to their own submitted leads (createdByContractorId)
// -- unlike GET / (the Global Leads pool), this has no role branch of its
// own by default, so opening it to contractor without this scope would
// export every lead in the pool, not just theirs.
leadRouter.get(
  "/export",
  requireRole("owner", "recruiter", "contractor"),
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
    if (req.user!.role.toLowerCase() === "contractor") {
      where.createdByContractorId = req.user!.id;
    }
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
    const [withStatus] = await attachReenrichmentStatus([withEnrichedFieldCount(lead)]);
    return res.json({ lead: withStatus, timeline });
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
        ...resolveLeadAssignment(role, req.user!.id, parsed.assignedRecruiterId),
        dupFlagged: false,
        dupFlaggedField: undefined,
      },
    });

    // The Email Queue is opt-in: a recruiter puts a lead there themselves via
    // the queue page's own "Search Lead" -> add action (POST
    // /api/email-queue), which is the only place an EmailQueueItem should
    // ever be created. This used to also auto-create one for every lead on
    // creation, so every new/imported lead showed up in the queue with no
    // explicit action taken -- confirmed live: a recruiter who had only
    // added leads, never touched the queue, found several names already
    // sitting in it.
    if (role !== "contractor") {
      // Auto-create conversation thread only for an actual LinkedIn lead --
      // `parsed.profileLink` alone used to be enough, which is the same gap
      // fixed for the explicit "Search Lead" path in conversation.routes.ts's
      // POST / (a proz.com/bodalgo.com link was enough to trip this before).
      const isLinkedInLead =
        parsed.source === "LINKEDIN" && !!parsed.profileLink && /linkedin\.com/i.test(parsed.profileLink);
      if (isLinkedInLead) {
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

    return res.status(201).json({ lead: withEnrichedFieldCount(lead), duplicateWarning: dup.isDuplicate ? dup : null });
  })
);

type BulkRow = z.infer<typeof createLeadSchema>;
type BulkResult = { index: number; status: "accepted" | "duplicate" | "skipped" | "error"; leadId?: string; message?: string };

// Shared by POST /api/leads/bulk (CSV/XLSX upload, already-parsed rows in the
// request body) and POST /api/leads/import-from-sheet (rows parsed
// server-side from a fetched Google Sheet) -- same duplicate-checking,
// creation, and enrichment-trigger logic either way, so the two ingestion
// paths can't silently diverge in behavior.
async function createLeadsFromRows(rows: BulkRow[], userId: string, role: Role): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
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
            createdByContractorId: role === "contractor" ? userId : undefined,
            createdByRecruiterId: role !== "contractor" ? userId : undefined,
            isSelfSourced: role !== "contractor",
            ...resolveLeadAssignment(role, userId, row.assignedRecruiterId),
            dupFlagged: false,
            dupFlaggedField: undefined,
          },
        });

        // Auto-create a conversation thread only -- NOT an EmailQueueItem, see
        // the single-lead create above for why: the queue is opt-in via its
        // own "Search Lead" -> add action, not something a bulk import should
        // silently populate for the recruiter who ran it.
        if (role !== "contractor") {
          const isLinkedInLead =
            row.source === "LINKEDIN" && !!row.profileLink && /linkedin\.com/i.test(row.profileLink);
          if (isLinkedInLead) {
            await prisma.conversation.create({
              data: {
                leadId: lead.id,
                recruiterId: userId,
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
  return results;
}

// POST /api/leads/bulk — CSV/XLSX bulk upload; each row is duplicate-checked independently
leadRouter.post(
  "/bulk",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const rawRows = z.array(z.unknown()).max(2000).parse(req.body?.leads ?? []);
    const role = req.user!.role.toLowerCase() as Role;

    // Validate every row independently -- one malformed row (e.g. a garbled
    // email from a bad file parse) must not sink the whole batch. This used
    // to be a single z.array(createLeadSchema).parse() over all rows, so one
    // invalid row threw one aggregated ZodError and silently discarded every
    // valid row alongside it instead of importing what it could.
    const results: BulkResult[] = new Array(rawRows.length);
    const validRows: { originalIndex: number; row: BulkRow }[] = [];
    rawRows.forEach((raw, index) => {
      const parsed = createLeadSchema.safeParse(raw);
      if (parsed.success) {
        validRows.push({ originalIndex: index, row: parsed.data });
      } else {
        results[index] = {
          index,
          status: "error",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        };
      }
    });

    const createdResults = await createLeadsFromRows(validRows.map((v) => v.row), req.user!.id, role);
    createdResults.forEach((r, i) => {
      results[validRows[i].originalIndex] = { ...r, index: validRows[i].originalIndex };
    });

    return res.status(201).json({ results });
  })
);

// POST /api/leads/import-from-sheet — same ingestion as /bulk, but the rows
// come from fetching a public Google Sheet server-side (mirroring
// sheet-sync.routes.ts's Client Demand importer) instead of a client-parsed
// file, so Leads gets the same Google Sheets import path Client Demand
// already has.
leadRouter.post(
  "/import-from-sheet",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const { sheetUrl } = z.object({ sheetUrl: z.string().url() }).parse(req.body);

    const { csvUrl } = convertGoogleSheetUrlToCsv(sheetUrl);
    if (!csvUrl) throw new ApiError(400, "INVALID_SHEET_URL", "Could not convert Google Sheet URL to CSV export format.");

    let csvData: string;
    try {
      csvData = await fetchCsv(csvUrl);
    } catch (err: any) {
      throw new ApiError(400, "SHEET_FETCH_FAILED", err?.message || "Failed to fetch CSV from Google Sheet. Ensure the sheet is accessible.");
    }

    const sheetRows = parseCsvRows(csvData);
    const leadRows = mapSheetRowsToLeads(sheetRows);
    if (leadRows.length === 0) {
      return res.status(200).json({ results: [], message: "Sheet was fetched successfully, but no rows matched a Name/Email/Language/Service header." });
    }

    const role = req.user!.role.toLowerCase() as Role;
    const results = await createLeadsFromRows(leadRows, req.user!.id, role);
    return res.status(201).json({ results });
  })
);

/** Bulk-action guard for contractor role, shared by nothing else since
 * PATCH /bulk is the only route that operates on an arbitrary caller-chosen
 * id list. Two independent restrictions: (1) every id must be a lead the
 * contractor actually created -- otherwise they could stage-change/
 * reassign any lead in the system; (2) a contractor can never supply
 * `recruiterId` at all, even for leads they fully own -- contractors don't
 * have an "assign" concept, that's owner/recruiter's job. Exported so it's
 * directly unit-testable without constructing a fake request/response. */
export async function assertContractorBulkUpdateAllowed(
  requesterRole: string,
  requesterId: string,
  ids: string[],
  recruiterId: string | undefined
) {
  if (requesterRole.toLowerCase() !== "contractor") return;
  const foreignCount = await countForeignLeadsForContractor(requesterId, ids);
  if (foreignCount > 0) throw new ApiError(403, "FORBIDDEN", "Contractors can only bulk-update their own submitted leads");
  if (recruiterId) throw new ApiError(403, "FORBIDDEN", "Contractors cannot reassign leads to a recruiter");
}

// PATCH /api/leads/bulk — bulk stage/recruiter reassignment for the bulk-action bar.
// Unlike GET / and GET /export, this has no per-row ownership scoping of its
// own -- it applies to whatever ids are passed. A contractor calling this
// must be restricted to ids they actually created, or they could
// stage-change/reassign any lead in the system.
leadRouter.patch(
  "/bulk",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(500),
      stage: z.enum(LEAD_STAGES).optional(),
      recruiterId: z.string().uuid().optional(),
    });
    const { ids, stage, recruiterId } = schema.parse(req.body);
    if (!stage && !recruiterId) throw new ApiError(400, "NO_OP", "Provide stage or recruiterId to apply");

    await assertContractorBulkUpdateAllowed(req.user!.role, req.user!.id, ids, recruiterId);

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

    // Nullable: an explicitly-sent `null` means "clear this field," an
    // omitted key means "don't touch it" -- distinct signals a plain
    // `.optional()` string can't carry, since JSON.stringify drops
    // `undefined` keys entirely (a client sending `value || undefined` for a
    // cleared field silently never reaches here at all, which was the actual
    // "can't clear a manually-entered field" bug).
    const schema = z.object({
      displayName: z.string().max(160).nullable().optional(),
      identityResolved: z.boolean().optional(),
      enrichmentStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "FLAGGED_REVIEW"]).optional(),
      flags: z.array(z.enum(LEAD_FLAGS)).optional(),
      services: z.array(z.string()).optional(),
      sourceLanguage: z.string().nullable().optional(),
      targetLanguage: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      profileLink: z.string().nullable().optional(),
      email: z.string().trim().transform((val) => (val === "" ? null : val)).nullable().refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), { message: "Invalid email" }).optional(),
      contactNumber: z.string().nullable().optional(),
      yearsOfExperience: z.number().nullable().optional(),
      vendorExperience: z.string().nullable().optional(),
      headline: z.string().nullable().optional(),
      currentTitle: z.string().nullable().optional(),
      aboutSnippet: z.string().nullable().optional(),
      toolsSoftware: z.array(z.string()).optional(),
      certifications: z.array(z.string()).optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      stage: z.enum(LEAD_STAGES).optional(),
      closureReason: z.string().optional(),
      replyCategoryId: z.string().uuid().nullable().optional(),
    });
    const patch = schema.parse(req.body);

    // A caller sending `replyCategoryId` (even explicitly `null`) is
    // performing a manual override -- distinct from the auto-classifier's
    // own writes (see processInboundMessage.ts), which always use source
    // "AUTO". Setting these two alongside `replyCategoryId` here means they
    // ride along in the single `prisma.lead.update` call below.
    if ("replyCategoryId" in patch) {
      // Single kill switch for the whole feature (see config.ts) -- when
      // off, the manual-override write path rejects too, not just the
      // automated classifier, so a client bypassing the (already-hidden)
      // UI dropdown can't still set a classification behind the flag's back.
      if (!config.replyClassificationEnabled) {
        throw new ApiError(403, "FEATURE_DISABLED", "Reply classification is currently disabled");
      }
      // Zod only proves the id is a well-formed UUID, not that the category
      // still exists -- a recruiter holding a stale dropdown can send the id
      // of a category the owner just deleted. Without this check that reaches
      // prisma.lead.update and surfaces as an unmapped P2003 foreign-key
      // violation, i.e. a raw 500. Same existence-check-before-mutation
      // convention as replyCategories.routes.ts. `null` clears the lead to
      // Unclassified and references no category row, so it needs no check.
      if (patch.replyCategoryId) {
        const category = await prisma.replyCategory.findUnique({ where: { id: patch.replyCategoryId } });
        if (!category) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");
      }
      (patch as any).replyClassificationSource = "MANUAL";
      (patch as any).replyClassifiedAt = new Date();
    }

    (patch as any).fieldSources = resolveManualFieldSources(existing as any, req.body, patch as any);

    // A caller sending `flags` intends to ADD to the lead's flags (e.g.
    // stacking WATCHING onto a lead already flagged DNC), not replace the
    // whole array -- merge with the existing flags instead of overwriting
    // them. Previously this only fell back to existing.flags when patch.flags
    // was entirely absent, so any provided flags array silently clobbered
    // (dropped) whatever flags -- including DNC -- were already set.
    if (patch.flags) {
      patch.flags = Array.from(new Set([...existing.flags, ...patch.flags]));
    }

    const hasContact = !!(patch.email || patch.contactNumber || patch.profileLink || existing.email || existing.contactNumber || existing.profileLink);
    const shouldStayComplete =
      existing.enrichmentStatus === "COMPLETE" || patch.identityResolved === true || patch.enrichmentStatus === "COMPLETE" || hasContact;

    if (shouldStayComplete) {
      patch.identityResolved = true;
      patch.enrichmentStatus = "COMPLETE";
      // NOTE: this used to also strip ON_HOLD here -- removed. On Hold is now
      // driven only by the waterfall's own conclusion state or the
      // recruiter's explicit toggle (POST/DELETE /:id/flags); a manual field
      // edit that happens to include contact info must not silently clear it
      // as a side effect (this was itself an instance of the exact bug this
      // rework closes).
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

    // The lead update and the override's ReplyClassificationEvent must land
    // together (design spec Component 6): the event table is the history of
    // record for the lead's denormalized replyCategoryId /
    // replyClassificationSource, so a half-applied pair would drift them.
    // Scope is deliberately just this pair -- nothing else in this handler.
    const updated = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: existing.id },
        data: { ...patch, lastActivityAt: new Date() },
      });

      if ("replyCategoryId" in patch) {
        await tx.replyClassificationEvent.create({
          data: {
            leadId: existing.id,
            categoryId: patch.replyCategoryId ?? null,
            confidence: null,
            source: "MANUAL",
            changedByUserId: req.user!.id,
          },
        });
      }

      return lead;
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

    // Keep each queued item's DISPLAY metadata in sync with the lead record --
    // and nothing else.
    //
    // This block used to also overwrite `subject` and `body` with a
    // hardcoded generic template, on every PATCH that touched any of the
    // fields below. Three things were wrong with that:
    //
    //  - It bypassed the drafting pipeline entirely. The template it wrote is
    //    the same boilerplate every lead got before drafting was
    //    personalized, so a queue item silently reverted to unpersonalized
    //    text whenever its lead was edited or re-enriched.
    //  - It destroyed real work without asking. A recruiter's hand-typed
    //    draft and an AI-generated one were both overwritten in place, with
    //    no confirmation and no way back.
    //  - It left a body present, so the compose pane's "Generate Draft"
    //    button -- which only shows for an empty body -- never appeared. That
    //    is the reported symptom: add a lead to the queue and find it already
    //    holding a mail nobody drafted.
    //
    // A draft is now only ever written by an explicit "Generate Draft"
    // (POST /api/email-queue/:id/generate-draft) or by the recruiter typing.
    if (patch.identityResolved || patch.email || patch.yearsOfExperience || patch.vendorExperience || patch.targetLanguage || patch.services || patch.sourceLanguage || patch.country) {
      const candidateName = patch.displayName || updated.displayName || updated.fullName || undefined;
      const candidateRole = candidateRoleOf(
        patch.services ?? updated.services,
        patch.targetLanguage ?? updated.targetLanguage
      );
      await prisma.emailQueueItem.updateMany({
        where: { leadId: existing.id },
        data: { candidateRole, ...(candidateName ? { candidateName } : {}) },
      }).catch(() => null);
    }

    return res.json({ lead: withEnrichedFieldCount(updated) });
  })
);

// POST /api/leads/:id/claim — atomic claim from the Global Leads pool
leadRouter.post(
  "/:id/claim",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await claimLead(req.params.id, req.user!.id);
    return res.json({ lead: lead ? withEnrichedFieldCount(lead) : null });
  })
);

// POST /api/leads/:id/flags — add a flag (DNC/ON_HOLD/WATCHING/HIGH_PRIORITY)
leadRouter.post(
  "/:id/flags",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ flag: z.enum(LEAD_FLAGS), reason: z.string().optional(), provisional: z.boolean().optional() });
    const { flag, reason, provisional } = schema.parse(req.body);

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

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
    // A recruiter adding ON_HOLD through this endpoint is, by definition, the
    // manual case -- system-driven ON_HOLD (waterfall timeout/crash) is set
    // directly by enrichLeadById/stallOverdueEnrichments, never through here.
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { flags, ...(flag === "ON_HOLD" ? { onHoldReason: "MANUAL" as const } : {}) },
    });
    return res.status(201).json({ lead: withEnrichedFieldCount(updated) });
  })
);

// DELETE /api/leads/:id/flags/:flag — remove a flag (audit-logged, not hard-deleted)
leadRouter.delete(
  "/:id/flags/:flag",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const flag = req.params.flag.toUpperCase();
    if (!LEAD_FLAGS.includes(flag as any)) throw new ApiError(400, "INVALID_FLAG", "Unknown flag type");

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

    await prisma.leadFlagEvent.create({
      data: { leadId: lead.id, flag: flag as any, action: "REMOVED", setByRecruiterId: req.user!.id },
    });
    const flags = lead.flags.filter((f) => f !== flag);
    // Clearing ON_HOLD always clears its reason too, regardless of what that
    // reason was -- "coming off On Hold is its own explicit action," and
    // this endpoint is exactly that action for any of the three reasons.
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { flags, ...(flag === "ON_HOLD" ? { onHoldReason: null } : {}) },
    });
    return res.json({ lead: withEnrichedFieldCount(updated) });
  })
);

// POST /api/leads/:id/activities — log a manual interview or call
leadRouter.post(
  "/:id/activities",
  requireRole("owner", "recruiter", "contractor"),
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
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

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

// POST /api/leads/:id/retry-enrichment — human-triggered retry for a lead On
// Hold because the waterfall didn't conclude (STALLED/TIMEOUT/SYSTEM_ERROR;
// never shown in the UI for MANUAL, whose only exit is the flags toggle).
// Hands it back to the normal PENDING queue, which pollPendingEnrichment
// picks up on its next pass. Deliberately does not call enrichLeadById
// directly here -- routing every retry through the same poll path a fresh
// lead takes means there's exactly one code path that can ever set
// IN_PROGRESS, not two.
leadRouter.post(
  "/:id/retry-enrichment",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

    if (lead.enrichmentStatus === "IN_PROGRESS") {
      throw new ApiError(409, "ALREADY_RUNNING", "This lead's enrichment is still actively running");
    }

    // Must also clear ON_HOLD/onHoldReason, not just flip enrichmentStatus
    // back to PENDING -- pollPendingEnrichment now excludes any ON_HOLD lead
    // from its query regardless of enrichmentStatus (Part 4), so setting
    // PENDING alone would silently leave this lead un-retried forever.
    const flags = lead.flags.filter((f) => f !== "ON_HOLD");
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { enrichmentStatus: "PENDING", flags, onHoldReason: null },
    });
    return res.json({ lead: withEnrichedFieldCount(updated) });
  })
);

// POST /api/leads/:id/reenrich — recruiter-triggered re-enrichment via
// Autumn.ai. Distinct from /retry-enrichment above in both trigger and
// destination: that one hands a stuck lead back to the normal waterfall
// queue, this one dispatches an Autumn agent task for any lead, whenever the
// recruiter asks. Returns as soon as the run is recorded -- an Autumn task
// takes minutes, so the work happens in the background and the recruiter
// reads progress off the run row (GET /:id/reenrichment-status below).
leadRouter.post(
  "/:id/reenrich",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

    // The in-flight lock. The button is disabled client-side while a run is
    // active, but that alone can't stop a second tab, a stale page, or a
    // double-submit -- and every duplicate run costs real Autumn credits.
    const active = await prisma.reenrichmentRun.findFirst({
      where: { leadId: lead.id, status: "RUNNING" },
    });
    if (active) {
      throw new ApiError(409, "ALREADY_RUNNING", "A re-enrichment run is already in progress for this lead");
    }

    const cooldownStart = new Date(Date.now() - 24 * 3600_000);
    const recent = await prisma.reenrichmentRun.findMany({
      where: { leadId: lead.id, startedAt: { gte: cooldownStart } },
      select: { startedAt: true },
    });
    const limit = checkReenrichmentRateLimit(
      recent.map((r) => r.startedAt),
      new Date(),
      {
        cooldownMinutes: config.autumnReenrichCooldownMinutes,
        dailyCap: config.autumnReenrichDailyCap,
      }
    );
    if (!limit.allowed) {
      throw new ApiError(429, limit.reason!, limit.message!);
    }

    const run = await prisma.reenrichmentRun.create({
      data: { leadId: lead.id, requestedById: req.user!.id },
    });

    setImmediate(() => {
      runAutumnReenrichment(run.id).catch((err) =>
        console.error(`[reenrichment] unhandled failure for run ${run.id}:`, err?.message || err)
      );
    });

    return res.status(202).json({ run: { id: run.id, status: run.status, startedAt: run.startedAt } });
  })
);

// GET /api/leads/:id/reenrichment-status — latest run for one lead, polled by
// the re-enrichment modal while it's open.
leadRouter.get(
  "/:id/reenrichment-status",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

    const run = await prisma.reenrichmentRun.findFirst({
      where: { leadId: req.params.id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        creditsUsed: true,
        fieldsWritten: true,
        message: true,
        conflicts: true,
        resolvedAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    return res.json({ run });
  })
);

// POST /api/leads/:id/reenrichment-resolve — the recruiter's decision on the
// fields where Autumn disagreed with what the lead already had. Only the
// fields named in `acceptFields` are taken from Autumn; everything else keeps
// its current value. Nothing here can overwrite a manual entry -- that's
// re-checked against the lead's live fieldSources, not the stale run.
leadRouter.post(
  "/:id/reenrichment-resolve",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const { runId, acceptFields } = z
      .object({ runId: z.string(), acceptFields: z.array(z.string()) })
      .parse(req.body);

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    assertContractorOwnsLead(req.user!.role, req.user!.id, lead);

    const run = await prisma.reenrichmentRun.findFirst({ where: { id: runId, leadId: lead.id } });
    if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "Re-enrichment run not found for this lead");
    if (run.resolvedAt) throw new ApiError(409, "ALREADY_RESOLVED", "These changes have already been applied");

    const conflicts = (run.conflicts as unknown as FieldConflict[] | null) ?? [];
    const { updates, fieldSources, writtenFields } = applyConflictChoices(
      conflicts,
      acceptFields,
      lead.fieldSources as Record<string, string> | null
    );

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { ...updates, fieldSources: fieldSources as any },
    });
    await prisma.reenrichmentRun.update({
      where: { id: run.id },
      data: {
        resolvedAt: new Date(),
        conflicts: undefined,
        fieldsWritten: (run.fieldsWritten ?? 0) + writtenFields.length,
      },
    });

    const [withStatus] = await attachReenrichmentStatus([withEnrichedFieldCount(updated)]);
    return res.json({ lead: withStatus, appliedFields: writtenFields });
  })
);

// POST /api/leads/batch-delete — batch delete leads & cascade cleanup.
// Same no-ownership-check-by-default caveat as PATCH /bulk above -- a
// contractor here must be restricted to leads they actually created.
leadRouter.post(
  "/batch-delete",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const { leadIds } = z.object({ leadIds: z.array(z.string()) }).parse(req.body);
    if (!leadIds || leadIds.length === 0) {
      return res.json({ deletedCount: 0 });
    }

    if (req.user!.role.toLowerCase() === "contractor") {
      const foreignCount = await countForeignLeadsForContractor(req.user!.id, leadIds);
      if (foreignCount > 0) throw new ApiError(403, "FORBIDDEN", "Contractors can only delete their own submitted leads");
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
