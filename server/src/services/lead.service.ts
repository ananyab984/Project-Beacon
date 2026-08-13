import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../lib/apiError";

/** Simple exact-match duplicate check (email / contact number / full name).
 *  Fuzzy/identity-resolution matching ("Danny M" rule) is a separate, async
 *  concern owned by the enrichment pipeline, not this endpoint. */
export async function findDuplicateLead(input: { email?: string; contactNumber?: string; fullName?: string }) {
  const email = input.email?.trim().toLowerCase();
  const contactNumber = input.contactNumber?.trim();
  const fullName = input.fullName?.trim();

  if (email) {
    const match = await prisma.lead.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (match) return { isDuplicate: true, matchedField: "email_address" as const, leadId: match.id };
  }
  if (contactNumber) {
    const match = await prisma.lead.findFirst({ where: { contactNumber } });
    if (match) return { isDuplicate: true, matchedField: "contact_number" as const, leadId: match.id };
  }
  if (fullName) {
    const match = await prisma.lead.findFirst({ where: { fullName: { equals: fullName, mode: "insensitive" } } });
    if (match) return { isDuplicate: true, matchedField: "full_name" as const, leadId: match.id };
  }
  return { isDuplicate: false, matchedField: null, leadId: null };
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
