import { prisma } from "../prisma";
import { NotificationType } from "@prisma/client";
import { UnipileService } from "./unipile.service";
import { sendSlackDm } from "./slack.service";

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

/**
 * Single funnel every notification source calls through (new lead, task
 * assignment, due-date reminder, lead-response, escalation). Writes the
 * Notification row -- which IS the in-app bell, no separate delivery step
 * needed for it -- then fires email/Slack only if the recipient has that
 * channel enabled for this notification type. Channel failures are logged,
 * never thrown: a broken Slack/email send must not roll back the
 * notification itself or the caller's own transaction.
 */
export async function createNotification(input: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });

  const [preference, recipient] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.recipientId, type: input.type } },
    }),
    prisma.user.findUnique({ where: { id: input.recipientId }, select: { email: true, slackMemberId: true } }),
  ]);

  if (preference?.emailEnabled && recipient?.email) {
    UnipileService.sendSystemEmail(recipient.email, input.title, input.body).catch((err) =>
      console.error("[notifications] system email send failed:", err)
    );
  }

  if (preference?.slackEnabled && recipient?.slackMemberId) {
    sendSlackDm(recipient.slackMemberId, `${input.title}\n${input.body}`).catch((err) =>
      console.error("[notifications] slack send failed:", err)
    );
  }

  return notification;
}
