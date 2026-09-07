import type { Lead } from "@prisma/client";

/** First present value among candidate keys on a raw Parallel LeadProfile
 * payload (see enrichment_pipeline/providers/parallel_client.py). */
function firstOf(raw: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  }
  return undefined;
}

/** The greeting name for this lead.
 *
 * `Lead.firstName` is only ever populated at Add-Lead time when a recruiter
 * typed one -- enrichment writes the resolved name to `displayName` (the
 * schema's dedicated slot for "the real, verified name") and never
 * back-fills `firstName`. Confirmed live 2026-09-07: 28 of 30 real leads had
 * `firstName: null`, so drafting's own `fromRecord` fell through to its
 * literal "there" placeholder. The model still greeted correctly ("Hi
 * Alex,") by mining the name from other facts, but the evaluator's
 * required-elements check looks for `firstName` in the opening -- so it
 * scanned for the word "there", failed, and put 9 of 10 otherwise-good
 * drafts on HOLD with MISSING_REQUIRED_ELEMENTS.
 *
 * Deriving it here (rather than in `fromRecord`) keeps the fallback chain in
 * one place: the Prisma row is the only thing that knows displayName exists.
 * `fromRecord`'s "there" fallback stays as the last resort for a genuinely
 * nameless record. */
function greetingFirstName(lead: Lead): string | null {
  const explicit = (lead.firstName || "").trim();
  if (explicit) return explicit;
  // displayName before fullName: displayName is what enrichment verified,
  // fullName is the audit trail of whatever was typed at Add-Lead.
  const resolved = (lead.displayName || lead.fullName || "").trim();
  if (!resolved) return null;
  const first = resolved.split(/\s+/)[0];
  // An ALL-CAPS scrape ("MARIE-ANNE HAASSER") reads as shouting in a
  // greeting; title-case it. A name that's already mixed case is left
  // exactly as its owner writes it (e.g. "ananth", "McPherson").
  return first === first.toUpperCase() && first.length > 1
    ? first.charAt(0) + first.slice(1).toLowerCase()
    : first;
}

/** Builds the `lead` object sent to drafting_service's POST /draft, shared by
 * the email and LinkedIn generate-draft routes so both channels always draft
 * on the same material. Previously duplicated inline in both route files,
 * which is how the LinkedIn route ended up missing Headline/About_Snippet/
 * Current_Title/Tools_Software/Certifications entirely -- one definition now.
 *
 * `emailOverride` lets the email route substitute a manually-typed TO address
 * when the lead has none on file yet (see email-queue.routes.ts).
 */
export function buildDraftLeadPayload(lead: Lead, emailOverride?: string | null) {
  const parallelData = (lead.parallelData as Record<string, any> | null) || null;

  return {
    First_Name: greetingFirstName(lead),
    // Falls back the same way First_Name does. displayName is the verified
    // name and fullName is null on most real rows, and drafting uses
    // Full_Name to recognise (and refuse to credit) the lead's OWN name as a
    // "named detail" -- leaving it null let a two-token name like
    // "Ruturaaj k" score as though it were an employer.
    Full_Name: lead.fullName || lead.displayName,
    Country_of_Residence: lead.country,
    Source: lead.source,
    Profile_Link: lead.profileLink,
    Email_Address: emailOverride ?? lead.email,
    Services: lead.services.join(", "),
    Source_Language: lead.sourceLanguage,
    Target_Language: lead.targetLanguage,
    Secondary_Languages: lead.secondaryLanguages.join(", "),
    Years_of_Exp: lead.yearsOfExperience ? lead.yearsOfExperience.toNumber() : null,
    Vendor_Experience: lead.vendorExperience,
    Enrichment_Status: lead.enrichmentStatus,
    Headline: lead.headline,
    About_Snippet: lead.aboutSnippet,
    Current_Title: lead.currentTitle,
    Tools_Software: lead.toolsSoftware.join(", "),
    Certifications: lead.certifications.join(", "),
    // Named, cleanly-typed views into Parallel's raw LeadProfile -- these
    // feed the structured grounding facts (recent_experience, education,
    // etc.) in drafting's leads.ts.
    Parallel_Experience: parallelData ? firstOf(parallelData, ["experience"]) : undefined,
    Parallel_Education: parallelData ? firstOf(parallelData, ["education"]) : undefined,
    Parallel_Languages: parallelData ? firstOf(parallelData, ["languages"]) : undefined,
    // The ENTIRE raw Parallel payload, verbatim, on top of the curated views
    // above -- nothing pre-filtered out. Whatever wasn't anticipated by the
    // named fields is still here for the model to mine if it's useful,
    // rather than a code-level decision in advance about what counts as
    // "relevant."
    Parallel_Full_Data: parallelData ?? undefined,
    // Same "nothing dropped" principle extended to the primary scrape
    // source (Bright Data for LinkedIn, Tavily for ProZ/ATA/etc.) -- was
    // previously computed for internal LLM-fallback verification only and
    // discarded before ever reaching drafting.
    Raw_Scrape_Data: (lead.rawScrapeData as any) ?? undefined,
  };
}
