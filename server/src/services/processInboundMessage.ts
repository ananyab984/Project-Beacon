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

/** Resolves the Lead a given inbound message belongs to, via the
 * Conversation whose unipileChatId matches the message's threadId -- the
 * same correlation Unipile's own webhook handler already relies on (see
 * unipile.service.ts's `prisma.conversation.findUnique({ where: {
 * unipileChatId } })` lookup). Returns null if no conversation matches
 * (nothing to classify against). */
export async function resolveLeadIdForInboundMessage(msg: { channel: string; threadId: string | null }): Promise<string | null> {
  if (!msg.threadId) return null;
  const conversation = await prisma.conversation.findUnique({ where: { unipileChatId: msg.threadId } });
  return conversation?.leadId ?? null;
}

/** Applies one classification attempt's outcome to a Lead and always logs
 * a ReplyClassificationEvent, per the override-preservation rule described
 * in the module doc comment above. */
export async function applyClassificationResult(leadId: string, result: ClassificationResult | null): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { replyClassificationSource: true } });
  if (!lead) return;

  await prisma.replyClassificationEvent.create({
    data: {
      leadId,
      categoryId: result?.categoryId ?? null,
      confidence: result?.confidence ?? null,
      source: "AUTO",
    },
  });

  const isConfident = result !== null;
  const priorWasManual = lead.replyClassificationSource === "MANUAL";

  if (!isConfident && priorWasManual) {
    return; // a human override survives an ambiguous/unrelated follow-up reply
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      replyCategoryId: result?.categoryId ?? null,
      replyClassificationSource: "AUTO",
      replyClassifiedAt: new Date(),
    },
  });
}

export async function processInboundMessage(inboundMessageId: string): Promise<void> {
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

    try {
      const leadId = await resolveLeadIdForInboundMessage({ channel: msg.channel, threadId: msg.threadId });
      if (!leadId) {
        console.log(`[processInbound] No matching conversation/lead for InboundMessage ${inboundMessageId} — skipping classification.`);
      } else {
        const categories = await prisma.replyCategory.findMany({ where: { isActive: true } });
        const draftingConfig = loadDraftingConfig();
        const groqClient = new GroqClient(draftingConfig);
        const result = await classifyReply(groqClient, msg.content, categories);
        await applyClassificationResult(leadId, result);
        console.log(`[processInbound] Classified InboundMessage ${inboundMessageId} for lead ${leadId}: ${result ? `${result.categoryId} (${result.confidence})` : "Unclassified"}`);
      }
    } catch (classifyErr: any) {
      // Classification failure must never block marking the message
      // processed -- matches this function's existing error-isolation
      // contract (see the outer try/catch below).
      console.error(`[processInbound] Classification failed for InboundMessage ${inboundMessageId}:`, classifyErr?.message || classifyErr);
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
