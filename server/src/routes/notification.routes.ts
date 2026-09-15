import { Router, Request, Response } from "express";
import { z } from "zod";
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

// GET /api/notifications/preferences — every type, seeded with defaults on first read
const ALWAYS_ON_BELL_TYPES = ["NEW_LEAD", "TASK_ASSIGNMENT", "DUE_DATE_REMINDER", "ESCALATION"] as const;
const ALL_TYPES = ["NEW_LEAD", "TASK_ASSIGNMENT", "DUE_DATE_REMINDER", "LEAD_RESPONSE", "ESCALATION"] as const;

// PDF's "recommended starting defaults": due-date reminder gets email on by
// default; everything else starts bell-only (email/Slack off) until the
// recruiter opts in.
const DEFAULT_EMAIL_ENABLED: Record<string, boolean> = { DUE_DATE_REMINDER: true };

notificationRouter.get(
  "/preferences",
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.notificationPreference.findMany({ where: { userId: req.user!.id } });
    const byType = new Map(existing.map((p) => [p.type, p]));

    const missing = ALL_TYPES.filter((t) => !byType.has(t));
    if (missing.length > 0) {
      await prisma.notificationPreference.createMany({
        data: missing.map((type) => ({
          userId: req.user!.id,
          type,
          emailEnabled: DEFAULT_EMAIL_ENABLED[type] ?? false,
          slackEnabled: false,
        })),
        skipDuplicates: true,
      });
    }

    const preferences = await prisma.notificationPreference.findMany({ where: { userId: req.user!.id } });
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
