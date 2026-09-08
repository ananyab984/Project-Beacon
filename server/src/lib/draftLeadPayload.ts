import type { Lead } from "@prisma/client";
import { mergeProfileSections } from "./profileSections";

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
  // The deep sections, MERGED across Bright Data and Parallel -- not
  // Parallel alone. On LinkedIn, Parallel's browsing agent cannot see
  // experience/education/languages/certifications at all (they sit behind
  // LinkedIn's login wall); only Bright Data's authenticated scrape can.
  // Before this, `Deep_Experience`/`Deep_Education`/`Deep_Languages` (then
  // named `Parallel_*`) were sourced from `parallelData` only, so for every
  // LinkedIn lead the curated deep facts drafting reads --
  // additional_languages_spoken, education, courses_completed -- were empty
  // while the data sat, unused, in `rawScrapeData`. On a linguist
  // recruitment platform, a candidate's stated languages and proficiency are
  // the qualifying facts, not a nice-to-have. See lib/profileSections.ts for
  // the merge itself, already shipped for the enrichment dialog; this wires
  // the SAME merged view into drafting rather than duplicating it.
  const sections = mergeProfileSections(lead);

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
    // Merged across every source that found them (Bright Data AND Parallel,
    // not Parallel alone -- see the comment above), in the same entry shape
    // either source emits (title/company/start_date/end_date/summary;
    // institution/degree/field_of_study; language/proficiency). Each entry
    // also carries a `source` tag ("brightdata"|"parallel") that drafting's
    // formatRole/labelOf simply ignore, same as they already ignore any
    // other unmodeled key. Named `Deep_*` (not `Parallel_*`) because that
    // prefix stopped being accurate the moment a second provider could fill
    // them -- `fromRecord` in drafting/leads.ts still accepts the old
    // `Parallel_*` names as aliases for any other caller of the /draft
    // endpoint that hasn't moved to the new ones.
    Deep_Experience: sections.experience.length ? sections.experience : undefined,
    Deep_Education: sections.education.length ? sections.education : undefined,
    Deep_Languages: sections.languages.length ? sections.languages : undefined,
    // Previously named `Parallel_Courses` and read by drafting/leads.ts, but
    // never once produced by this function -- courses_completed was
    // structurally always empty regardless of what enrichment found. Bright
    // Data returns this section directly (29 courses on one real lead);
    // Parallel has no equivalent, so this is Bright-Data-only in practice.
    Deep_Courses: sections.courses.length ? sections.courses : undefined,
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
