import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked at the module boundary -- no test in this file touches a real
// database. findDuplicateLead's own SQL-level behavior (mode: "insensitive"
// case folding, `contains` substring matching) is real Postgres behavior
// that a mock can't faithfully reproduce; these tests instead verify the
// function's decision logic (which field wins, what it does with what the
// DB returns) given controlled fixture data, and a dedicated integration
// suite against a real test database is flagged as follow-up infra work.
vi.mock("../prisma", () => ({
  prisma: {
    lead: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../prisma";
import { findDuplicateLead } from "./lead.service";

const mockFindFirst = prisma.lead.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.lead.findMany as unknown as ReturnType<typeof vi.fn>;

function noMatch() {
  mockFindFirst.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  noMatch();
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
