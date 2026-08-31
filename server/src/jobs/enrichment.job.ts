import axios from "axios";
import { prisma } from "../prisma";
import { config } from "../config";
import { candidateRoleOf } from "../lib/messageTemplates";
import { normalizeServices } from "../lib/normalizeServices";

function splitToArray(val: unknown): string[] | undefined {
  if (typeof val !== "string" || !val.trim()) return undefined;
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

const BATCH_SIZE = 20;

/** Enriches a single lead by calling the real Python enrichment_pipeline and
 *  trusting ITS verdict on completeness (`enrichment_status`) instead of
 *  assuming success. A lead is only ever marked COMPLETE when the pipeline
 *  itself reports every critical field (email, contact number, years of
 *  experience) was actually resolved -- never on a bare "the HTTP call
 *  returned 200" or "the call failed" basis. That was a real bug: leads with
 *  a real About section and Contact section that the parser failed to pick
 *  up were still being force-marked enriched. */
export async function enrichLeadById(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { enrichmentStatus: "IN_PROGRESS", enrichmentStartedAt: new Date() },
    });

    const { data } = await axios.post(
      `${config.enrichmentServiceUrl}/enrich`,
      {
        // Send everything we already have, not just email/name -- the
        // pipeline's own "never overwrite existing data" + critical-field
        // audit only work correctly if it can see the lead's real current
        // state, not a partial view of it.
        First_Name: lead.firstName,
        Full_Name: lead.fullName,
        Country_of_Residence: lead.country,
        Email_Address: lead.email,
        Contact_Number: lead.contactNumber,
        Profile_Link: lead.profileLink,
        Services: lead.services.join(", "),
        Source_Language: lead.sourceLanguage,
        Target_Language: lead.targetLanguage,
        Secondary_Languages: lead.secondaryLanguages.join(", "),
        Years_of_Exp: lead.yearsOfExperience ? lead.yearsOfExperience.toNumber() : undefined,
        Vendor_Experience: lead.vendorExperience,
        Source: lead.source || "LinkedIn",
        Headline: lead.headline,
        About_Snippet: lead.aboutSnippet,
        Current_Title: lead.currentTitle,
        Tools_Software: lead.toolsSoftware.join(", "),
        Certifications: lead.certifications.join(", "),
        // Round-trips what was already resolved (and by what source) on a
        // prior run, so the pipeline doesn't re-spend an LLM call
        // re-verifying something already settled -- see orchestrator.py's
        // `_unverified()`.
        Field_Sources: lead.fieldSources ?? undefined,
      },
      { timeout: 30_000 }
    );

    let enrichedEmail = lead.email;
    let enrichedContactNumber = lead.contactNumber;
    let enrichedYearsOfExp = lead.yearsOfExperience;
    let enrichedVendorExp = lead.vendorExperience;
    // displayName is the schema's dedicated slot for "the real, verified
    // name -- shown once identityResolved" (every lead card falls back to
    // the random maskedLabel placeholder until this is set). fullName stays
    // untouched as the audit trail of what was actually typed at Add-Lead.
    let enrichedDisplayName = lead.displayName;
    // These five are allowed to OVERRIDE a manually-typed value once the
    // pipeline's Stage 3 merge (orchestrator.py) has verified a scraped
    // LinkedIn value -- a manual dropdown pick or free-typed language is
    // often just an approximation, same precedent as Full_Name/First_Name.
    let enrichedServices = lead.services;
    let enrichedSourceLanguage = lead.sourceLanguage;
    let enrichedTargetLanguage = lead.targetLanguage;
    let enrichedSecondaryLanguages = lead.secondaryLanguages;
    let enrichedCountry = lead.country;
    // Purely additive fields -- never set manually, so there's nothing to
    // reconcile, just capture whatever the scrape found.
    let enrichedHeadline = lead.headline;
    let enrichedAboutSnippet = lead.aboutSnippet;
    let enrichedCurrentTitle = lead.currentTitle;
    let enrichedToolsSoftware = lead.toolsSoftware;
    let enrichedCertifications = lead.certifications;

    if (data?.lead) {
      const el = data.lead;
      if (el.Email_Address) enrichedEmail = el.Email_Address;
      if (el.Contact_Number) enrichedContactNumber = el.Contact_Number;
      if (el.Years_of_Exp) {
        const parsed = parseInt(el.Years_of_Exp, 10);
        if (!isNaN(parsed)) enrichedYearsOfExp = parsed as any;
      }
      if (el.Vendor_Experience) enrichedVendorExp = el.Vendor_Experience;
      const resolvedName = String(el.Full_Name || el.First_Name || "").trim();
      if (resolvedName) enrichedDisplayName = resolvedName;

      // normalizeServices both splits (on any of , ; / : | -- not just
      // commas) and maps known variants/case-differences onto the canonical
      // service list, so a raw scraped value like "Sub:Dubbing:Audio
      // Description" becomes ["Subtitling","Dubbing","Audio Description"]
      // instead of surviving as one colon-delimited garbage string.
      if (el.Services) enrichedServices = normalizeServices(el.Services) ?? enrichedServices;
      if (el.Source_Language) enrichedSourceLanguage = el.Source_Language;
      if (el.Target_Language) enrichedTargetLanguage = el.Target_Language;
      if (el.Secondary_Languages) enrichedSecondaryLanguages = splitToArray(el.Secondary_Languages) ?? enrichedSecondaryLanguages;
      if (el.Country_of_Residence) enrichedCountry = el.Country_of_Residence;

      if (el.Headline) enrichedHeadline = el.Headline;
      if (el.About_Snippet) enrichedAboutSnippet = el.About_Snippet;
      if (el.Current_Title) enrichedCurrentTitle = el.Current_Title;
      if (el.Tools_Software) enrichedToolsSoftware = splitToArray(el.Tools_Software) ?? enrichedToolsSoftware;
      if (el.Certifications) enrichedCertifications = splitToArray(el.Certifications) ?? enrichedCertifications;
    }

    const returnedFieldSources = (data?.field_sources as Record<string, string> | undefined) || {};

    // "Enriched" means the pipeline has reached a TERMINAL state for this
    // lead, not "we have a way to contact them" -- those are two different
    // questions now. `_clay_dispatch: "pending"` is the only thing that can
    // still be running after this call returns (Clay resolves later via its
    // own webhook); everything else in this pass (Bright Data/Tavily scrape,
    // AI extraction) already finished synchronously. So: not still awaiting
    // Clay == nothing further left for automation to do == Enriched, whatever
    // that pass actually turned up. A non-LinkedIn lead (Clay never
    // applicable) is Enriched right after this first pass; a LinkedIn lead
    // stays not-yet-Enriched only while Clay's dispatch is in flight.
    const clayAwaiting = returnedFieldSources._clay_dispatch === "pending";
    const isComplete = !clayAwaiting;

    // ON_HOLD is now a SEPARATE signal from "Enriched": it flags "the
    // pipeline finished (isComplete) but we still have no way to reach this
    // person" -- a reachability concern, not an enrichment-progress one.
    // Never set while still awaiting Clay (that's "Enriching", not stuck).
    const hasContact = !!(enrichedEmail || enrichedContactNumber);
    const currentFlags = ((lead.flags as string[]) || []).filter((f) => f !== "ON_HOLD");
    const flags = isComplete && !hasContact ? Array.from(new Set([...currentFlags, "ON_HOLD"])) : currentFlags;

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        email: enrichedEmail,
        contactNumber: enrichedContactNumber,
        yearsOfExperience: enrichedYearsOfExp,
        vendorExperience: enrichedVendorExp,
        displayName: enrichedDisplayName,
        services: enrichedServices,
        sourceLanguage: enrichedSourceLanguage,
        targetLanguage: enrichedTargetLanguage,
        secondaryLanguages: enrichedSecondaryLanguages,
        country: enrichedCountry,
        headline: enrichedHeadline,
        aboutSnippet: enrichedAboutSnippet,
        currentTitle: enrichedCurrentTitle,
        toolsSoftware: enrichedToolsSoftware,
        certifications: enrichedCertifications,
        fieldSources: (data?.field_sources ?? lead.fieldSources) as any,
        // Complete raw Bright Data/Tavily payload, verbatim -- same
        // "nothing dropped" principle as Clay's clayData. Bright Data
        // returns a list, Tavily a dict -- shape varies by provider, so
        // (unlike clayData, which is always one dict) this replaces rather
        // than key-merges; a fresh non-empty scrape result is always the
        // more current one anyway.
        rawScrapeData: (data?.raw_enrichment_data ?? lead.rawScrapeData) as any,
        identityResolved: isComplete,
        enrichmentStatus: isComplete ? "COMPLETE" : "PENDING",
        flags: flags as any,
        promotedToGlobalAt: isComplete ? new Date() : undefined,
        justEnrichedUntil: isComplete ? new Date(Date.now() + 24 * 3600_000) : undefined,
      },
    });

    // Keep the dashboard's service tag in sync -- previously this was only
    // ever stamped once at Add-Lead time from the manual entry and never
    // refreshed when enrichment corrected it (the reported bug). Only the
    // tag is touched here, never subject/body -- redrafting stays a
    // deliberate, recruiter-triggered action via generate-draft.
    const candidateRole = candidateRoleOf(enrichedServices, enrichedTargetLanguage);
    await prisma.emailQueueItem.updateMany({
      where: { leadId: lead.id },
      data: { candidateRole },
    }).catch(() => {});
    await prisma.conversation.updateMany({
      where: { leadId: lead.id },
      data: { candidateRole },
    }).catch(() => {});
  } catch (err: any) {
    console.error(`[enrichment.job] lead ${lead.id} enrichment call failed, reverting to PENDING for retry:`, err?.message || err);
    // Never mark a failed call as enriched -- put it back in the queue so
    // the next poll retries it instead of silently pretending it succeeded.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { enrichmentStatus: "PENDING" },
    }).catch(() => {});
  }
}

// A lead only sits in IN_PROGRESS for the split second enrichLeadById's own
// axios call is in flight -- that call either lands in the try block's own
// terminal update or the catch block's revert-to-PENDING. Confirmed live:
// nothing was ever re-querying IN_PROGRESS, so a lead orphaned there (process
// restart, an error thrown outside that try/catch) stayed stuck forever.
// 20 minutes is generous slack above that split-second norm.
const STALL_TIMEOUT_MS = 20 * 60_000;

/** Finds leads stuck in IN_PROGRESS past STALL_TIMEOUT_MS and marks them
 *  STALLED so they stop looking like they're still actively enriching.
 *  Never silently retries on their behalf -- a lead that got orphaned mid-run
 *  needs a human (or an explicit retry call) to decide it's safe to re-run,
 *  not an automatic loop that could re-orphan it the same way. */
export async function stallOverdueEnrichments() {
  const cutoff = new Date(Date.now() - STALL_TIMEOUT_MS);
  const overdue = await prisma.lead.findMany({
    where: {
      enrichmentStatus: "IN_PROGRESS",
      // Also catches leads that were already IN_PROGRESS from before this
      // field existed (confirmed live: two leads stuck for hours predate
      // enrichmentStartedAt entirely) -- a currently-running lead with no
      // start time recorded is itself already anomalous, not something to
      // wait out.
      OR: [{ enrichmentStartedAt: { lt: cutoff } }, { enrichmentStartedAt: null }],
    },
    select: { id: true },
  });
  if (overdue.length === 0) return;

  await prisma.lead.updateMany({
    where: { id: { in: overdue.map((l) => l.id) } },
    data: { enrichmentStatus: "STALLED" },
  });
  console.warn(`[enrichment.job] Marked ${overdue.length} lead(s) STALLED after exceeding the ${STALL_TIMEOUT_MS / 60_000}min timeout: ${overdue.map((l) => l.id).join(", ")}`);
}

/** Polls PENDING leads and calls the enrichment_pipeline service for each. */
export async function pollPendingEnrichment() {
  const pending = await prisma.lead.findMany({
    where: { enrichmentStatus: "PENDING" },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return;

  for (const lead of pending) {
    await enrichLeadById(lead.id);
  }
}
