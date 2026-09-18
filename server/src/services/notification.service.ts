import { prisma } from "../prisma";
import { NotificationType } from "@prisma/client";
import { UnipileService } from "./unipile.service";
import { sendSlackDm } from "./slack.service";

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  /** A lowercase-starting continuation clause -- greetNotificationBody
   * prefixes this with "Hey <FirstName>, " so every notification (bell,
   * email, Slack) reads as one address directly to its recipient, not a
   * vague fragment. */
  body: string;
  link?: string;
}

/** First name only ("Ananya Sharma" -> "Ananya") -- a full-name greeting
 * reads like a form letter, and Slack/email already show who this is from. */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName || "").trim().split(/\s+/)[0];
  return first || "there";
}

/** Every notification opens the same way, everywhere it's read (bell, email,
 * Slack) -- addressed directly to its recipient rather than a vague, third-
 * person fragment. `body` must already read as a full clause starting
 * lowercase, e.g. "you've been assigned to...". */
export function greetNotificationBody(recipientName: string | null | undefined, body: string): string {
  return `Hey ${firstNameOf(recipientName)}, ${body}`;
}

/** Requirement fields formatTaskAssignmentBody needs -- kept as a narrow
 * structural type rather than importing Prisma's Requirement so this stays
 * trivially unit-testable with a plain object literal. */
export interface TaskAssignmentRequirement {
  title: string;
  language: string;
  service: string;
  region: string | null;
  headcountNeeded: number;
  priority: string;
  deadline: Date | null;
}

/** The formal, fully-detailed TASK_ASSIGNMENT body: which client, how many
 * candidates this requirement demands, in what language/service, and
 * (when set) region, priority and deadline -- shared by requirement.routes
 * .ts's create and reassign paths so the two can't drift apart. */
export function formatTaskAssignmentBody(requirement: TaskAssignmentRequirement, clientName: string): string {
  const count = `${requirement.headcountNeeded} candidate${requirement.headcountNeeded === 1 ? "" : "s"}`;
  const region = requirement.region ? `, based in ${requirement.region}` : "";
  const priority = requirement.priority !== "STANDARD" ? ` This is a ${requirement.priority.toLowerCase()}-priority requirement.` : "";
  const deadline = requirement.deadline ? ` Deadline: ${requirement.deadline.toDateString()}.` : "";
  return (
    `you've been assigned to "${requirement.title}" for ${clientName}. ` +
    `It calls for ${count} in ${requirement.language} (${requirement.service})${region}.${priority}${deadline}`
  );
}

/**
 * Single funnel every notification source calls through (task assignment,
 * due-date reminder, lead-response, escalation). Writes the Notification row
 * -- which IS the in-app bell, no separate delivery step needed for it --
 * then fires email/Slack only if the recipient has that channel enabled for
 * this notification type. Channel failures are logged, never thrown: a
 * broken Slack/email send must not roll back the notification itself or the
 * caller's own transaction.
 */
export async function createNotification(input: CreateNotificationInput) {
  const [preference, recipient] = await Promise.all([
    prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.recipientId, type: input.type } },
    }),
    prisma.user.findUnique({ where: { id: input.recipientId }, select: { email: true, slackMemberId: true, name: true } }),
  ]);

  const body = greetNotificationBody(recipient?.name, input.body);

  const notification = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      body,
      link: input.link,
    },
  });

  if (preference?.emailEnabled && recipient?.email) {
    UnipileService.sendSystemEmail(recipient.email, input.title, body).catch((err) =>
      console.error("[notifications] system email send failed:", err)
    );
  }

  if (preference?.slackEnabled && recipient?.slackMemberId) {
    sendSlackDm(recipient.slackMemberId, `${input.title}\n${body}`).catch((err) =>
      console.error("[notifications] slack send failed:", err)
    );
  }

  return notification;
}
