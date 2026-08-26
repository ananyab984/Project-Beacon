/** Name/language helpers shared by the app's draft-related code. Every
 *  EmailQueueItem/Conversation now starts with an empty body/subject --
 *  the only thing that ever fills one in is the real AI-personalized draft
 *  from POST /api/email-queue/:id/generate-draft (email-queue.routes.ts) or
 *  the LinkedIn equivalent, both via the drafting service's grounded LLM
 *  prompt (prompts/prompt_builder.py), never a hardcoded template. */

// displayName is the enrichment-verified name (set once identityResolved) --
// it takes priority over firstName/fullName, which are just whatever was
// typed at Add-Lead time and can be a typo, nickname, or approximation.
function firstNameOf(fullName: string | null, firstName: string | null, displayName?: string | null): string {
  if (displayName?.trim()) return displayName.trim().split(/\s+/)[0];
  if (firstName?.trim()) return firstName.trim();
  if (fullName?.trim()) return fullName.trim().split(/\s+/)[0];
  return "there";
}

/** Returns null when no real language is known, rather than a placeholder
 *  word -- callers must phrase the sentence to read naturally either way
 *  (e.g. "freelance linguists" vs "freelance {language} linguists"), never
 *  "freelance Linguist linguists". */
function languageOf(sourceLanguage: string | null, targetLanguage: string | null): string | null {
  return targetLanguage?.trim() || sourceLanguage?.trim() || null;
}

/** The dashboard's "service" tag shown on a lead card / email-queue item /
 *  conversation thread. Centralized here because six call sites across
 *  lead.routes.ts, email-queue.routes.ts, and conversation.routes.ts used to
 *  duplicate this exact fallback chain inline. */
export function candidateRoleOf(services: string[] | null | undefined, targetLanguage: string | null | undefined): string {
  return (services && services.length > 0 ? services.join(", ") : "") || targetLanguage?.trim() || "Freelance Linguist";
}

interface NameAndLanguageLead {
  fullName: string | null;
  firstName: string | null;
  displayName?: string | null;
  sourceLanguage: string | null;
  targetLanguage: string | null;
}

export function buildLinkedInDraft(lead: NameAndLanguageLead): { body: string } {
  const name = firstNameOf(lead.fullName, lead.firstName, lead.displayName);
  const language = languageOf(lead.sourceLanguage, lead.targetLanguage);
  const rolePhrase = language ? `freelance Native ${language}` : "freelance linguist";

  return {
    body:
      `Hi ${name},\n\n` +
      `We're urgently looking for a ${rolePhrase} to join us at Global3. ` +
      `For more information about our team and services, please visit global3.io.\n\n` +
      `If you're interested in this opportunity, you can apply through our application form here: https://app.global3.io/apply`,
  };
}
