import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server-root/prisma", () => ({
  prisma: {
    escalation: { findFirst: vi.fn(), create: vi.fn() },
    interactionEvent: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    emailQueueItem: { count: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { scanForEscalations } from "@server/jobs/escalation.job";

const p: any = prisma;

beforeEach(() => {
  vi.clearAllMocks();
  p.escalation.findFirst.mockResolvedValue(null);
  p.escalation.create.mockResolvedValue({});
  p.interactionEvent.findMany.mockResolvedValue([]);
  p.lead.findMany.mockResolvedValue([]);
  p.user.findMany.mockResolvedValue([]);
  p.emailQueueItem.count.mockResolvedValue(0);
});

describe("scanForEscalations", () => {
  it("creates nothing when there are no breaches, stale leads, or backlogs", async () => {
    await scanForEscalations();
    expect(p.escalation.create).not.toHaveBeenCalled();
  });

  it("runs all three scans concurrently", async () => {
    await scanForEscalations();
    expect(p.interactionEvent.findMany).toHaveBeenCalledTimes(1);
    expect(p.lead.findMany).toHaveBeenCalledTimes(1);
    expect(p.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "RECRUITER", isActive: true } })
    );
  });

  describe("SLA breach scan", () => {
    const breach = {
      leadId: "lead-1",
      occurredAt: new Date(Date.now() - 30 * 3600_000),
      lead: { fullName: "Jane Doe", maskedLabel: "J.D.", assignedRecruiterId: "rec-1" },
    };

    it("creates a P1 SLA Breach escalation for an unanswered urgent inbound reply", async () => {
      p.interactionEvent.findMany.mockResolvedValue([breach]);

      await scanForEscalations();

      expect(p.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: "P1",
            category: "SLA Breach",
            leadId: "lead-1",
            recruiterId: "rec-1",
          }),
        })
      );
    });

    it("queries only urgent, unresponded, overdue inbound events", async () => {
      await scanForEscalations();
      const where = p.interactionEvent.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ direction: "INBOUND", isUrgentFlag: true, recruiterRespondedAt: null });
    });

    it("computes slaHoursRemaining as a negative overdue amount", async () => {
      p.interactionEvent.findMany.mockResolvedValue([breach]);
      await scanForEscalations();
      const data = p.escalation.create.mock.calls[0][0].data;
      expect(data.slaHoursRemaining).toBeLessThan(0);
    });

    it("falls back to maskedLabel in the title when fullName is missing", async () => {
      p.interactionEvent.findMany.mockResolvedValue([
        { ...breach, lead: { ...breach.lead, fullName: null } },
      ]);
      await scanForEscalations();
      const data = p.escalation.create.mock.calls[0][0].data;
      expect(data.title).toContain("J.D.");
    });

    it("skips a breach that already has a tracked (non-IN_PROGRESS) escalation", async () => {
      p.interactionEvent.findMany.mockResolvedValue([breach]);
      p.escalation.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.category === "SLA Breach" ? { id: "existing" } : null)
      );

      await scanForEscalations();

      expect(p.escalation.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ category: "SLA Breach" }) })
      );
    });
  });

  describe("stale lead scan", () => {
    const staleLead = {
      id: "lead-2",
      fullName: "Sam Stale",
      maskedLabel: "S.S.",
      assignedRecruiterId: "rec-2",
      createdAt: new Date(Date.now() - 6 * 86_400_000),
    };

    it("creates a Recruiter Performance escalation for a stale unresolved/on-hold lead", async () => {
      p.lead.findMany.mockResolvedValue([staleLead]);

      await scanForEscalations();

      expect(p.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: "Recruiter Performance",
            leadId: "lead-2",
            recruiterId: "rec-2",
          }),
        })
      );
    });

    it("queries leads that are unresolved OR flagged ON_HOLD, past the cutoff", async () => {
      await scanForEscalations();
      const where = p.lead.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ identityResolved: false }, { flags: { has: "ON_HOLD" } }]);
    });

    it("assigns P3 priority when the lead is only moderately stale", async () => {
      p.lead.findMany.mockResolvedValue([staleLead]);
      await scanForEscalations();
      const data = p.escalation.create.mock.calls[0][0].data;
      expect(data.priority).toBe("P3");
    });

    it("assigns P2 priority once staleness exceeds double the threshold", async () => {
      p.lead.findMany.mockResolvedValue([
        { ...staleLead, createdAt: new Date(Date.now() - 11 * 86_400_000) },
      ]);
      await scanForEscalations();
      const data = p.escalation.create.mock.calls[0][0].data;
      expect(data.priority).toBe("P2");
    });

    it("skips a stale lead that already has a tracked escalation", async () => {
      p.lead.findMany.mockResolvedValue([staleLead]);
      p.escalation.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.category === "Recruiter Performance" ? { id: "existing" } : null)
      );

      await scanForEscalations();

      expect(p.escalation.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ category: "Recruiter Performance" }) })
      );
    });
  });

  describe("email queue backlog scan", () => {
    const recruiter = { id: "rec-3", name: "Rita Recruiter" };

    it("creates a P2 alert once a recruiter's backlog meets the threshold", async () => {
      p.user.findMany.mockResolvedValue([recruiter]);
      p.emailQueueItem.count.mockResolvedValue(25);

      await scanForEscalations();

      expect(p.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: "P2",
            category: "Email Queue Threshold Alert",
            recruiterId: "rec-3",
          }),
        })
      );
    });

    it("does not alert when backlog is below the threshold", async () => {
      p.user.findMany.mockResolvedValue([recruiter]);
      p.emailQueueItem.count.mockResolvedValue(24);

      await scanForEscalations();

      expect(p.escalation.create).not.toHaveBeenCalled();
    });

    it("skips a recruiter who already has a tracked backlog alert", async () => {
      p.user.findMany.mockResolvedValue([recruiter]);
      p.emailQueueItem.count.mockResolvedValue(30);
      p.escalation.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.category === "Email Queue Threshold Alert" ? { id: "existing" } : null)
      );

      await scanForEscalations();

      expect(p.escalation.create).not.toHaveBeenCalled();
    });

    it("only queries active recruiters", async () => {
      await scanForEscalations();
      expect(p.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: "RECRUITER", isActive: true } })
      );
    });
  });
});
