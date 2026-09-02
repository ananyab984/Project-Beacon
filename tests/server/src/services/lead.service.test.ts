import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked at the module boundary -- no test in this file touches a real
// database. findDuplicateLead's own SQL-level behavior (mode: "insensitive"
// case folding, `contains` substring matching) is real Postgres behavior
// that a mock can't faithfully reproduce; these tests instead verify the
// function's decision logic (which field wins, what it does with what the
// DB returns) given controlled fixture data, and a dedicated integration
// suite against a real test database is flagged as follow-up infra work.
vi.mock("@server-root/prisma", () => ({
  prisma: {
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    stageHistory: { findMany: vi.fn() },
    leadFlagEvent: { findMany: vi.fn() },
    interactionEvent: { findMany: vi.fn() },
    manualActivityLog: { findMany: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { ApiError } from "@server/lib/apiError";
import { findDuplicateLead, getLeadTimeline, claimLead, buildLeadWhere } from "@server/services/lead.service";

const mockFindFirst = prisma.lead.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.lead.findMany as unknown as ReturnType<typeof vi.fn>;
const mockLeadFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockLeadUpdateMany = prisma.lead.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockStageHistoryFindMany = prisma.stageHistory.findMany as unknown as ReturnType<typeof vi.fn>;
const mockFlagEventsFindMany = prisma.leadFlagEvent.findMany as unknown as ReturnType<typeof vi.fn>;
const mockInteractionEventsFindMany = prisma.interactionEvent.findMany as unknown as ReturnType<typeof vi.fn>;
const mockManualActivityFindMany = prisma.manualActivityLog.findMany as unknown as ReturnType<typeof vi.fn>;

function noMatch() {
  mockFindFirst.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  noMatch();
  mockStageHistoryFindMany.mockResolvedValue([]);
  mockFlagEventsFindMany.mockResolvedValue([]);
  mockInteractionEventsFindMany.mockResolvedValue([]);
  mockManualActivityFindMany.mockResolvedValue([]);
});

describe("findDuplicateLead", () => {
  describe("priority order: email -> profileLink -> contactNumber -> fullName", () => {
    it("matches on email (case-insensitive) and never reaches the profile-link/phone/name checks", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "lead-1",
        fullName: "Jordan Lee",
        displayName: null,
        email: "jordan.lee@example.com",
      });

      const res = await findDuplicateLead({
        email: "Jordan.Lee@Example.com",
        profileLink: "https://linkedin.com/in/jordan-lee",
        contactNumber: "+15551234567",
        fullName: "Jordan Lee",
      });

      expect(res).toEqual({
        isDuplicate: true,
        matchedField: "email_address",
        leadId: "lead-1",
        matchedName: "Jordan Lee",
      });
      // Only the email check's findFirst should have run -- everything else
      // short-circuits per the documented priority order.
      expect(mockFindFirst).toHaveBeenCalledTimes(1);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("falls through to profile link when email doesn't match, tolerating http/https, www., and trailing slash variants", async () => {
      mockFindFirst
        .mockResolvedValueOnce(null) // email check misses
        .mockResolvedValueOnce({
          id: "lead-2",
          fullName: "Priya Nair",
          displayName: null,
          profileLink: "https://www.linkedin.com/in/priya-nair/",
        });

      const res = await findDuplicateLead({
        email: "different@example.com",
        profileLink: "http://linkedin.com/in/priya-nair",
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.matchedField).toBe("profile_link");
      expect(res.leadId).toBe("lead-2");
    });

    it("falls through to phone (digit-suffix match) when email and profile link both miss", async () => {
      mockFindFirst.mockResolvedValue(null); // email + name checks miss
      mockFindMany.mockResolvedValueOnce([
        { id: "lead-3", fullName: "Sam Okafor", displayName: null, contactNumber: "+1 (555) 123-4567" },
      ]);

      const res = await findDuplicateLead({ contactNumber: "5551234567" });

      expect(res.isDuplicate).toBe(true);
      expect(res.matchedField).toBe("contact_number");
      expect(res.leadId).toBe("lead-3");
    });

    it("falls through to full name (case-insensitive) when every other field misses or is absent", async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: "lead-4",
        fullName: "TAYLOR MORGAN",
        displayName: null,
      });

      const res = await findDuplicateLead({ fullName: "taylor morgan" });

      expect(res.isDuplicate).toBe(true);
      expect(res.matchedField).toBe("full_name");
      expect(res.leadId).toBe("lead-4");
    });

    it("reports the first-priority match when a lead would match on multiple fields", async () => {
      // Email matches -- profile link/phone/name are never even checked,
      // confirming the priority order is enforced, not an arbitrary pick.
      mockFindFirst.mockResolvedValueOnce({
        id: "lead-5",
        fullName: "Multi Match",
        displayName: null,
        email: "multi@example.com",
      });

      const res = await findDuplicateLead({
        email: "multi@example.com",
        profileLink: "https://linkedin.com/in/multi-match",
        fullName: "Multi Match",
      });

      expect(res.matchedField).toBe("email_address");
      expect(mockFindFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("guards against false positives", () => {
    it("does not run the phone check for a number with fewer than 7 digits", async () => {
      const res = await findDuplicateLead({ contactNumber: "12345" });
      expect(res.isDuplicate).toBe(false);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("does not run the full-name check for a name shorter than 3 characters", async () => {
      const res = await findDuplicateLead({ fullName: "Al" });
      expect(res.isDuplicate).toBe(false);
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it("does not run the profile-link check for a normalized link 5 characters or shorter", async () => {
      const res = await findDuplicateLead({ profileLink: "http://a.b" });
      expect(res.isDuplicate).toBe(false);
    });

    it("does not treat an email without '@' as a real email", async () => {
      const res = await findDuplicateLead({ email: "not-an-email" });
      expect(res.isDuplicate).toBe(false);
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it("returns not-duplicate for a genuinely distinct lead with no field overlap", async () => {
      noMatch();
      const res = await findDuplicateLead({
        email: "unique.person@example.com",
        fullName: "Completely Different Person",
      });
      expect(res).toEqual({ isDuplicate: false, matchedField: null, leadId: null, matchedName: null });
    });
  });

  describe("cross-source agnosticism (LinkedIn / ProZ / recruiter-tracker)", () => {
    // findDuplicateLead takes no `source` parameter at all -- these tests
    // assert that's genuinely true (same fields, same result) regardless of
    // which source the caller is checking on behalf of, per this session's
    // investigation, rather than silently assuming it.
    it("catches the same duplicate pair identically regardless of declared source", async () => {
      mockFindFirst.mockResolvedValue({
        id: "lead-6",
        fullName: "Cross Source",
        displayName: null,
        email: "cross.source@example.com",
      });

      // Same lookup input, three different "source" contexts a caller might
      // be operating in (source is deliberately not passed to the function
      // at all -- it plays no role in the lookup).
      const fromLinkedIn = await findDuplicateLead({ email: "cross.source@example.com", fullName: "Cross Source" });
      const fromProZ = await findDuplicateLead({ email: "cross.source@example.com", fullName: "Cross Source" });
      const fromTracker = await findDuplicateLead({ email: "cross.source@example.com", fullName: "Cross Source" });

      expect(fromLinkedIn).toEqual(fromProZ);
      expect(fromProZ).toEqual(fromTracker);
    });
  });

  describe("real-world messy fixture rows (ProZ_Enrichment_Test_Cases_Formatted.xlsx-shaped)", () => {
    // These mirror the actual TC01-TC10 scenarios from the real fixture
    // file (URL-only record, sparse profile, missing contact) -- not
    // idealized data -- to confirm the dedup path doesn't crash or
    // false-negative on incomplete real-world rows.
    it("handles a URL-only record (no email, no phone) via the profile-link path", async () => {
      // No email in the input at all -- the email branch is skipped
      // entirely (never calls findFirst), so this single queued value is
      // consumed by the profile-link check instead.
      mockFindFirst.mockResolvedValueOnce({
        id: "lead-7",
        fullName: null,
        displayName: null,
        profileLink: "https://proz.com/profile/12345",
      });

      const res = await findDuplicateLead({ profileLink: "https://www.proz.com/profile/12345/" });
      expect(res.isDuplicate).toBe(true);
      expect(res.matchedField).toBe("profile_link");
    });

    it("handles a sparse/incomplete record (name only, everything else missing) without crashing", async () => {
      const res = await findDuplicateLead({ fullName: "" });
      expect(res).toEqual({ isDuplicate: false, matchedField: null, leadId: null, matchedName: null });
    });

    it("handles a record with every field empty/undefined without crashing", async () => {
      const res = await findDuplicateLead({});
      expect(res).toEqual({ isDuplicate: false, matchedField: null, leadId: null, matchedName: null });
    });
  });
});

describe("getLeadTimeline", () => {
  it("merges all four event sources into one array sorted chronologically", async () => {
    const t1 = new Date("2024-01-01T00:00:00Z");
    const t2 = new Date("2024-01-02T00:00:00Z");
    const t3 = new Date("2024-01-03T00:00:00Z");
    const t4 = new Date("2024-01-04T00:00:00Z");

    // Deliberately queued out of chronological order to prove the function
    // sorts, rather than just concatenating in source order.
    mockStageHistoryFindMany.mockResolvedValue([{ id: "sh-1", changedAt: t3 }]);
    mockFlagEventsFindMany.mockResolvedValue([{ id: "fe-1", setAt: t1 }]);
    mockInteractionEventsFindMany.mockResolvedValue([{ id: "ie-1", occurredAt: t4 }]);
    mockManualActivityFindMany.mockResolvedValue([{ id: "ma-1", scheduledAt: t2 }]);

    const timeline = await getLeadTimeline("lead-1");

    expect(timeline.map((e) => e.type)).toEqual(["FLAG", "MANUAL_ACTIVITY", "STAGE_CHANGE", "INTERACTION"]);
    expect(timeline.map((e) => e.at)).toEqual([t1, t2, t3, t4]);
  });

  it("queries every event source scoped to the given leadId", async () => {
    await getLeadTimeline("lead-42");
    expect(mockStageHistoryFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leadId: "lead-42" } }));
    expect(mockFlagEventsFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leadId: "lead-42" } }));
    expect(mockInteractionEventsFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leadId: "lead-42" } }));
    expect(mockManualActivityFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leadId: "lead-42" } }));
  });

  it("returns an empty array when the lead has no activity at all", async () => {
    const timeline = await getLeadTimeline("lead-quiet");
    expect(timeline).toEqual([]);
  });
});

describe("claimLead", () => {
  it("claims an unclaimed lead and returns the updated row", async () => {
    mockLeadUpdateMany.mockResolvedValue({ count: 1 });
    mockLeadFindUnique.mockResolvedValue({ id: "lead-1", claimedByRecruiterId: "rec-1" });

    const result = await claimLead("lead-1", "rec-1");

    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: "lead-1", claimedByRecruiterId: null },
      data: expect.objectContaining({ claimedByRecruiterId: "rec-1", assignedRecruiterId: "rec-1" }),
    });
    expect(result).toEqual({ id: "lead-1", claimedByRecruiterId: "rec-1" });
  });

  it("throws 404 LEAD_NOT_FOUND when the lead doesn't exist at all", async () => {
    mockLeadUpdateMany.mockResolvedValue({ count: 0 });
    mockLeadFindUnique.mockResolvedValue(null);

    await expect(claimLead("missing-lead", "rec-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "LEAD_NOT_FOUND",
    });
  });

  it("throws 409 ALREADY_CLAIMED when the lead exists but is already claimed by someone else", async () => {
    mockLeadUpdateMany.mockResolvedValue({ count: 0 });
    mockLeadFindUnique.mockResolvedValue({ id: "lead-1", claimedByRecruiterId: "someone-else" });

    await expect(claimLead("lead-1", "rec-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_CLAIMED",
    });
    expect(mockLeadUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("propagates ApiError instances (not just plain objects) from the race-loss path", async () => {
    mockLeadUpdateMany.mockResolvedValue({ count: 0 });
    mockLeadFindUnique.mockResolvedValue(null);

    await expect(claimLead("missing-lead", "rec-1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("buildLeadWhere", () => {
  it("returns an empty filter when given no params", () => {
    expect(buildLeadWhere({})).toEqual({});
  });

  it("builds a case-insensitive OR search across name/displayName/maskedLabel/email for `q`", () => {
    const where = buildLeadWhere({ q: "priya" });
    expect(where.OR).toEqual([
      { fullName: { contains: "priya", mode: "insensitive" } },
      { displayName: { contains: "priya", mode: "insensitive" } },
      { maskedLabel: { contains: "priya", mode: "insensitive" } },
      { email: { contains: "priya", mode: "insensitive" } },
    ]);
  });

  it("sets stage directly", () => {
    expect(buildLeadWhere({ stage: "NEW" })).toEqual({ stage: "NEW" });
  });

  it("builds a source/target language OR clause on its own when no `q` is given", () => {
    const where = buildLeadWhere({ language: "French" });
    expect(where.OR).toEqual([{ sourceLanguage: "French" }, { targetLanguage: "French" }]);
  });

  it("appends the language OR conditions onto the existing `q` OR clause rather than replacing it", () => {
    const where = buildLeadWhere({ q: "priya", language: "French" });
    expect(where.OR).toHaveLength(6);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ sourceLanguage: "French" }, { targetLanguage: "French" }])
    );
  });

  it("sets country, service, recruiterId, flag, and since filters independently", () => {
    const since = new Date("2024-01-01T00:00:00Z");
    const where = buildLeadWhere({
      country: "France",
      service: "Translation",
      recruiterId: "rec-1",
      flag: "DNC",
      since,
    });
    expect(where).toEqual({
      country: "France",
      services: { has: "Translation" },
      assignedRecruiterId: "rec-1",
      flags: { has: "DNC" },
      createdAt: { gte: since },
    });
  });

  it("omits keys entirely for params that weren't provided", () => {
    const where = buildLeadWhere({ country: "France" });
    expect(where).not.toHaveProperty("stage");
    expect(where).not.toHaveProperty("services");
    expect(where).not.toHaveProperty("OR");
  });
});
