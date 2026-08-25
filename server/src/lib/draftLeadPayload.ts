import type { Lead } from "@prisma/client";

/** First present value among candidate keys on a raw Clay payload -- field
 * names vary depending on which Clay action produced the data (confirmed
 * against real captured payloads this session: the "Enrich person" waterfall
 * uses `experience`/`education`/`languages`/`courses`/`projects`/
 * `current_experience`; an earlier AI-agent column used `pastRoles`/
 * `currentRoles`/`latest_experience` instead).
 */
function firstOf(raw: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  }
  return undefined;
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
  const clayData = (lead.clayData as Record<string, any> | null) || null;

  return {
    First_Name: lead.firstName,
    Full_Name: lead.fullName,
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
    // Named, cleanly-typed views into Clay's raw data -- these feed the
    // structured grounding facts (recent_experience, education, etc.) in
    // drafting_service's core/leads.py.
    Clay_Experience: clayData ? firstOf(clayData, ["experience", "pastRoles"]) : undefined,
    Clay_Education: clayData ? firstOf(clayData, ["education"]) : undefined,
    Clay_Languages: clayData ? firstOf(clayData, ["languages"]) : undefined,
    Clay_Courses: clayData ? firstOf(clayData, ["courses"]) : undefined,
    Clay_Projects: clayData ? firstOf(clayData, ["projects"]) : undefined,
    Clay_Current_Experience: clayData
      ? firstOf(clayData, ["current_experience", "currentRoles", "latest_experience"])
      : undefined,
    // The ENTIRE raw Clay payload, verbatim, on top of the curated views
    // above -- nothing pre-filtered out. Whatever wasn't anticipated by the
    // named fields (connections, jobs_count, volunteering, structured_location,
    // etc.) is still here for the model to mine if it's useful, rather than a
    // code-level decision in advance about what counts as "relevant."
    Clay_Full_Data: clayData ?? undefined,
    // Same "nothing dropped" principle extended to the primary scrape
    // source (Bright Data for LinkedIn, Tavily for ProZ/ATA/etc.) -- was
    // previously computed for internal LLM-fallback verification only and
    // discarded before ever reaching drafting.
    Raw_Scrape_Data: (lead.rawScrapeData as any) ?? undefined,
  };
}
