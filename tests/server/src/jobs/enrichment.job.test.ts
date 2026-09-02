import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");

vi.mock("@server-root/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    emailQueueItem: { updateMany: vi.fn().mockResolvedValue({}) },
    conversation: { updateMany: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from "@server-root/prisma";
import { enrichLeadById, stallOverdueEnrichments, pollPendingEnrichment } from "@server/jobs/enrichment.job";

const mockFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.lead.update as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.lead.findMany as unknown as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.lead.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockAxiosPost = axios.post as unknown as ReturnType<typeof vi.fn>;

const baseLead: any = {
  id: "lead-1",
  firstName: "Jane",
  fullName: "Jane Doe",
  displayName: null,
  country: "Germany",
  email: null,
  contactNumber: null,
  profileLink: "https://linkedin.com/in/jane-doe",
  services: [],
  sourceLanguage: "English",
  targetLanguage: "German",
  secondaryLanguages: [],
  yearsOfExperience: null,
  vendorExperience: null,
  source: "LINKEDIN",
  headline: null,
  aboutSnippet: null,
  currentTitle: null,
  toolsSoftware: [],
  certifications: [],
  fieldSources: {},
  flags: [],
  rawScrapeData: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue({ ...baseLead });
  mockUpdate.mockResolvedValue({});
});

describe("enrichLeadById", () => {
  it("does nothing when the lead doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    await enrichLeadById("nope");
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("marks the lead IN_PROGRESS before calling the enrichment service", async () => {
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });
    await enrichLeadById("lead-1");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStatus: "IN_PROGRESS" }) })
    );
  });

  it("sends the 70s timeout on the /enrich call", async () => {
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });
    await enrichLeadById("lead-1");
    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining("/enrich"),
      expect.anything(),
      expect.objectContaining({ timeout: 70_000 })
    );
  });

  it("marks the lead COMPLETE when not awaiting Clay, and applies scraped fields", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        lead: { Email_Address: "found@example.com", Full_Name: "Jane Real Doe" },
        field_sources: { Email_Address: "brightdata" },
      },
    });

    await enrichLeadById("lead-1");

    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.enrichmentStatus).toBe("COMPLETE");
    expect(finalUpdateCall.data.identityResolved).toBe(true);
    expect(finalUpdateCall.data.email).toBe("found@example.com");
    expect(finalUpdateCall.data.displayName).toBe("Jane Real Doe");
  });

  it("stays PENDING (not COMPLETE) while Clay dispatch is still pending", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { lead: {}, field_sources: { _clay_dispatch: "pending" } },
    });

    await enrichLeadById("lead-1");

    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.enrichmentStatus).toBe("PENDING");
    expect(finalUpdateCall.data.identityResolved).toBe(false);
  });

  it("appends ON_HOLD when the run completes with no contact info at all", async () => {
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } }); // no email/phone found
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.flags).toContain("ON_HOLD");
  });

  it("does not add ON_HOLD when the run resolves an email", async () => {
    mockAxiosPost.mockResolvedValue({ data: { lead: { Email_Address: "found@example.com" }, field_sources: {} } });
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.flags).not.toContain("ON_HOLD");
  });

  it("preserves other existing flags (e.g. DNC) when adding ON_HOLD -- never clobbers", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLead, flags: ["DNC"] });
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.flags).toEqual(expect.arrayContaining(["DNC", "ON_HOLD"]));
  });

  it("is idempotent: re-running on an already-ON_HOLD lead doesn't duplicate the flag", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLead, flags: ["ON_HOLD"] });
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    const onHoldCount = finalUpdateCall.data.flags.filter((f: string) => f === "ON_HOLD").length;
    expect(onHoldCount).toBe(1);
  });

  it("normalizes a raw colon-delimited Services string from the pipeline response", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { lead: { Services: "Sub:Dubbing" }, field_sources: {} },
    });
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.services).toEqual(["Subtitling", "Dubbing"]);
  });

  it("keeps the manually-entered value when the pipeline returns nothing for a field", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLead, country: "Original Country" });
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.country).toBe("Original Country");
  });

  it("keeps the manually-typed name when the pipeline returns no Full_Name/First_Name", async () => {
    mockFindUnique.mockResolvedValue({ ...baseLead, displayName: "Manually Set" });
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });
    await enrichLeadById("lead-1");
    const finalUpdateCall = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];
    expect(finalUpdateCall.data.displayName).toBe("Manually Set");
  });

  it("reverts to PENDING (not COMPLETE, not thrown) when the enrichment call fails entirely", async () => {
    // A 500 is retryable, so this burns the full retryWithBackoff cycle
    // (1s/2s/4s/8s real setTimeout calls internally) before the catch block
    // reverts to PENDING -- fake timers keep this test in milliseconds.
    vi.useFakeTimers();
    mockAxiosPost.mockRejectedValue({ response: { status: 500 } });

    const promise = enrichLeadById("lead-1");
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    await promise;
    vi.useRealTimers();

    const calls = mockUpdate.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.data.enrichmentStatus).toBe("PENDING");
    expect(mockAxiosPost).toHaveBeenCalledTimes(5); // 1 initial + 4 retries, all exhausted
  });

  it("does not throw when a real (non-retryable) auth error comes back from the service", async () => {
    mockAxiosPost.mockRejectedValue({ response: { status: 401 } });
    await expect(enrichLeadById("lead-1")).resolves.toBeUndefined();
    const calls = mockUpdate.mock.calls;
    expect(calls[calls.length - 1][0].data.enrichmentStatus).toBe("PENDING");
  });

  it("keeps the candidate role tag in sync on email queue items and conversations", async () => {
    mockAxiosPost.mockResolvedValue({ data: { lead: { Services: "Dubbing" }, field_sources: {} } });
    await enrichLeadById("lead-1");
    expect(prisma.emailQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leadId: "lead-1" } })
    );
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leadId: "lead-1" } })
    );
  });
});

describe("stallOverdueEnrichments", () => {
  it("does nothing when there are no overdue leads", async () => {
    mockFindMany.mockResolvedValue([]);
    await stallOverdueEnrichments();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("marks overdue IN_PROGRESS leads as STALLED", async () => {
    mockFindMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await stallOverdueEnrichments();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] } },
      data: { enrichmentStatus: "STALLED" },
    });
  });

  it("queries for leads with a stale enrichmentStartedAt OR none at all", async () => {
    mockFindMany.mockResolvedValue([]);
    await stallOverdueEnrichments();
    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg.enrichmentStatus).toBe("IN_PROGRESS");
    expect(whereArg.OR).toEqual(
      expect.arrayContaining([{ enrichmentStartedAt: null }, expect.objectContaining({ enrichmentStartedAt: expect.anything() })])
    );
  });
});

describe("pollPendingEnrichment", () => {
  it("does nothing when there are no pending leads", async () => {
    mockFindMany.mockResolvedValue([]);
    await pollPendingEnrichment();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("calls enrichLeadById for every pending lead", async () => {
    mockFindMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    mockFindUnique.mockImplementation((args: any) => Promise.resolve({ ...baseLead, id: args.where.id }));
    mockAxiosPost.mockResolvedValue({ data: { lead: {}, field_sources: {} } });

    await pollPendingEnrichment();

    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });
});
