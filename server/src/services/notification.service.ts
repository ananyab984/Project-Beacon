import { prisma } from "../prisma";
import { NotificationType } from "@prisma/client";
import { config } from "../config";
import { UnipileService } from "./unipile.service";
import { sendSlackDm, sendSlackCard } from "./slack.service";

export interface SlackCardField {
  label: string;
  value: string;
}

/** The structured, formatted Slack DM for a notification -- a colored
 * accent bar, an emoji headline, bold label/value fields, an optional plain-
 * text note, and an optional link-out button to the exact G3 page this
 * concerns. Deliberately separate from `title`/`body` (which still drive
 * the bell and email, and stay plain-text greeting-prefixed) since Slack's
 * richer surface can show far more structure than a single sentence. */
export interface SlackCard {
  emoji: string;
  headline: string;
  /** Hex color for the attachment's left accent bar. */
  color: string;
  fields: SlackCardField[];
  note?: string;
  button?: { text: string; path: string };
}

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
  /** When set, Slack gets this formatted card instead of the plain
   * `title`/body text -- the bell and email are unaffected either way. */
  slackCard?: SlackCard;
}

/** Slack's `url` button action is a plain link-out -- no interactivity
 * endpoint/signing needed, unlike an actionId button. Absolute because
 * Slack requires a fully-qualified URL; g3's own route guard handles
 * sending a not-yet-logged-in recruiter to sign in first. */
function absoluteAppUrl(path: string): string {
  return `${config.clientUrl.replace(/\/+$/, "")}${path}`;
}

/** Renders a SlackCard into the Block Kit blocks sendSlackCard nests inside
 * the colored attachment -- the header/fields/note/button structure shown
 * in G3's reference notification mockups. */
export function buildSlackCardBlocks(card: SlackCard): unknown[] {
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `${card.emoji} *${card.headline}*` } },
  ];

  if (card.fields.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: card.fields.map((f) => `*${f.label}:* ${f.value}`).join("\n") },
    });
  }

  if (card.note) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: card.note } });
  }

  if (card.button) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: card.button.text, emoji: true },
          url: absoluteAppUrl(card.button.path),
          style: "primary",
        },
      ],
    });
  }

  return blocks;
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

// Slack's own 4-color brand palette, reused so each notification family has
// a stable, distinct accent bar (pink is reserved for LEAD_RESPONSE below).
const TASK_ASSIGNMENT_COLOR = "#2EB67D"; // green
const BULK_ASSIGNMENT_COLOR = "#36C5F0"; // blue
const DUE_DATE_REMINDER_COLOR = "#8B5CF6"; // purple
const LEAD_RESPONSE_COLOR = "#E01E5A"; // pink
const ESCALATION_COLOR = "#E11D48"; // red -- deliberately distinct from LEAD_RESPONSE's pink
const ENRICHMENT_COMPLETE_COLOR = "#2EB67D"; // green -- same family as TASK_ASSIGNMENT, both "good news"
const DEMAND_SUMMARY_COLOR = "#36C5F0"; // blue -- matches BULK_ASSIGNMENT's "FYI digest" tone
const WEEKLY_SUMMARY_COLOR = "#8B5CF6"; // purple -- matches DUE_DATE_REMINDER's periodic-digest tone

/** TASK_ASSIGNMENT's Slack card. Headcount > 1 reads as a bulk assignment
 * (different emoji/color/copy) rather than a second notification type --
 * same underlying event, just enough candidates that "you've been assigned
 * a task" undersells it. */
export function formatTaskAssignmentSlackCard(requirement: TaskAssignmentRequirement): SlackCard {
  const count = requirement.headcountNeeded;
  const isBulk = count > 1;
  const fields: SlackCardField[] = [
    { label: "Task", value: requirement.title },
    { label: "Language", value: requirement.language },
    { label: "Type", value: requirement.service },
    { label: "Candidates", value: String(count) },
  ];
  if (requirement.priority !== "STANDARD") fields.push({ label: "Priority", value: requirement.priority });
  if (requirement.deadline) fields.push({ label: "Deadline", value: requirement.deadline.toDateString() });

  const priorityNote = requirement.priority !== "STANDARD" ? ` This is a ${requirement.priority.toLowerCase()}-priority requirement.` : "";
  return {
    emoji: isBulk ? "📋" : "📣",
    headline: isBulk ? "New bulk assignment" : "You've been assigned a new task!",
    color: isBulk ? BULK_ASSIGNMENT_COLOR : TASK_ASSIGNMENT_COLOR,
    fields,
    note: isBulk ? `You've been assigned ${count} candidates.${priorityNote}` : "Please check the dashboard for more details.",
    button: { text: isBulk ? "View Client" : "View Task", path: "/recruiter/clients" },
  };
}

/** DUE_DATE_REMINDER's Slack card. `daysLeft` matches the same calculation
 * due-date-reminder.job.ts already makes for its title's "is overdue" /
 * "is due tomorrow" / "is due in N days" wording. */
export function formatDueDateReminderSlackCard(requirement: TaskAssignmentRequirement, daysLeft: number): SlackCard {
  const urgency = daysLeft <= 0 ? "(overdue)" : daysLeft === 1 ? "(due tomorrow)" : `(in ${daysLeft} days)`;
  return {
    emoji: "⏰",
    headline: "Task reminder",
    color: DUE_DATE_REMINDER_COLOR,
    fields: [
      { label: "Task", value: requirement.title },
      { label: "Language", value: requirement.language },
      { label: "Type", value: requirement.service },
      { label: "Candidates", value: String(requirement.headcountNeeded) },
      { label: "Deadline", value: `${requirement.deadline ? requirement.deadline.toDateString() : "—"} ${urgency}` },
    ],
    note: daysLeft <= 0 ? "This task is overdue -- please follow up as soon as possible." : "Just a reminder that this task is due soon.",
    button: { text: "Open Task", path: "/recruiter/clients" },
  };
}

/** LEAD_RESPONSE's Slack card -- a lead's inbound reply, quoted. */
export function formatLeadResponseSlackCard(leadName: string, excerpt: string): SlackCard {
  return {
    emoji: "💬",
    headline: "You have a new message",
    color: LEAD_RESPONSE_COLOR,
    fields: [
      { label: "From", value: leadName },
      { label: "Message", value: excerpt },
    ],
    note: "Please reply in the dashboard or here if needed.",
    button: { text: "View Conversation", path: "/recruiter/leads" },
  };
}

/** ESCALATION's Slack card -- shared by all three escalation.job.ts scan
 * types (SLA breach, stale on-hold lead, email-queue backlog), each of
 * which already computes its own title/detail/recommendedAction. */
export function formatEscalationSlackCard(title: string, detail: string, recommendedAction: string, buttonPath: string): SlackCard {
  return {
    emoji: "⚠️",
    headline: title,
    color: ESCALATION_COLOR,
    fields: [{ label: "Detail", value: detail }],
    note: recommendedAction,
    button: { text: "View Details", path: buttonPath },
  };
}

/** ENRICHMENT_COMPLETE's Slack card -- fires once, when a lead a contractor
 *  added finishes enrichment (enrichment.job.ts's enrichLeadById). */
export function formatEnrichmentCompleteSlackCard(leadName: string): SlackCard {
  return {
    emoji: "✅",
    headline: "Enrichment finished",
    color: ENRICHMENT_COMPLETE_COLOR,
    fields: [{ label: "Lead", value: leadName }],
    note: "Their profile is now fully filled in.",
    button: { text: "View Lead", path: "/contractor/leads" },
  };
}

/** DAILY_DEMAND_SUMMARY's Slack card -- one broadcast a day to every
 *  contractor, not lead- or requirement-specific, so it has no button. */
export function formatDailyDemandSummarySlackCard(openHeadcount: number, openRequirements: number): SlackCard {
  return {
    emoji: "📊",
    headline: "Today's open demand",
    color: DEMAND_SUMMARY_COLOR,
    fields: [
      { label: "Open requirements", value: String(openRequirements) },
      { label: "Total headcount still needed", value: String(openHeadcount) },
    ],
    note: "Keep sourcing toward these.",
  };
}

/** WEEKLY_LEADS_SUMMARY's Slack card. */
export function formatWeeklyLeadsSummarySlackCard(leadsAdded: number): SlackCard {
  return {
    emoji: "🗓️",
    headline: "Your week in leads",
    color: WEEKLY_SUMMARY_COLOR,
    fields: [{ label: "Leads added this week", value: String(leadsAdded) }],
    button: { text: "View My Leads", path: "/contractor/leads" },
  };
}

/** WEEKLY_PERFORMANCE_SUMMARY's Slack card -- the same live pipeline numbers
 *  performance-page-view.tsx shows (see contractorDigest.job.ts), not the
 *  monthly rubric score (different cadence, computed separately). */
export function formatWeeklyPerformanceSummarySlackCard(stats: {
  active: number;
  activePct: number;
  unreadConversations: number;
  followUps: number;
}): SlackCard {
  return {
    emoji: "📈",
    headline: "Your week in numbers",
    color: WEEKLY_SUMMARY_COLOR,
    fields: [
      { label: "Active leads", value: `${stats.active} (${stats.activePct}%)` },
      { label: "Unread replies", value: String(stats.unreadConversations) },
      { label: "Follow-ups pending", value: String(stats.followUps) },
    ],
    button: { text: "View My Performance", path: "/contractor/performance" },
  };
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
    if (input.slackCard) {
      sendSlackCard(
        recipient.slackMemberId,
        input.slackCard.color,
        buildSlackCardBlocks(input.slackCard),
        input.title
      ).catch((err) => console.error("[notifications] slack send failed:", err));
    } else {
      sendSlackDm(recipient.slackMemberId, `${input.title}\n${body}`).catch((err) =>
        console.error("[notifications] slack send failed:", err)
      );
    }
  }

  return notification;
}
