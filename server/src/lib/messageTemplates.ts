/** Shared display helper for the app's draft-related code. Every
 *  EmailQueueItem/Conversation starts with an empty body/subject -- the only
 *  thing that ever fills one in is the real AI-personalized draft from
 *  POST /api/email-queue/:id/generate-draft (email-queue.routes.ts) or the
 *  LinkedIn equivalent, both via drafting/promptBuilder.ts, never a
 *  hardcoded template. */

/** The dashboard's "service" tag shown on a lead card / email-queue item /
 *  conversation thread. Centralized here because six call sites across
 *  lead.routes.ts, email-queue.routes.ts, and conversation.routes.ts used to
 *  duplicate this exact fallback chain inline. */
export function candidateRoleOf(services: string[] | null | undefined, targetLanguage: string | null | undefined): string {
  return (services && services.length > 0 ? services.join(", ") : "") || targetLanguage?.trim() || "Freelance Linguist";
}

