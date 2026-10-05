import type { Prisma } from "@prisma/client";

/**
 * Every lead a user is accountable for: assigned to them, claimed by them,
 * or created by them -- as a recruiter OR as a contractor -- and not in the
 * recycle bin.
 *
 * The single definition behind both what a user sees about themselves
 * (GET /api/leads/mine) and what an owner sees about them (the score in
 * scoring.job.ts). Those used to disagree: scoring counted recycle-bin
 * leads, skipped leads a recruiter created but wasn't assigned, and never
 * looked at createdByContractorId at all -- so a contractor's sourcing and
 * progression could only ever read 0, whatever they actually submitted.
 *
 * A user id is only ever one role, so listing both creator columns never
 * credits one person's leads to someone else.
 */
export function ownedLeadsWhere(userId: string): Prisma.LeadWhereInput {
  return {
    deletedAt: null,
    OR: [
      { assignedRecruiterId: userId },
      { claimedByRecruiterId: userId },
      { createdByRecruiterId: userId },
      { createdByContractorId: userId },
    ],
  };
}
