import { prisma } from "../prisma";
import { config } from "../config";
import { createNotification, formatDueDateReminderSlackCard } from "../services/notification.service";

/** Scans assigned, not-yet-fulfilled Requirements whose deadline falls
 *  within the configured window and reminds the assigned recruiter, once per
 *  requirement per day (dedupe: skip if a DUE_DATE_REMINDER notification for
 *  that requirement already exists since midnight). Requirement.deadline is
 *  the canonical field (not ClientDemand.deadline, a denormalized, unsynced
 *  copy after creation -- see the notification plan's schema notes).
 *  Unassigned (recruiterId: null) requirements are skipped: there's no
 *  individual recipient for them yet (see plan's open deliverable #5). */
export async function runDueDateReminders() {
  const windowEnd = new Date(Date.now() + config.dueDateReminderWindowDays * 86_400_000);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const dueRequirements = await prisma.requirement.findMany({
    where: {
      deadline: { not: null, lte: windowEnd },
      status: { not: "FULFILLED" },
      recruiterId: { not: null },
    },
    include: { client: { select: { name: true } } },
    take: 200,
  });

  for (const requirement of dueRequirements) {
    const daysLeft = Math.ceil((requirement.deadline!.getTime() - Date.now()) / 86_400_000);
    const dueText = daysLeft <= 0 ? "is overdue" : daysLeft === 1 ? "is due tomorrow" : `is due in ${daysLeft} days`;
    const title = `${requirement.title} ${dueText}`;

    // There's no per-requirement detail route to deep-link into (only the
    // /recruiter/clients list), so `link` alone can't double as a per-
    // requirement dedupe key -- match on title instead, which already
    // embeds the requirement's own name and is stable for the rest of the
    // day (daysLeft only changes once every 24h).
    const alreadySentToday = await prisma.notification.findFirst({
      where: {
        recipientId: requirement.recruiterId!,
        type: "DUE_DATE_REMINDER",
        title,
        createdAt: { gte: startOfToday },
      },
    });
    if (alreadySentToday) continue;

    await createNotification({
      recipientId: requirement.recruiterId!,
      type: "DUE_DATE_REMINDER",
      title,
      body: `the requirement "${requirement.title}" for ${requirement.client.name} ${dueText} -- ${requirement.headcountNeeded} candidate${requirement.headcountNeeded === 1 ? "" : "s"} needed in ${requirement.language} (${requirement.service}). Deadline: ${requirement.deadline!.toDateString()}.`,
      slackCard: formatDueDateReminderSlackCard(requirement, daysLeft),
      link: `/recruiter/clients`,
    }).catch((err) => console.error("[notifications] due-date reminder notify failed:", err));
  }
}
