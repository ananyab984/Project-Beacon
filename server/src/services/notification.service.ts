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
const REVIEW_NEEDED_COLOR = "#ECB22E"; // amber -- "needs a human decision," distinct from red ESCALATION
const PLACED_COLOR = "#2EB67D"; // green -- milestone, same "good news" family as ENRICHMENT_COMPLETE

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

/** LEAD_RESPONSE's Slack card -- a lead's inbound reply, quoted. Fired to
 *  both a subscribed recruiter and (separately) the contractor who added the
 *  lead (unipile.service.ts), so `basePath` must reflect whichever it is --
 *  previously hardcoded to "/recruiter/leads" for both. */
export function formatLeadResponseSlackCard(leadName: string, excerpt: string, basePath: string): SlackCard {
  return {
    emoji: "💬",
    headline: "You have a new message",
    color: LEAD_RESPONSE_COLOR,
    fields: [
      { label: "From", value: leadName },
      { label: "Message", value: excerpt },
    ],
    note: "Please reply in the dashboard or here if needed.",
    button: { text: "View Conversation", path: `${basePath}/leads` },
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

/** ENRICHMENT_COMPLETE's Slack card -- fires to every connected role (the
 *  contractor who added the lead, the recruiter who owns it, every owner)
 *  once it finishes enrichment (enrichment.job.ts's enrichLeadById /
 *  reenrichment.job.ts). `basePath` is the recipient's own role section --
 *  previously hardcoded to "/contractor/leads" for everyone. */
export function formatEnrichmentCompleteSlackCard(leadName: string, basePath: string): SlackCard {
  return {
    emoji: "✅",
    headline: "Enrichment finished",
    color: ENRICHMENT_COMPLETE_COLOR,
    fields: [{ label: "Lead", value: leadName }],
    note: "Their profile is now fully filled in.",
    button: { text: "View Lead", path: `${basePath}/leads` },
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
    button: { text: "View Open Requirements", path: "/contractor/requirements" },
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
    // Same destination the Slack card's button points at (or, if this
    // notification has no card, `link` itself) -- every notification that
    // can navigate somewhere gets a matching button in both channels, not
    // just Slack.
    const emailButton = input.slackCard?.button
      ? { text: input.slackCard.button.text, url: absoluteAppUrl(input.slackCard.button.path) }
      : input.link
        ? { text: "View in G3", url: absoluteAppUrl(input.link) }
        : undefined;
    UnipileService.sendSystemEmail(recipient.email, input.title, body, emailButton).catch((err) =>
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

/** Every active owner -- the fan-out target for org-wide oversight
 * notifications (enrichment complete/stalled, duplicate review, DNC
 * confirmation, lead placed, client/requirement updates, team health). */
export async function getActiveOwnerIds(): Promise<string[]> {
  const owners = await prisma.user.findMany({ where: { role: "OWNER", isActive: true }, select: { id: true } });
  return owners.map((o) => o.id);
}

/** Resolves the lead's owning recruiter the same way everywhere a
 * lead-level event needs to reach "whoever owns this lead" -- assigned
 * takes priority, then a Global-pool claim, then whoever originally sourced
 * it. Returns null if none of the three is set (a contractor-only lead with
 * no recruiter touch yet). */
export function resolveLeadOwningRecruiterId(lead: {
  assignedRecruiterId: string | null;
  claimedByRecruiterId: string | null;
  createdByRecruiterId: string | null;
}): string | null {
  return lead.assignedRecruiterId ?? lead.claimedByRecruiterId ?? lead.createdByRecruiterId ?? null;
}

export type NotificationRole = "contractor" | "recruiter" | "owner";

export interface LeadNotificationRecipient {
  recipientId: string;
  role: NotificationRole;
}

/** Each role's own section of the app -- the bell's `link` and the Slack/
 * email button must point somewhere that role can actually open (a
 * recruiter-only route isn't reachable by a contractor or owner account), so
 * every multi-role fan-out below resolves this per recipient instead of
 * sharing one hardcoded path. */
export function basePathForRole(role: NotificationRole): string {
  return role === "contractor" ? "/contractor" : role === "owner" ? "/owner" : "/recruiter";
}

/** The deduped 3-way fan-out shared by ENRICHMENT_COMPLETE, ENRICHMENT_STALLED
 * (recruiter+contractor only, see callers), DUPLICATE_REVIEW_NEEDED, and
 * LEAD_PLACED: the contractor who submitted the lead (if any), the recruiter
 * who owns it (if any), and every active owner -- each tagged with its role
 * so the caller can build a role-correct link/button per recipient. A single
 * user in more than one of those roles (e.g. an owner who's also the assigned
 * recruiter on a small team) is only notified once, keeping whichever role
 * resolved first. */
export async function resolveLeadNotificationRecipients(
  lead: {
    createdByContractorId: string | null;
    assignedRecruiterId: string | null;
    claimedByRecruiterId: string | null;
    createdByRecruiterId: string | null;
  },
  options: { includeOwners: boolean } = { includeOwners: true }
): Promise<LeadNotificationRecipient[]> {
  const recipients = new Map<string, NotificationRole>();
  if (lead.createdByContractorId) recipients.set(lead.createdByContractorId, "contractor");
  const owningRecruiterId = resolveLeadOwningRecruiterId(lead);
  if (owningRecruiterId) recipients.set(owningRecruiterId, "recruiter");
  if (options.includeOwners) {
    for (const ownerId of await getActiveOwnerIds()) {
      if (!recipients.has(ownerId)) recipients.set(ownerId, "owner");
    }
  }
  return [...recipients.entries()].map(([recipientId, role]) => ({ recipientId, role }));
}

/** DUPLICATE_REVIEW_NEEDED's Slack card -- fires instead of
 *  ENRICHMENT_COMPLETE when the dedup waterfall flags a likely match.
 *  `basePath` is the recipient's own role section (see basePathForRole) --
 *  the button must not always point at the recruiter's pages. */
export function formatDuplicateReviewSlackCard(leadName: string, reasoning: string, basePath: string): SlackCard {
  return {
    emoji: "🔍",
    headline: "Possible duplicate lead",
    color: REVIEW_NEEDED_COLOR,
    fields: [
      { label: "Lead", value: leadName },
      { label: "Why", value: reasoning },
    ],
    note: "Please review and confirm whether this is a duplicate.",
    button: { text: "Review Lead", path: `${basePath}/leads` },
  };
}

/** ENRICHMENT_STALLED's Slack card -- a lead stuck IN_PROGRESS past the
 *  timeout (stallOverdueEnrichments). Goes to contractor + owning recruiter
 *  only, never owners (see enrichment.job.ts). */
export function formatEnrichmentStalledSlackCard(leadName: string, basePath: string): SlackCard {
  return {
    emoji: "⏸️",
    headline: "Enrichment stalled",
    color: REVIEW_NEEDED_COLOR,
    fields: [{ label: "Lead", value: leadName }],
    note: "This lead's enrichment run didn't finish in time and has been marked for review.",
    button: { text: "View Lead", path: `${basePath}/leads` },
  };
}

/** DNC_CONFIRMATION_NEEDED's Slack card -- a DNC flag set provisional,
 *  awaiting human sign-off (lead.routes.ts's flags endpoint). */
export function formatDncConfirmationSlackCard(leadName: string, basePath: string): SlackCard {
  return {
    emoji: "🚫",
    headline: "DNC flag awaiting confirmation",
    color: REVIEW_NEEDED_COLOR,
    fields: [{ label: "Lead", value: leadName }],
    note: "A Do Not Contact flag was set provisionally and needs confirmation.",
    button: { text: "Review Lead", path: `${basePath}/leads` },
  };
}

/** TASK_ASSIGNMENT's Slack card when reused for a HIGH_PRIORITY flag ping
 *  (lead.routes.ts's flags endpoint) -- always a recruiter recipient, so
 *  `basePath` is always "/recruiter", but it's still a parameter rather than
 *  hardcoded so this stays consistent with every other card here. */
export function formatHighPriorityFlagSlackCard(leadName: string, basePath: string): SlackCard {
  return {
    emoji: "🔺",
    headline: "Lead marked high priority",
    color: TASK_ASSIGNMENT_COLOR,
    fields: [{ label: "Lead", value: leadName }],
    note: "This lead you're assigned to was just bumped to high priority.",
    button: { text: "View Lead", path: `${basePath}/leads` },
  };
}

/** FOLLOW_UP_DUE's Slack card -- outreach sent, no reply after N days
 *  (followup-nudge.job.ts). Nudge only: no AI draft is attached. Always a
 *  recruiter recipient (only recruiters send outreach). `link` is the exact
 *  same deep link the caller already put on `Notification.link` (it encodes
 *  the lead/step so the bell can jump straight to that lead's follow-up
 *  composer) -- passed in rather than hardcoded so Slack/email and the bell
 *  always land on the identical page. */
export function formatFollowUpDueSlackCard(leadName: string, daysSince: number, link: string): SlackCard {
  return {
    emoji: "🔔",
    headline: "Time to follow up",
    color: DUE_DATE_REMINDER_COLOR,
    fields: [
      { label: "Lead", value: leadName },
      { label: "Days since contact", value: String(daysSince) },
    ],
    note: "No reply yet -- consider sending a follow-up.",
    button: { text: "Open Email Queue", path: link },
  };
}

/** LEAD_PLACED's Slack card -- a lead reached ONBOARDED (lead.routes.ts's
 *  stage-sync block). */
export function formatLeadPlacedSlackCard(leadName: string, clientName: string | null | undefined, basePath: string): SlackCard {
  return {
    emoji: "🎉",
    headline: "Lead placed!",
    color: PLACED_COLOR,
    fields: [{ label: "Lead", value: leadName }, ...(clientName ? [{ label: "Client", value: clientName }] : [])],
    note: "This lead has been onboarded.",
    button: { text: "View Lead", path: `${basePath}/leads` },
  };
}

/** CLIENT_STATUS_UPDATE's Slack card -- a requirement's status changed for
 *  a client with notifications switched on. */
export function formatClientStatusUpdateSlackCard(clientName: string, requirementTitle: string, status: string): SlackCard {
  return {
    emoji: "📋",
    headline: `${clientName} status update`,
    color: DEMAND_SUMMARY_COLOR,
    fields: [
      { label: "Requirement", value: requirementTitle },
      { label: "Status", value: status },
    ],
    button: { text: "View Client", path: "/owner/clients" },
  };
}

/** REQUIREMENT_FULFILLED's Slack card -- a single requirement hit FULFILLED,
 *  for any client, regardless of that client's notification toggle. */
export function formatRequirementFulfilledSlackCard(clientName: string, requirementTitle: string): SlackCard {
  return {
    emoji: "✅",
    headline: "Requirement fulfilled",
    color: PLACED_COLOR,
    fields: [
      { label: "Client", value: clientName },
      { label: "Requirement", value: requirementTitle },
    ],
    button: { text: "View Client", path: "/owner/clients" },
  };
}

/** WEEKLY_TEAM_HEALTH_SUMMARY's Slack card (ownerDigest.job.ts). */
export function formatWeeklyTeamHealthSlackCard(stats: {
  teamAvgScore: number;
  fillRate: number;
  escalationCount: number;
}): SlackCard {
  return {
    emoji: "🩺",
    headline: "Your team's week in numbers",
    color: WEEKLY_SUMMARY_COLOR,
    fields: [
      { label: "Team avg. score", value: String(stats.teamAvgScore) },
      { label: "Fill rate", value: `${stats.fillRate}%` },
      { label: "Escalations this week", value: String(stats.escalationCount) },
    ],
    button: { text: "View Reports", path: "/owner/reports" },
  };
}

/** Shared by both places a Requirement's status can change --
 * lead.routes.ts's ONBOARDED headcount-sync block and requirement.routes
 * .ts's manual status PATCH -- so the client/requirement notification rules
 * (4b/4c) live in exactly one place. `previousStatus` guards
 * REQUIREMENT_FULFILLED against re-firing on a no-op edit (already
 * FULFILLED, saved again unchanged). */
export async function notifyRequirementStatusChange(
  requirement: { id: string; title: string; clientId: string; status: string },
  previousStatus: string
): Promise<void> {
  if (requirement.status === previousStatus) return;

  const client = await prisma.client.findUnique({
    where: { id: requirement.clientId },
    select: { name: true, notificationsEnabled: true },
  });
  if (!client) return;

  const ownerIds = await getActiveOwnerIds();
  if (ownerIds.length === 0) return;

  if (requirement.status === "FULFILLED") {
    await Promise.all(
      ownerIds.map((recipientId) =>
        createNotification({
          recipientId,
          type: "REQUIREMENT_FULFILLED",
          title: `Requirement fulfilled — ${requirement.title}`,
          body: `the requirement "${requirement.title}" for ${client.name} has been fully staffed.`,
          slackCard: formatRequirementFulfilledSlackCard(client.name, requirement.title),
          link: "/owner/clients",
        }).catch((err) => console.error("[notifications] requirement-fulfilled notify failed:", err))
      )
    );
    return;
  }

  if (!client.notificationsEnabled) return;
  await Promise.all(
    ownerIds.map((recipientId) =>
      createNotification({
        recipientId,
        type: "CLIENT_STATUS_UPDATE",
        title: `${client.name} — requirement status changed`,
        body: `the requirement "${requirement.title}" for ${client.name} is now ${requirement.status}.`,
        slackCard: formatClientStatusUpdateSlackCard(client.name, requirement.title, requirement.status),
        link: "/owner/clients",
      }).catch((err) => console.error("[notifications] client-status notify failed:", err))
    )
  );
}
