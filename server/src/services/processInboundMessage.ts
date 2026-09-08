/**
 * Async handoff for inbound webhook messages.
 *
 * Called via setImmediate() after the webhook has already responded 200,
 * so latency here never blocks Unipile's retry window.
 *
 * Classifies the reply against the owner-managed ReplyCategory list (see
 * replyClassifier.ts) and updates the originating Lead's current
 * classification state, subject to the override-preservation rule: a
 * confident result always wins; a low-confidence/unclassified result only
 * overwrites a Lead whose current source is AUTO or unset, never MANUAL.
 */

import { prisma } from "../prisma";
import { GroqClient } from "../drafting/groqClient";
import { loadDraftingConfig } from "../drafting/config";
import { classifyReply, ClassificationResult } from "../lib/replyClassifier";

// A lead often splits one reply across several quick back-to-back messages
// ("Hi!" / "quick question" / "what's your hourly rate?") before the
// recruiter answers -- classifying each in isolation means the early
// fragments come back Unclassified and only the last one lands correctly.
// Bounds how many of those PRIOR unanswered messages get pulled into one
// classification call (the DB read, not the token budget -- classifyReply's
// own MAX_MESSAGE_CHARS is the single source of truth for the final prompt
// size cap, applied after these are joined).
const MAX_CONTEXT_MESSAGES = 5;

/** Resolves the Conversation (and its Lead) a given inbound message belongs
 * to, via the Conversation whose unipileChatId matches the message's
 * threadId -- the same correlation Unipile's own webhook handler already
 * relies on (see unipile.service.ts's `prisma.conversation.findUnique({
 * where: { unipileChatId } })` lookup). Returns null if no conversation
 * matches (nothing to classify against). */
export async function resolveConversationForInboundMessage(msg: { threadId: string | null }): Promise<{ id: string; leadId: string } | null> {
  if (!msg.threadId) return null;
  const conversation = await prisma.conversation.findUnique({
    where: { unipileChatId: msg.threadId },
    select: { id: true, leadId: true },
  });
  return conversation ?? null;
}

/** Thin wrapper kept for callers (and existing tests) that only need the
 * leadId, not the full conversation. */
export async function resolveLeadIdForInboundMessage(msg: { channel: string; threadId: string | null }): Promise<string | null> {
  const conversation = await resolveConversationForInboundMessage(msg);
  return conversation?.leadId ?? null;
}

/** Builds the text to classify: the current inbound message combined with
 * any earlier THEM (candidate) messages sent in the same conversation since
 * the recruiter's last reply, oldest first. If the recruiter has never
 * replied yet, every prior THEM message counts as part of the same
 * unanswered burst. The current message is excluded from the "prior"
 * query by timestamp (its own ConversationMessage row, if already synced
 * by the time this runs, would otherwise be double-counted). */
export async function buildClassificationText(
  conversationId: string,
  currentMessageText: string,
  currentMessageReceivedAt: Date
): Promise<string> {
  const lastOwnMessage = await prisma.conversationMessage.findFirst({
    where: { conversationId, sender: "ME" },
    orderBy: { sentAt: "desc" },
  });

  const sentAtFilter: { lt: Date; gt?: Date } = { lt: currentMessageReceivedAt };
  if (lastOwnMessage) sentAtFilter.gt = lastOwnMessage.sentAt;

  const priorTheirMessages = await prisma.conversationMessage.findMany({
    where: { conversationId, sender: "THEM", sentAt: sentAtFilter },
    orderBy: { sentAt: "asc" },
    take: MAX_CONTEXT_MESSAGES,
  });

  return [...priorTheirMessages.map((m) => m.text), currentMessageText].join("\n\n---\n\n");
}

/** Applies one classification attempt's outcome to a Lead and always logs
 * a ReplyClassificationEvent, per the override-preservation rule described
 * in the module doc comment above. */
export async function applyClassificationResult(leadId: string, result: ClassificationResult | null): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { replyClassificationSource: true } });
  if (!lead) return;

  const isConfident = result !== null;
  const priorWasManual = lead.replyClassificationSource === "MANUAL";
  // a human override survives an ambiguous/unrelated follow-up reply -- the
  // attempt is still logged as an event, the Lead just isn't touched.
  const shouldUpdateLead = isConfident || !priorWasManual;

  // The event insert and the Lead's denormalized classification fields must
  // land together (design spec Component 6): the event table is the source of
  // truth for those fields, so a half-applied pair would leave them drifted.
  await prisma.$transaction(async (tx) => {
    await tx.replyClassificationEvent.create({
      data: {
        leadId,
        categoryId: result?.categoryId ?? null,
        confidence: result?.confidence ?? null,
        source: "AUTO",
      },
    });

    if (!shouldUpdateLead) return;

    await tx.lead.update({
      where: { id: leadId },
      data: {
        replyCategoryId: result?.categoryId ?? null,
        replyClassificationSource: "AUTO",
        replyClassifiedAt: new Date(),
      },
    });
  });
}

/**
 * @param isOutbound true when this row is Unipile's echo of the recruiter's
 *   OWN sent message rather than a candidate reply. Unipile delivers those
 *   through the same webhook and unipile.service.ts deliberately stores them
 *   as InboundMessage rows (load-bearing for the self-echo chat-id backfill),
 *   so this flag is the only way to tell the two apart here -- it is NOT
 *   persisted on the row. Classifying an echo would treat our own outreach
 *   text as the candidate's answer, and a confident match would then silently
 *   overwrite a human's MANUAL override.
 */
export async function processInboundMessage(inboundMessageId: string, isOutbound?: boolean): Promise<void> {
  try {
    const msg = await prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });

    if (!msg) {
      console.warn(`[processInbound] InboundMessage ${inboundMessageId} not found — skipping.`);
      return;
    }

    if (msg.processed) {
      console.log(`[processInbound] InboundMessage ${inboundMessageId} already processed — skipping.`);
      return;
    }

    console.log(
      `[processInbound] Processing ${msg.channel} message from "${msg.sender}" (id=${msg.id}): "${msg.content.slice(0, 80)}…"`
    );

    if (isOutbound === true) {
      // Mirrors the same gate unipile.service.ts already applies before
      // syncing a ConversationMessage (`if (conversation && !isOutbound)`).
      // Still falls through to `processed: true` below so the row's existing
      // lifecycle is unchanged.
      console.log(
        `[processInbound] InboundMessage ${inboundMessageId} is an outbound echo, not a candidate reply — skipping classification.`
      );
    } else {
      try {
        const conversation = await resolveConversationForInboundMessage({ threadId: msg.threadId });
        if (!conversation) {
          console.log(`[processInbound] No matching conversation/lead for InboundMessage ${inboundMessageId} — skipping classification.`);
        } else {
          const { id: conversationId, leadId } = conversation;
          const categories = await prisma.replyCategory.findMany({ where: { isActive: true } });
          const classificationText = await buildClassificationText(conversationId, msg.content, msg.receivedAt);
          const draftingConfig = loadDraftingConfig();
          const groqClient = new GroqClient(draftingConfig);
          const result = await classifyReply(groqClient, classificationText, categories);
          await applyClassificationResult(leadId, result);
          console.log(`[processInbound] Classified InboundMessage ${inboundMessageId} for lead ${leadId}: ${result ? `${result.categoryId} (${result.confidence})` : "Unclassified"}`);
        }
      } catch (classifyErr: any) {
        // Classification failure must never block marking the message
        // processed -- matches this function's existing error-isolation
        // contract (see the outer try/catch below). This is the ONLY place a
        // silent classification outage (bad GROQ_MODEL, expired key, Groq
        // outage) becomes visible, so the tag below is deliberately unique
        // and greppable/alertable: `CLASSIFICATION_FAILED`.
        console.error(
          `[processInbound] CLASSIFICATION_FAILED for InboundMessage ${inboundMessageId} — reply left unclassified (message still marked processed):`,
          classifyErr?.message || classifyErr
        );
      }
    }

    await prisma.inboundMessage.update({
      where: { id: inboundMessageId },
      data: { processed: true },
    });

    console.log(`[processInbound] Marked InboundMessage ${inboundMessageId} as processed.`);
  } catch (err: any) {
    // Fire-and-forget: log but never throw — this runs after the HTTP
    // response is already sent, so there's nobody to catch it.
    console.error(`[processInbound] Failed to process InboundMessage ${inboundMessageId}:`, err?.message || err);
  }
}
