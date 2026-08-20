/** The two approved outreach templates, verbatim per the business's exact copy.
 *  Substitutes ONLY real, already-known fields (name, language) -- never
 *  invents a rate, employer, credential, or any other fact. This is
 *  deliberately NOT an LLM call -- it's used only to pre-populate a lead's
 *  email-queue item at creation time, before real AI personalization has run.
 *  The actual personalized draft (using ALL enriched fields: years of
 *  experience, services, vendor/client experience) comes from the drafting
 *  service via POST /api/email-queue/:id/generate-draft -- see
 *  email-queue.routes.ts, which calls the Python service's grounded LLM
 *  prompt (prompts/prompt_builder.py) rather than a hardcoded phrase here. */

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

export function buildEmailDraft(lead: NameAndLanguageLead): { subject: string; body: string } {
  const name = firstNameOf(lead.fullName, lead.firstName, lead.displayName);
  const language = languageOf(lead.sourceLanguage, lead.targetLanguage);
  const linguistPhrase = language ? `freelance ${language} linguists` : "freelance linguists";

  return {
    subject: `Global3 Outreach · Freelance Partnership (${lead.displayName || lead.fullName || name})`,
    body:
      `Hi ${name},\n\n` +
      `I hope this email finds you well.\n\n` +
      `I'm reaching out from the Resource Management team at Global3. We recently reviewed your profile ` +
      `and believe your expertise would be a strong asset to our current and upcoming project pipelines.\n\n` +
      `We are actively looking to connect with talented ${linguistPhrase} who value long-term, ` +
      `meaningful collaboration over one-off tasks.\n\n` +
      `At Global3, we pride ourselves on building lasting partnerships with our global network of professionals. ` +
      `You can find more details about our mission and the scope of our work at global3.io.\n\n` +
      `If you are open to exploring a partnership, please submit your application through our portal so we can ` +
      `align your profile with relevant opportunities: https://app.global3.io/apply\n\n` +
      `Should you have any questions before applying, please feel free to reach out to us at resources@global3.io. ` +
      `We're happy to provide more information.\n\n` +
      `Best regards,\nResources Team`,
  };
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
