import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../lib/apiError";

/**
 * Robust duplicate detection: checks Email, LinkedIn/Profile Link, Normalized Contact Number, and Full Name.
 */
export async function findDuplicateLead(input: {
  email?: string;
  contactNumber?: string;
  fullName?: string;
  profileLink?: string;
}) {
  const email = input.email?.trim().toLowerCase();
  const contactNumber = input.contactNumber?.trim();
  const fullName = input.fullName?.trim();
  const rawProfileLink = input.profileLink?.trim();

  // 1. Email check (exact case-insensitive)
  if (email && email.includes("@")) {
    const match = await prisma.lead.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, fullName: true, displayName: true, email: true },
    });
    if (match) {
      return {
        isDuplicate: true,
        matchedField: "email_address" as const,
        leadId: match.id,
        matchedName: match.displayName || match.fullName || "Existing Lead",
      };
    }
  }

  // 2. Profile Link / LinkedIn URL check (normalized without protocols/trailing slashes)
  if (rawProfileLink) {
    const normalizedLink = rawProfileLink
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();

    if (normalizedLink.length > 5) {
      const match = await prisma.lead.findFirst({
        where: {
          OR: [
            { profileLink: { equals: rawProfileLink, mode: "insensitive" } },
            { profileLink: { contains: normalizedLink, mode: "insensitive" } },
          ],
        },
        select: { id: true, fullName: true, displayName: true, profileLink: true },
      });
      if (match) {
        return {
          isDuplicate: true,
          matchedField: "profile_link" as const,
          leadId: match.id,
          matchedName: match.displayName || match.fullName || "Existing Lead",
        };
      }
    }
  }

  // 3. Contact Number check (normalized digits)
  if (contactNumber) {
    const digitsOnly = contactNumber.replace(/\D/g, "");
    if (digitsOnly.length >= 7) {
      const allLeadsWithContact = await prisma.lead.findMany({
        where: { contactNumber: { not: null } },
        select: { id: true, fullName: true, displayName: true, contactNumber: true },
      });
      const match = allLeadsWithContact.find((l) => {
        const leadDigits = (l.contactNumber || "").replace(/\D/g, "");
        return leadDigits.length >= 7 && (leadDigits.endsWith(digitsOnly) || digitsOnly.endsWith(leadDigits));
      });
      if (match) {
        return {
          isDuplicate: true,
          matchedField: "contact_number" as const,
          leadId: match.id,
          matchedName: match.displayName || match.fullName || "Existing Lead",
        };
      }
    }
  }

  // 4. Full Name / Display Name check (exact case-insensitive)
  if (fullName && fullName.length >= 3) {
    const match = await prisma.lead.findFirst({
      where: {
        OR: [
          { fullName: { equals: fullName, mode: "insensitive" } },
          { displayName: { equals: fullName, mode: "insensitive" } },
        ],
      },
      select: { id: true, fullName: true, displayName: true },
    });
    if (match) {
      return {
        isDuplicate: true,
        matchedField: "full_name" as const,
        leadId: match.id,
        matchedName: match.displayName || match.fullName || "Existing Lead",
      };
    }
  }

  return { isDuplicate: false, matchedField: null, leadId: null, matchedName: null };
}

/** Builds the merged, time-sorted activity timeline for a single lead. */
export async function getLeadTimeline(leadId: string) {
  const [stageHistory, flagEvents, interactionEvents, manualActivityLogs] = await Promise.all([
    prisma.stageHistory.findMany({ where: { leadId }, orderBy: { changedAt: "asc" } }),
    prisma.leadFlagEvent.findMany({ where: { leadId }, orderBy: { setAt: "asc" } }),
    prisma.interactionEvent.findMany({ where: { leadId }, orderBy: { occurredAt: "asc" } }),
    prisma.manualActivityLog.findMany({ where: { leadId }, orderBy: { scheduledAt: "asc" } }),
  ]);

  const events = [
    ...stageHistory.map((e) => ({ type: "STAGE_CHANGE" as const, at: e.changedAt, data: e })),
    ...flagEvents.map((e) => ({ type: "FLAG" as const, at: e.setAt, data: e })),
    ...interactionEvents.map((e) => ({ type: "INTERACTION" as const, at: e.occurredAt, data: e })),
    ...manualActivityLogs.map((e) => ({ type: "MANUAL_ACTIVITY" as const, at: e.scheduledAt, data: e })),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

/** Atomic claim: only succeeds if the lead is currently unclaimed. Guards the
 *  race between two recruiters claiming the same global-pool lead at once. */
export async function claimLead(leadId: string, recruiterId: string) {
  const result = await prisma.lead.updateMany({
    where: { id: leadId, claimedByRecruiterId: null },
    data: { claimedByRecruiterId: recruiterId, claimedAt: new Date(), assignedRecruiterId: recruiterId, assignedAt: new Date() },
  });
  if (result.count === 0) {
    const existing = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!existing) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    throw new ApiError(409, "ALREADY_CLAIMED", "This lead has already been claimed by another recruiter");
  }
  return prisma.lead.findUnique({ where: { id: leadId } });
}

export function buildLeadWhere(params: {
  q?: string;
  stage?: string;
  language?: string;
  country?: string;
  service?: string;
  recruiterId?: string;
  flag?: string;
  since?: Date;
}): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (params.q) {
    where.OR = [
      { fullName: { contains: params.q, mode: "insensitive" } },
      { displayName: { contains: params.q, mode: "insensitive" } },
      { maskedLabel: { contains: params.q, mode: "insensitive" } },
      { email: { contains: params.q, mode: "insensitive" } },
    ];
  }
  if (params.stage) where.stage = params.stage as any;
  if (params.language) where.OR = [...(where.OR ?? []), { sourceLanguage: params.language }, { targetLanguage: params.language }];
  if (params.country) where.country = params.country;
  if (params.service) where.services = { has: params.service };
  if (params.recruiterId) where.assignedRecruiterId = params.recruiterId;
  if (params.flag) where.flags = { has: params.flag as any };
  if (params.since) where.createdAt = { gte: params.since };
  return where;
}
