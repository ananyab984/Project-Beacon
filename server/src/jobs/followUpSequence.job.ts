import { prisma } from "../prisma";
import { config } from "../config";
import { getDraftingOrchestrator } from "../drafting/instance";
import { buildDraftLeadPayload } from "../lib/draftLeadPayload";
import { UnipileService } from "../services/unipile.service";
import { createNotification, formatFollowUpSequenceSlackCard } from "../services/notification.service";
import { getSystemSetting } from "../services/system-settings.service";

const MAX_EXECUTIONS_PER_RUN = 50;
const BATCH_DELAY_MS = 1000;

/**
 * Processes pending follow-up executions.
 * Runs every minute via cron.
 */
export async function processFollowUpSequences() {
  const now = new Date();

  // Find pending executions that are due
  const pendingExecutions = await prisma.followUpExecution.findMany({
    where: {
      status: "PENDING",
      OR: [
        { scheduledAt: { lte: now } },
        { scheduledAt: null }, // immediate execution
      ],
      step: {
        isActive: true,
        sequence: { status: "ACTIVE" },
      },
      lead: { deletedAt: null },
    },
    include: {
      step: {
        include: {
          sequence: true,
        },
      },
      lead: true,
      recruiter: true,
    },
    take: MAX_EXECUTIONS_PER_RUN,
    orderBy: { createdAt: "asc" },
  });

  if (pendingExecutions.length === 0) return;

  console.log(`[follow-up-sequence] Processing ${pendingExecutions.length} pending executions`);

  for (const execution of pendingExecutions) {
    try {
      await processExecution(execution);
    } catch (err: any) {
      console.error(`[follow-up-sequence] Failed to process execution ${execution.id}:`, err?.message || err);
      await prisma.followUpExecution.update({
        where: { id: execution.id },
        data: { status: "FAILED", error: err?.message || String(err) },
      });
    }

    // Small delay between executions to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
  }
}

/**
 * Process a single execution: render template, AI-draft if enabled, send via Unipile
 */
async function processExecution(execution: any) {
  const { step, lead, recruiter } = execution;

  // Check if lead has replied since enrollment (for TIME_BASED triggers)
  if (step.triggerType === "TIME_BASED") {
    const recentReply = await prisma.interactionEvent.findFirst({
      where: {
        leadId: lead.id,
        direction: "INBOUND",
        occurredAt: { gte: execution.createdAt },
      },
    });
    if (recentReply) {
      // Lead replied - mark as skipped and don't send
      await prisma.followUpExecution.update({
        where: { id: execution.id },
        data: { status: "SKIPPED", error: "Lead replied since enrollment" },
      });
      return;
    }
  }

  // The query filters deleted leads, but a lead can be deleted between claim and send.
  const current = await prisma.lead.findUnique({ where: { id: lead.id }, select: { deletedAt: true } });
  if (current?.deletedAt) return;

  // Check DNC flag
  if (lead.flags.includes("DNC")) {
    await prisma.followUpExecution.update({
      where: { id: execution.id },
      data: { status: "SKIPPED", error: "Lead has DNC flag" },
    });
    return;
  }

  // Build the message content
  let subject: string | undefined;
  let body: string;

  if (step.useAiDraft) {
    // Use AI drafting pipeline
    const draftingOrchestrator = getDraftingOrchestrator();
    const leadPayload = buildDraftLeadPayload(lead);
    const applyUrl = `${config.clientUrl}/onboarding/${lead.id}`; // Short link

    try {
      const result = await draftingOrchestrator.processDraft(
        leadPayload,
        step.channel.toLowerCase(),
        false,
        applyUrl
      );

      subject = result.subject ?? undefined;
      body = result.body;

      // If AI drafting failed or returned INELIGIBLE, fall back to template
      if (result.verdict === "INELIGIBLE" || !body.trim()) {
        throw new Error("AI drafting ineligible, falling back to template");
      }
    } catch (aiErr) {
      console.warn(`[follow-up-sequence] AI drafting failed for execution ${execution.id}, using template:`, (aiErr as Error)?.message || aiErr);
      subject = renderTemplate(step.subjectTemplate, lead, recruiter);
      body = renderTemplate(step.bodyTemplate, lead, recruiter);
    }
  } else {
    // Use plain template
    subject = renderTemplate(step.subjectTemplate, lead, recruiter);
    body = renderTemplate(step.bodyTemplate, lead, recruiter);
  }

  // Send via Unipile
  let interactionEventId: string | undefined;

  if (step.channel === "EMAIL") {
    if (!lead.email) {
      throw new Error("Lead has no email address");
    }
    const replyToMessageId = await findReplyAnchor(lead.id, recruiter.id);
    const replySubject = subject || `Re: Follow-up on ${lead.fullName || "your application"}`;

    const result = await UnipileService.sendEmail(
      recruiter.id,
      lead.id,
      lead.email,
      replySubject,
      body,
      undefined, // preferredAccountId
      replyToMessageId
    );
    interactionEventId = result.eventId;
  } else if (step.channel === "LINKEDIN") {
    if (!lead.profileLink) {
      throw new Error("Lead has no LinkedIn profile link");
    }

    const result = await UnipileService.sendLinkedInMessage(
      recruiter.id,
      lead.id,
      lead.profileLink,
      body
    );
    interactionEventId = result.eventId;
  }

  // Update execution as sent
  await prisma.followUpExecution.update({
    where: { id: execution.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      subject,
      body,
      interactionEventId,
    },
  });

  // Notify recruiter
  const leadName = lead.displayName || lead.fullName || lead.maskedLabel || "this lead";
  await createNotification({
    recipientId: recruiter.id,
    type: "FOLLOW_UP_SEQUENCE_STEP",
    title: `Follow-up sent to ${leadName}`,
    body: `Step ${step.stepOrder} of "${step.sequence.name}" sent via ${step.channel}.`,
    slackCard: formatFollowUpSequenceSlackCard(leadName, step.sequence.name, step.stepOrder, step.channel, `/recruiter/conversations?leadId=${lead.id}`),
    link: `/recruiter/conversations?leadId=${lead.id}`,
  });

  // Check if this was the last step - if so, notify completion
  const totalSteps = await prisma.followUpStep.count({
    where: { sequenceId: step.sequenceId, isActive: true },
  });
  if (step.stepOrder >= totalSteps) {
    const remainingPending = await prisma.followUpExecution.count({
      where: { leadId: lead.id, step: { sequenceId: step.sequenceId }, status: "PENDING" },
    });
    if (remainingPending === 0) {
      await createNotification({
        recipientId: recruiter.id,
        type: "FOLLOW_UP_SEQUENCE_COMPLETED",
        title: `Follow-up sequence completed for ${leadName}`,
        body: `All steps of "${step.sequence.name}" have been sent.`,
        link: `/recruiter/leads/${lead.id}`,
      });
    }
  }
}

/**
 * Render a template with lead/recruiter variables
 */
function renderTemplate(template: string | undefined | null, lead: any, recruiter: any): string {
  if (!template) return "";

  return template
    .replace(/\{\{lead\.fullName\}\}/g, lead.fullName || "")
    .replace(/\{\{lead\.displayName\}\}/g, lead.displayName || lead.fullName || "")
    .replace(/\{\{lead\.firstName\}\}/g, lead.firstName || lead.fullName?.split(" ")[0] || "")
    .replace(/\{\{lead\.email\}\}/g, lead.email || "")
    .replace(/\{\{lead\.targetLanguage\}\}/g, lead.targetLanguage || "")
    .replace(/\{\{lead\.services\}\}/g, lead.services?.join(", ") || "")
    .replace(/\{\{recruiter\.name\}\}/g, recruiter.name || "")
    .replace(/\{\{applyUrl\}\}/g, `${config.clientUrl}/onboarding/${lead.id}`);
}

/**
 * Find the latest inbound message ID for threading replies
 */
async function findReplyAnchor(leadId: string, recruiterId: string): Promise<string | undefined> {
  const latestReply = await prisma.conversationMessage.findFirst({
    where: { conversation: { leadId, recruiterId, channel: "EMAIL" }, sender: "THEM" },
    orderBy: { sentAt: "desc" },
    select: { externalMessageId: true },
  });
  return latestReply?.externalMessageId ?? undefined;
}