/**
 * Async handoff for inbound webhook messages.
 *
 * Called via setImmediate() after the webhook has already responded 200,
 * so latency here never blocks Unipile's retry window.
 *
 * Currently a stub — once the FAQ matching / reply-intent classifier is
 * built, replace the placeholder below with the real call.
 */

import { prisma } from "../prisma";

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

    // -----------------------------------------------------------------------
    // TODO: Replace this stub with the real FAQ matching / reply-intent
    // classification call once it exists. Example:
    //
    //   import { classifyAndDraftReply } from "./faqMatcher";
    //   await classifyAndDraftReply({
    //     channel: msg.channel,
    //     sender: msg.sender,
    //     content: msg.content,
    //     threadId: msg.threadId,
    //   });
    //
    // For now we just log and mark processed.
    // -----------------------------------------------------------------------
    console.log(
      `[processInbound] Processing ${msg.channel} message from "${msg.sender}" (id=${msg.id}): "${msg.content.slice(0, 80)}…"`
    );

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
