import { Router, Request, Response } from "express";
import { z } from "zod";
import { NotificationType } from "@prisma/client";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";

export const notificationRouter = Router();

notificationRouter.use(authenticateJwt);

// GET /api/notifications?take=&cursor= — unread-first, then most recent
notificationRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const take = Math.min(parseInt(String(req.query.take || "20"), 10) || 20, 100);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

    const notifications = await prisma.notification.findMany({
      where: { recipientId: req.user!.id },
      orderBy: [{ read: "asc" }, { createdAt: "desc" }],
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    return res.json({ notifications, nextCursor: notifications.length === take ? notifications[notifications.length - 1].id : null });
  })
);

// GET /api/notifications/unread-count
notificationRouter.get(
  "/unread-count",
  asyncHandler(async (req: Request, res: Response) => {
    const count = await prisma.notification.count({ where: { recipientId: req.user!.id, read: false } });
    return res.json({ count });
  })
);

// POST /api/notifications/read-all
notificationRouter.post(
  "/read-all",
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.notification.updateMany({
      where: { recipientId: req.user!.id, read: false },
      data: { read: true, readAt: new Date() },
    });
    return res.json({ success: true });
  })
);

// POST /api/notifications/:id/read
notificationRouter.post(
  "/:id/read",
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    if (existing.recipientId !== req.user!.id) throw new ApiError(403, "FORBIDDEN", "Not your notification");

    const notification = await prisma.notification.update({
      where: { id: existing.id },
      data: { read: true, readAt: new Date() },
    });
    return res.json({ notification });
  })
);

// GET /api/notifications/preferences — every type FOR THIS USER'S ROLE, seeded
// with defaults on first read. Recruiter/owner and contractor get different
// type lists since the underlying events genuinely differ (a contractor is
// never assigned a Requirement, a recruiter never gets an enrichment-finished
// ping) -- seeding the other role's types would just be dead rows.
const ALWAYS_ON_BELL_TYPES: NotificationType[] = ["NEW_LEAD", "TASK_ASSIGNMENT", "DUE_DATE_REMINDER", "ESCALATION"];
const RECRUITER_TYPES: NotificationType[] = [
  "NEW_LEAD",
  "TASK_ASSIGNMENT",
  "DUE_DATE_REMINDER",
  "LEAD_RESPONSE",
  "ESCALATION",
  "ENRICHMENT_COMPLETE",
  "ENRICHMENT_STALLED",
  "DUPLICATE_REVIEW_NEEDED",
  "DNC_CONFIRMATION_NEEDED",
  "FOLLOW_UP_DUE",
  "LEAD_PLACED",
];
// LEAD_RESPONSE is shared with RECRUITER_TYPES -- same type, different trigger
// source (see unipile.service.ts's contractor-owned-lead branch).
// TASK_ASSIGNMENT/DUE_DATE_REMINDER are shared too: Requirement.recruiterId
// holds a contractor just as readily as a recruiter (requirement.routes.ts
// never checks role, and both the Create Demand dialog and the Clients &
// Market Demand list offer contractors), so omitting them here meant an
// assigned contractor got a bell row and nothing else -- createNotification
// reads a per-(user,type) preference row that was never seeded for them, and
// the contractor settings page's single Email/Slack toggle (which writes
// exactly typesForRole) could never turn them on.
const CONTRACTOR_TYPES: NotificationType[] = [
  "LEAD_RESPONSE",
  "TASK_ASSIGNMENT",
  "DUE_DATE_REMINDER",
  "ENRICHMENT_COMPLETE",
  "ENRICHMENT_STALLED",
  "DUPLICATE_REVIEW_NEEDED",
  "LEAD_PLACED",
  "DAILY_DEMAND_SUMMARY",
  "WEEKLY_LEADS_SUMMARY",
  "WEEKLY_PERFORMANCE_SUMMARY",
];
// Owner-only oversight types -- deliberately not a copy of RECRUITER_TYPES.
// ESCALATION is left out: today's escalation-mirroring only ever targets an
// individual recruiter (see escalation.job.ts), never an owner, so it would
// seed a preference row that never fires -- the owner's existing
// EscalationsBell (reads the Escalation table directly) remains their real
// escalations view.
const OWNER_TYPES: NotificationType[] = [
  // An owner can switch on a lead's "notify me on response" bell exactly like
  // a recruiter can (PATCH /leads/:id/notify-subscription allows "owner", and
  // the conversations page that hosts the bell is mounted for all three
  // roles), so LEAD_RESPONSE genuinely reaches owners -- leaving it out meant
  // a subscribed owner got a bell row their Email/Slack toggle could never
  // cover, since that toggle writes exactly typesForRole.
  "LEAD_RESPONSE",
  "ENRICHMENT_COMPLETE",
  "DUPLICATE_REVIEW_NEEDED",
  "DNC_CONFIRMATION_NEEDED",
  "LEAD_PLACED",
  "WEEKLY_TEAM_HEALTH_SUMMARY",
  "CLIENT_STATUS_UPDATE",
  "REQUIREMENT_FULFILLED",
];
const ALL_TYPES: NotificationType[] = [...new Set([...RECRUITER_TYPES, ...CONTRACTOR_TYPES, ...OWNER_TYPES])];

// PDF's "recommended starting defaults": due-date reminder gets email on by
// default; everything else starts bell-only (email/Slack off) until the
// recruiter opts in.
const DEFAULT_EMAIL_ENABLED: Partial<Record<NotificationType, boolean>> = { DUE_DATE_REMINDER: true };

/** What a preference row should start as when a type is seeded for a user.
 *
 * A user with no rows yet is seeing this for the first time: they get the
 * recommended defaults. A user who already HAS rows has made a choice, and a
 * type added to their role list later must inherit it rather than reset --
 * otherwise adding a type silently flips the single Email/Slack switch on
 * contractor.settings.tsx back to off (it reads every()) and quietly stops
 * delivering a channel they had turned on. That is exactly what happened when
 * TASK_ASSIGNMENT/DUE_DATE_REMINDER joined CONTRACTOR_TYPES.
 *
 * every(), not some(): inheriting "on" out of a partially-on state would turn
 * a channel on for a type the user never agreed to. Default-deny on a mix. */
export function seedChannelsFor(
  type: NotificationType,
  existing: { emailEnabled: boolean; slackEnabled: boolean }[]
): { emailEnabled: boolean; slackEnabled: boolean } {
  if (existing.length === 0) {
    return { emailEnabled: DEFAULT_EMAIL_ENABLED[type] ?? false, slackEnabled: false };
  }
  return {
    emailEnabled: existing.every((p) => p.emailEnabled),
    slackEnabled: existing.every((p) => p.slackEnabled),
  };
}

/** The types whose preference rows GET /preferences seeds, and which the
 * settings pages' single Email/Slack switch writes (bulk PATCH /preferences).
 * A type NOT in here can still create a bell row, but its email/Slack
 * preference never exists, so those channels can never be turned on for it --
 * see notificationRoleCoverage.test.ts, which pins every (role, type) pair
 * the codebase actually emits against this. */
export function typesForRole(role: string): NotificationType[] {
  if (role === "contractor") return CONTRACTOR_TYPES;
  if (role === "owner") return OWNER_TYPES;
  return RECRUITER_TYPES;
}

notificationRouter.get(
  "/preferences",
  asyncHandler(async (req: Request, res: Response) => {
    const roleTypes = typesForRole(req.user!.role);
    const existing = await prisma.notificationPreference.findMany({ where: { userId: req.user!.id } });
    const byType = new Map(existing.map((p) => [p.type, p]));

    const missing = roleTypes.filter((t) => !byType.has(t));
    if (missing.length > 0) {
      await prisma.notificationPreference.createMany({
        data: missing.map((type) => ({ userId: req.user!.id, type, ...seedChannelsFor(type, existing) })),
        skipDuplicates: true,
      });
    }

    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: req.user!.id, type: { in: roleTypes } },
    });
    return res.json({ preferences, alwaysOnBellTypes: ALWAYS_ON_BELL_TYPES });
  })
);

// PATCH /api/notifications/preferences/:type
notificationRouter.patch(
  "/preferences/:type",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ emailEnabled: z.boolean().optional(), slackEnabled: z.boolean().optional() });
    const patch = schema.parse(req.body);
    const type = req.params.type as (typeof ALL_TYPES)[number];
    if (!ALL_TYPES.includes(type)) throw new ApiError(400, "INVALID_TYPE", "Unknown notification type");

    const preference = await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: req.user!.id, type } },
      create: {
        userId: req.user!.id,
        type,
        emailEnabled: patch.emailEnabled ?? DEFAULT_EMAIL_ENABLED[type] ?? false,
        slackEnabled: patch.slackEnabled ?? false,
      },
      update: {
        ...(patch.emailEnabled !== undefined ? { emailEnabled: patch.emailEnabled } : {}),
        ...(patch.slackEnabled !== undefined ? { slackEnabled: patch.slackEnabled } : {}),
      },
    });
    return res.json({ preference });
  })
);

// PATCH /api/notifications/preferences — bulk variant: applies the same
// emailEnabled/slackEnabled value across every type this user's role has,
// in one atomic transaction. Built for the contractor settings page, which
// deliberately exposes one Email toggle and one Slack toggle rather than
// per-type rows (see contractor.settings.tsx) -- this is what "one toggle"
// actually flips under the hood, since the schema still tracks preference
// per (userId, type) and every send-time check in notification.service.ts's
// createNotification still reads it that way.
notificationRouter.patch(
  "/preferences",
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ emailEnabled: z.boolean().optional(), slackEnabled: z.boolean().optional() });
    const patch = schema.parse(req.body);
    if (patch.emailEnabled === undefined && patch.slackEnabled === undefined) {
      throw new ApiError(400, "EMPTY_PATCH", "Provide emailEnabled and/or slackEnabled");
    }

    const roleTypes = typesForRole(req.user!.role);
    await prisma.$transaction(
      roleTypes.map((type) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId: req.user!.id, type } },
          create: {
            userId: req.user!.id,
            type,
            emailEnabled: patch.emailEnabled ?? DEFAULT_EMAIL_ENABLED[type] ?? false,
            slackEnabled: patch.slackEnabled ?? false,
          },
          update: {
            ...(patch.emailEnabled !== undefined ? { emailEnabled: patch.emailEnabled } : {}),
            ...(patch.slackEnabled !== undefined ? { slackEnabled: patch.slackEnabled } : {}),
          },
        })
      )
    );

    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: req.user!.id, type: { in: roleTypes } },
    });
    return res.json({ preferences });
  })
);
