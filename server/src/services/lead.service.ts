import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../lib/apiError";

/** A profile URL without protocol, `www.` or trailing slashes, lowercased --
 *  the form both duplicate checks below compare on. */
export function normalizeProfileLink(link: string): string {
  return link.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
}

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
      where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
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
    const normalizedLink = normalizeProfileLink(rawProfileLink);

    if (normalizedLink.length > 5) {
      const match = await prisma.lead.findFirst({
        where: {
          deletedAt: null,
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
        where: { contactNumber: { not: null }, deletedAt: null },
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
        deletedAt: null,
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

/** Coarse blocking shortlist for the Python fuzzy/LLM dedup waterfall
 *  (enrichment_pipeline/core/dedup.py's own blocking/narrowing/LLM stages
 *  do the real precision work) -- not a duplicate verdict itself, just a
 *  cheap enough-to-run-on-every-enrichment first pass: matching first-name
 *  prefix OR matching email domain, capped at 30 rows. `excludeLeadId` keeps
 *  a lead from being compared against itself. */
export async function findDedupCandidatePool(input: {
  excludeLeadId: string;
  firstName?: string | null;
  email?: string | null;
}) {
  const firstNamePrefix = input.firstName?.trim().slice(0, 4);
  const emailDomain = input.email?.includes("@") ? input.email.split("@")[1] : undefined;

  if (!firstNamePrefix && !emailDomain) return [];

  const or: Prisma.LeadWhereInput[] = [];
  if (firstNamePrefix) or.push({ firstName: { startsWith: firstNamePrefix, mode: "insensitive" } });
  if (emailDomain) or.push({ email: { endsWith: `@${emailDomain}`, mode: "insensitive" } });

  return prisma.lead.findMany({
    where: { id: { not: input.excludeLeadId }, deletedAt: null, OR: or },
    take: 30,
  });
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

/** Atomic claim: only succeeds if the lead is currently unclaimed and not
 *  soft-deleted. Guards the race between two recruiters claiming the same
 *  global-pool lead at once. */
export async function claimLead(leadId: string, recruiterId: string) {
  const result = await prisma.lead.updateMany({
    where: { id: leadId, claimedByRecruiterId: null, deletedAt: null },
    data: { claimedByRecruiterId: recruiterId, claimedAt: new Date(), assignedRecruiterId: recruiterId, assignedAt: new Date() },
  });
  if (result.count === 0) {
    const existing = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!existing || existing.deletedAt) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
    throw new ApiError(409, "ALREADY_CLAIMED", "This lead has already been claimed by another recruiter");
  }
  return prisma.lead.findUnique({ where: { id: leadId } });
}

/** Shared single-lead lookup for every :id action route (flags, activities,
 *  retry-enrichment, reenrich, notify-subscription, ...): 404s identically on
 *  a missing id and a soft-deleted one -- a lead sitting in the Global Leads
 *  recycle bin must be as inert to these routes as it already is to the
 *  list/export/mine endpoints (buildLeadWhere above), not still fully
 *  claimable/flaggable/re-enrichable by id. */
export async function requireActiveLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead || lead.deletedAt) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");
  return lead;
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
  // Soft-deleted leads (Global Leads recycle bin) never show up in the
  // normal pool or its export -- restoring is the only way back in.
  const where: Prisma.LeadWhereInput = { deletedAt: null };
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

type DuplicateCandidate = {
  id: string;
  fullName: string | null;
  displayName: string | null;
  email: string | null;
  profileLink: string | null;
  contactNumber: string | null;
};

export type DuplicateMatch =
  | {
      isDuplicate: true;
      matchedField: "email_address" | "profile_link" | "contact_number" | "full_name";
      leadId: string;
      matchedName: string;
      lead: DuplicateCandidate;
    }
  | { isDuplicate: false; matchedField: null; leadId: null; matchedName: null; lead: null };

/**
 * findDuplicateLead's rules -- same checks, same order, same answers -- over
 * leads already in memory, so a bulk upload checks every row against ONE read
 * of the table instead of up to four queries per row (one of which loaded
 * every lead that has a phone number, once per row). Pure, so it's testable
 * without a database; loadDuplicateIndex() feeds it.
 *
 * Each rule is answered through an index, keeping its exact semantics:
 * - email: case-insensitive equality;
 * - profile link: equals the raw link, or CONTAINS the normalized one -- an
 *   exact normalized-link hit implies "contains", and only a miss falls back
 *   to scanning;
 * - phone: either number ends with the other (7+ digits each), so both share
 *   their last 7 digits -- indexed on those;
 * - name: case-insensitive equality with fullName or displayName.
 */
export function buildDuplicateIndex(leads: DuplicateCandidate[]) {
  const byEmail = new Map<string, DuplicateCandidate>();
  const byLinkLower = new Map<string, DuplicateCandidate>();
  const byNormalizedLink = new Map<string, DuplicateCandidate>();
  const byLast7Digits = new Map<string, Array<{ lead: DuplicateCandidate; digits: string }>>();
  const byName = new Map<string, DuplicateCandidate>();
  const setFirst = (map: Map<string, DuplicateCandidate>, key: string, lead: DuplicateCandidate) => {
    if (!map.has(key)) map.set(key, lead);
  };

  for (const lead of leads) {
    if (lead.email) setFirst(byEmail, lead.email.toLowerCase(), lead);
    if (lead.profileLink) {
      setFirst(byLinkLower, lead.profileLink.toLowerCase(), lead);
      setFirst(byNormalizedLink, normalizeProfileLink(lead.profileLink), lead);
    }
    const digits = (lead.contactNumber || "").replace(/\D/g, "");
    if (digits.length >= 7) {
      const bucket = byLast7Digits.get(digits.slice(-7)) ?? [];
      bucket.push({ lead, digits });
      byLast7Digits.set(digits.slice(-7), bucket);
    }
    if (lead.fullName) setFirst(byName, lead.fullName.toLowerCase(), lead);
    if (lead.displayName) setFirst(byName, lead.displayName.toLowerCase(), lead);
  }

  const match = (matchedField: Extract<DuplicateMatch, { isDuplicate: true }>["matchedField"], lead: DuplicateCandidate): DuplicateMatch => ({
    isDuplicate: true,
    matchedField,
    leadId: lead.id,
    matchedName: lead.displayName || lead.fullName || "Existing Lead",
    lead,
  });

  return {
    find(input: { email?: string; contactNumber?: string; fullName?: string; profileLink?: string }): DuplicateMatch {
      const email = input.email?.trim().toLowerCase();
      if (email && email.includes("@")) {
        const hit = byEmail.get(email);
        if (hit) return match("email_address", hit);
      }

      const rawProfileLink = input.profileLink?.trim();
      if (rawProfileLink) {
        const normalizedLink = normalizeProfileLink(rawProfileLink);
        if (normalizedLink.length > 5) {
          // ponytail: the "contains" fallback scans every stored link -- fine
          // to ~50k leads; the upgrade is an indexed normalized-link column.
          const hit =
            byNormalizedLink.get(normalizedLink) ??
            byLinkLower.get(rawProfileLink.toLowerCase()) ??
            leads.find((l) => !!l.profileLink && l.profileLink.toLowerCase().includes(normalizedLink));
          if (hit) return match("profile_link", hit);
        }
      }

      const digits = input.contactNumber?.trim().replace(/\D/g, "");
      if (digits && digits.length >= 7) {
        const hit = (byLast7Digits.get(digits.slice(-7)) ?? []).find(
          (c) => c.digits.endsWith(digits) || digits.endsWith(c.digits)
        );
        if (hit) return match("contact_number", hit.lead);
      }

      const fullName = input.fullName?.trim();
      if (fullName && fullName.length >= 3) {
        const hit = byName.get(fullName.toLowerCase());
        if (hit) return match("full_name", hit);
      }

      return { isDuplicate: false, matchedField: null, leadId: null, matchedName: null, lead: null };
    },
  };
}

/** One read of every non-deleted lead, indexed for buildDuplicateIndex. */
export async function loadDuplicateIndex() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null },
    select: { id: true, fullName: true, displayName: true, email: true, profileLink: true, contactNumber: true },
  });
  return buildDuplicateIndex(leads);
}
