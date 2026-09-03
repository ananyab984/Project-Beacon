import axios from "axios";
import { prisma } from "../prisma";
import { config } from "../config";
import { candidateRoleOf } from "../lib/messageTemplates";
import { normalizeServices } from "../lib/normalizeServices";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";
import { computeOnHoldTransition } from "../lib/onHoldTransition";

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

    // Timeout raised from 30s to 70s: the pipeline enforces its own 60s
    // cumulative cap across the whole waterfall call sequence (real elapsed
    // time via time.monotonic() in orchestrator.py, layered on top of each
    // individual provider call's own 15s deadline) and returns a normal 200
    // response with `conclusion: "timed_out"` when it hits that cap, rather
    // than hanging -- a 30s axios timeout would abort the request before
    // Python ever gets the chance to respond gracefully, turning a clean
    // "on hold" signal into an ambiguous connection-timeout error instead.
    //
    // Retrying the whole call here (rather than just erroring out to the
    // existing PENDING-revert-and-repoll fallback) is safe specifically
    // because this runs fire-and-forget in the background (setImmediate at
    // every call site, never blocking an HTTP response) -- a `timed_out:
    // true` body is a normal 200 and never reaches this retry logic at all;
    // only genuine connectivity failures (service unreachable, Node's own
    // timeout firing) do.
    const { data } = await retryWithBackoff(
      (signal) =>
        axios.post(
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
          { timeout: 70_000, signal }
        ),
      // A documented exception to the 15s ceiling used everywhere else: this
      // call fans out to BrightData/Tavily/Clay/Claude inside the Python
      // pipeline (each individually bounded there), and the pipeline's own
      // cumulative cap is 60s -- 70s/attempt already accounts for that. This
      // deadline just replaces the previous *uncapped* worst case (5 x 70s +
      // backoff sleep, ~365s) with an explicit, bounded one: enough for one
      // full pipeline call plus headroom for a second attempt.
      { isRetryable: isRetryableByDefault, deadlineMs: 90_000 }
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
    let enrichedServices = lead.services;
    let enrichedSourceLanguage = lead.sourceLanguage;
    let enrichedTargetLanguage = lead.targetLanguage;
    let enrichedSecondaryLanguages = lead.secondaryLanguages;
    let enrichedCountry = lead.country;
    let enrichedHeadline = lead.headline;
    let enrichedAboutSnippet = lead.aboutSnippet;
    let enrichedCurrentTitle = lead.currentTitle;
    let enrichedToolsSoftware = lead.toolsSoftware;
    let enrichedCertifications = lead.certifications;

    // A manually-entered field (via the "Enriched"/"On Hold" dialogs' PATCH,
    // which tags fieldSources[key] = "manual") must never be silently
    // overwritten by a later re-enrichment result -- this used to not be
    // checked at all (five fields were even explicitly *documented* as
    // allowed to override a manual value), which was the real root cause of
    // "I manually filled this in and it later vanished." Manual wins until
    // the recruiter edits or clears it themselves.
    const existingFieldSources = (lead.fieldSources as Record<string, string> | null) ?? {};
    const isManual = (canonicalKey: string) => existingFieldSources[canonicalKey] === "manual";

    if (data?.lead) {
      const el = data.lead;
      if (el.Email_Address && !isManual("Email_Address")) enrichedEmail = el.Email_Address;
      if (el.Contact_Number && !isManual("Contact_Number")) enrichedContactNumber = el.Contact_Number;
      if (el.Years_of_Exp && !isManual("Years_of_Exp")) {
        const parsed = parseInt(el.Years_of_Exp, 10);
        if (!isNaN(parsed)) enrichedYearsOfExp = parsed as any;
      }
      if (el.Vendor_Experience && !isManual("Vendor_Experience")) enrichedVendorExp = el.Vendor_Experience;
      if (!isManual("Full_Name")) {
        const resolvedName = String(el.Full_Name || el.First_Name || "").trim();
        if (resolvedName) enrichedDisplayName = resolvedName;
      }

      // normalizeServices both splits (on any of , ; / : | -- not just
      // commas) and maps known variants/case-differences onto the canonical
      // service list, so a raw scraped value like "Sub:Dubbing:Audio
      // Description" becomes ["Subtitling","Dubbing","Audio Description"]
      // instead of surviving as one colon-delimited garbage string.
      if (el.Services && !isManual("Services")) enrichedServices = normalizeServices(el.Services) ?? enrichedServices;
      if (el.Source_Language && !isManual("Source_Language")) enrichedSourceLanguage = el.Source_Language;
      if (el.Target_Language && !isManual("Target_Language")) enrichedTargetLanguage = el.Target_Language;
      if (el.Secondary_Languages) enrichedSecondaryLanguages = splitToArray(el.Secondary_Languages) ?? enrichedSecondaryLanguages;
      if (el.Country_of_Residence && !isManual("Country_of_Residence")) enrichedCountry = el.Country_of_Residence;

      if (el.Headline && !isManual("Headline")) enrichedHeadline = el.Headline;
      if (el.About_Snippet && !isManual("About_Snippet")) enrichedAboutSnippet = el.About_Snippet;
      if (el.Current_Title && !isManual("Current_Title")) enrichedCurrentTitle = el.Current_Title;
      if (el.Tools_Software && !isManual("Tools_Software")) enrichedToolsSoftware = splitToArray(el.Tools_Software) ?? enrichedToolsSoftware;
      if (el.Certifications && !isManual("Certifications")) enrichedCertifications = splitToArray(el.Certifications) ?? enrichedCertifications;
    }

    const returnedFieldSources = (data?.field_sources as Record<string, string> | undefined) || {};
    // The pipeline's own field_sources response describes what IT resolved
    // (including reporting "existing" for a field it left untouched because
    // one was already there) -- it has no notion of "manual". Naively using
    // it wholesale would silently clobber a "manual" tag back to "existing"
    // even though the VALUE itself was correctly protected above, breaking
    // protection on the *next* re-enrichment pass. Re-assert every key this
    // lead already had tagged "manual" over whatever the pipeline reported.
    const mergedFieldSources: Record<string, string> = { ...(returnedFieldSources || (lead.fieldSources as any) || {}) };
    for (const [key, source] of Object.entries(existingFieldSources)) {
      if (source === "manual") mergedFieldSources[key] = "manual";
    }

    // "Enriched" means the pipeline has reached a TERMINAL state for this
    // lead, not "we have a way to contact them" -- those are two different
    // questions now. `_clay_dispatch: "pending"` is the only thing that can
    // still be running after this call returns (Clay resolves later via its
    // own webhook); everything else in this pass (Bright Data/Tavily scrape,
    // AI extraction) already finished synchronously. So: not still awaiting
    // Clay AND not timed out == nothing further left for automation to do
    // == Enriched, whatever that pass actually turned up.
    const clayAwaiting = returnedFieldSources._clay_dispatch === "pending";
    const conclusion = data?.conclusion as "short_circuit_success" | "exhausted_no_match" | "timed_out" | null | undefined;
    const isComplete = !clayAwaiting && conclusion !== "timed_out";

    // On Hold is now driven entirely by the waterfall's own conclusion state
    // or the recruiter's own manual toggle -- never by field count/contact
    // presence (that was the old, corrected behavior). See
    // computeOnHoldTransition for the shared rules (MANUAL never
    // auto-clears, clayAwaiting leaves everything untouched).
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: (lead.flags as string[]) || [],
      currentOnHoldReason: lead.onHoldReason,
      stillInFlight: clayAwaiting,
      outcome: conclusion === "timed_out" ? "timed_out" : "concluded_normally",
    });

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
        fieldSources: mergedFieldSources as any,
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
        onHoldReason,
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
    console.error(`[enrichment.job] lead ${lead.id} enrichment call failed:`, err?.message || err);
    // Never mark a failed call as enriched. Previously this only reverted
    // to PENDING with zero recruiter-visible signal -- silently retried
    // forever by the poll job with nothing to show for it. Now also flags
    // ON_HOLD/SYSTEM_ERROR so the failure is visible (and, per Part 4, so
    // the poll job's own query -- which excludes any ON_HOLD lead -- stops
    // re-running the whole waterfall on it every few minutes; a human uses
    // the retry-enrichment action to try again). Never downgrades an
    // existing MANUAL hold's reason -- a system-level failure must not
    // silently override a recruiter's own deliberate hold.
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: (lead.flags as string[]) ?? [],
      currentOnHoldReason: lead.onHoldReason,
      outcome: "system_error",
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { enrichmentStatus: "PENDING", flags: flags as any, onHoldReason },
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
    select: { id: true, flags: true, onHoldReason: true },
  });
  if (overdue.length === 0) return;

  // Also flags ON_HOLD/SYSTEM_ERROR (reusing that reason -- a stall is,
  // semantically, the pipeline failing to conclude for a technical reason,
  // same bucket as a genuine crash) so this folds into the same "On Hold (n)"
  // display and poll-exclusion as timeout/system_error, instead of a
  // separately-labeled STALLED status that the poll job would otherwise
  // still leave un-excluded. enrichmentStatus stays STALLED (distinct from
  // plain PENDING) purely as an internal diagnostic of *how* it got here.
  // updateMany can't merge each row's own flags array, so this is a
  // per-lead loop -- batch size here is small (a genuinely stuck lead is
  // rare), not a hot path like pollPendingEnrichment below.
  for (const lead of overdue) {
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: lead.flags,
      currentOnHoldReason: lead.onHoldReason,
      outcome: "system_error",
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { enrichmentStatus: "STALLED", flags: flags as any, onHoldReason },
    });
  }
  console.warn(`[enrichment.job] Marked ${overdue.length} lead(s) STALLED after exceeding the ${STALL_TIMEOUT_MS / 60_000}min timeout: ${overdue.map((l) => l.id).join(", ")}`);
}

/** Polls PENDING leads and calls the enrichment_pipeline service for each.
 *  Excludes any ON_HOLD lead regardless of reason (manual/timeout/
 *  system_error) -- the actual fix that stops the waterfall from being
 *  re-run on the same lead every few minutes forever. A lead only comes
 *  back into this query by having ON_HOLD explicitly cleared (the manual
 *  toggle, or the retry-enrichment endpoint) -- never automatically. */
export async function pollPendingEnrichment() {
  const pending = await prisma.lead.findMany({
    where: { enrichmentStatus: "PENDING", NOT: { flags: { has: "ON_HOLD" } } },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return;

  for (const lead of pending) {
    await enrichLeadById(lead.id);
  }
}
