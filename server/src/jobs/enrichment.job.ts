import axios from "axios";
import { prisma } from "../prisma";
import { config } from "../config";
import { candidateRoleOf } from "../lib/messageTemplates";
import { normalizeServices } from "../lib/normalizeServices";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";
import { computeOnHoldTransition } from "../lib/onHoldTransition";
import { mapWithConcurrency } from "../lib/mapWithConcurrency";
import { countPopulatedFields } from "../lib/enrichmentCount";
import { tierFromFieldSources } from "../lib/enrichmentTier";
import type { EnrichmentRunConclusion } from "@prisma/client";

const CONCLUSION_MAP: Record<string, EnrichmentRunConclusion> = {
  short_circuit_success: "SHORT_CIRCUIT_SUCCESS",
  exhausted_no_match: "EXHAUSTED_NO_MATCH",
  timed_out: "TIMED_OUT",
};

function splitToArray(val: unknown): string[] | undefined {
  if (typeof val !== "string" || !val.trim()) return undefined;
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

const BATCH_SIZE = 20;
// How many leads pollPendingEnrichment works on at once. A real Parallel call
// measured 150-170s (up to 486s for a thin lead that falls through to Stage
// 6), so BATCH_SIZE=20 processed one at a time -- as this used to be -- took
// ~50-60 minutes per batch. 4 keeps a batch to roughly the per-lead time
// instead of a multiple of it, while staying within
// providers/parallel_client.py's own 8-worker bulkhead (`_parallel_executor`)
// on the enrichment service side, so this can't starve it either.
const POLL_CONCURRENCY = 4;

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

  // Shared by both the success and catch paths below to write one
  // EnrichmentRun row per attempt (see server/prisma/schema.prisma) -- the
  // Enrichment Evaluation dashboard's whole data source.
  const startedAt = new Date();

  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { enrichmentStatus: "IN_PROGRESS", enrichmentStartedAt: startedAt },
    });

    // Timeout raised again (4_000_000ms -> 4_200_000ms): the pipeline's own
    // cumulative cap across the whole waterfall call sequence grew from 3800s
    // to 4100s when Stage 6 (Claude web search, its own 300s deadline) was
    // added as a real Tier 3 fallback behind Bright Data/Tavily and Parallel
    // (see orchestrator.py's LEAD_LEVEL_TIMEOUT_SECONDS for the full budget
    // math). Earlier history: two successive guesses at Parallel's "typical"
    // latency (150s, then 240s per-call; 350s, then 4000s) both still cut off
    // calls that were genuinely succeeding server-side (confirmed live
    // 2026-09-07: a real "core"-processor Task Run routinely takes ~150-170s,
    // and our own guessed ceiling kept firing right as the real result was
    // landing). Rather than guess yet another number, enrichment_pipeline/
    // providers/parallel_client.py defers to the Parallel SDK's own
    // well-engineered default (waits up to an hour for a task to actually
    // finish) -- every timeout in this chain, including this one, is sized to
    // never be the thing that cuts that off early. In practice, real calls
    // still resolve in ~150-170s -- this ceiling only matters for a genuine
    // outlier, not the expected case. Real elapsed time via time.monotonic()
    // in orchestrator.py, layered on top of each individual provider call's
    // own deadline) and returns a normal 200 response with `conclusion:
    // "timed_out"` when it hits that cap, rather than hanging -- a shorter
    // axios timeout would abort the request before Python ever gets the
    // chance to respond gracefully, turning a clean "on hold" signal into an
    // ambiguous connection-timeout error instead.
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
          { timeout: 4_200_000, signal }
        ),
      // A documented exception to the 15s ceiling used everywhere else: this
      // call fans out to BrightData/Tavily/Parallel/Claude web search inside
      // the Python pipeline (each individually bounded there), and the
      // pipeline's own cumulative cap is 4100s (see orchestrator.py's
      // LEAD_LEVEL_TIMEOUT_SECONDS and config.py's parallel_deadline_seconds /
      // claude_websearch_deadline_seconds). 4200s/attempt stays above that
      // 4100s cap so Python gets to respond gracefully instead of Node's own
      // timeout firing first. Note this deadline still doesn't comfortably
      // cover two full attempts back to back: 4400s total / 4200s per attempt
      // is ~1.05 attempts, so worst case (Parallel runs close to its full
      // allowed time) the first attempt consumes nearly the whole deadline,
      // leaving only ~200s for a second attempt to even start -- nowhere near
      // enough for it to finish, so it gets killed by the deadline mid-flight
      // regardless of whether it was about to succeed. Effectively one real
      // attempt plus a mostly-wasted partial second one, not two real tries --
      // an accepted tradeoff of Parallel's latency, not something solved here
      // by adding new retry infrastructure. In practice, real Parallel calls
      // resolve in ~150-170s, so this multi-thousand-second ceiling is a
      // safety net for a genuine outlier, not the expected per-lead wait.
      { isRetryable: isRetryableByDefault, deadlineMs: 4_400_000 }
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
    // questions now. Unlike Clay's old async dispatch (`_clay_dispatch:
    // "pending"`, resolved later via its own webhook), Parallel's Stage 3.5
    // call is synchronous -- it either ran to completion or was skipped/
    // failed before this response was built, so there is no "still awaiting"
    // state left to check here. Every stage in this pass (Bright Data/
    // Tavily scrape, Parallel, AI extraction) has already concluded
    // synchronously by the time this response arrives, so not timed out ==
    // nothing further left for automation to do == Enriched, whatever that
    // pass actually turned up.
    const conclusion = data?.conclusion as "short_circuit_success" | "exhausted_no_match" | "timed_out" | null | undefined;
    const isComplete = conclusion !== "timed_out";

    // On Hold is now driven entirely by the waterfall's own conclusion state
    // or the recruiter's own manual toggle -- never by field count/contact
    // presence (that was the old, corrected behavior). See
    // computeOnHoldTransition for the shared rules (MANUAL never
    // auto-clears).
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: (lead.flags as string[]) || [],
      currentOnHoldReason: lead.onHoldReason,
      outcome: conclusion === "timed_out" ? "timed_out" : "concluded_normally",
    });

    // Parallel's raw Task Run output (see orchestrator.py's parallel_fallback
    // / providers/parallel_client.py's LeadProfile) -- stored verbatim,
    // same "nothing dropped" principle Clay's old clayData followed, now
    // arriving synchronously in this same response instead of via a
    // separate webhook. `called: false` (skipped/already-ran) or a failed
    // call carries no `data` key, so this only ever replaces parallelData
    // with a genuine result, never clobbers a prior one with nothing.
    const parallelResult = data?.parallel_fallback?.data as Record<string, any> | undefined;

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
        // "nothing dropped" principle as Parallel's parallelData below.
        // Bright Data returns a list, Tavily a dict -- shape varies by
        // provider, so (unlike parallelData, which is always one dict) this
        // replaces rather than key-merges; a fresh non-empty scrape result
        // is always the more current one anyway.
        rawScrapeData: (data?.raw_enrichment_data ?? lead.rawScrapeData) as any,
        // Parallel's raw output, verbatim -- only replaces the prior value
        // when this pass actually produced one (see parallelResult above).
        parallelData: (parallelResult ?? lead.parallelData) as any,
        identityResolved: isComplete,
        enrichmentStatus: isComplete ? "COMPLETE" : "PENDING",
        flags: flags as any,
        onHoldReason,
        promotedToGlobalAt: isComplete ? new Date() : undefined,
        justEnrichedUntil: isComplete ? new Date(Date.now() + 24 * 3600_000) : undefined,
      },
    });

    const concludedAt = new Date();
    await prisma.enrichmentRun.create({
      data: {
        leadId: lead.id,
        platform: lead.source,
        // Defensive fallback only -- the pipeline's own PipelineResult type
        // always sends one of the three real conclusion values on a normal
        // response. Bucketed as SYSTEM_ERROR (not e.g. TIMED_OUT) if it ever
        // doesn't, since "we got a response we don't recognize" is the same
        // kind of anomaly as "we couldn't reach the service" for analytics
        // purposes, not a genuine per-step timeout.
        conclusion: CONCLUSION_MAP[conclusion ?? ""] ?? "SYSTEM_ERROR",
        tier: tierFromFieldSources(mergedFieldSources),
        enrichedFieldCount: countPopulatedFields({
          email: enrichedEmail,
          contactNumber: enrichedContactNumber,
          country: enrichedCountry,
          profileLink: lead.profileLink,
          sourceLanguage: enrichedSourceLanguage,
          targetLanguage: enrichedTargetLanguage,
          services: enrichedServices,
          headline: enrichedHeadline,
          currentTitle: enrichedCurrentTitle,
          aboutSnippet: enrichedAboutSnippet,
          fieldSources: mergedFieldSources as any,
        }),
        executionTimeMs: typeof data?.execution_time_ms === "number" ? data.execution_time_ms : concludedAt.getTime() - startedAt.getTime(),
        startedAt,
        concludedAt,
      },
    }).catch((err) => console.error(`[enrichment.job] failed to record EnrichmentRun for lead ${lead.id}:`, err));

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

    // Same EnrichmentRun bookkeeping as the try path's success case, so a
    // connectivity failure counts toward the Enrichment Evaluation dashboard
    // too (Metric 1's "On Hold" bucket) -- not just leads that reached the
    // Python pipeline. `tier` stays null: this path never got a response,
    // so nothing could have been resolved.
    const concludedAt = new Date();
    await prisma.enrichmentRun.create({
      data: {
        leadId: lead.id,
        platform: lead.source,
        conclusion: "SYSTEM_ERROR",
        tier: null,
        enrichedFieldCount: countPopulatedFields(lead),
        executionTimeMs: concludedAt.getTime() - startedAt.getTime(),
        startedAt,
        concludedAt,
      },
    }).catch((err) => console.error(`[enrichment.job] failed to record EnrichmentRun for lead ${lead.id}:`, err));
  }
}

// A lead sits in IN_PROGRESS for as long as enrichLeadById's own axios call
// is in flight -- that call either lands in the try block's own terminal
// update or the catch block's revert-to-PENDING. Confirmed live: nothing was
// ever re-querying IN_PROGRESS, so a lead orphaned there (process restart, an
// error thrown outside that try/catch) stayed stuck forever.
//
// This used to reason about that span as "the split second the axios call is
// in flight" and set 20 minutes as generous slack above it -- which was wrong
// about the actual span: that same axios call is configured with a 70-minute
// timeout (4_200_000ms, see enrichLeadById above) and a 73.3-minute outer
// retry deadline (4_400_000ms), specifically so Node never cuts off a
// genuinely-still-running Python call before its own ~68-minute
// LEAD_LEVEL_TIMEOUT_SECONDS cap gets to respond gracefully with
// `conclusion: "timed_out"`. A 20-minute stall timeout could flag a lead
// STALLED -- and hand it to a human to retry -- while it was still legitimately
// in flight per every OTHER timeout in this same chain. In practice real
// calls resolve in 150-486s, so this only matters for a genuine outlier, but
// the ceiling has to be an honest reflection of what's actually configured,
// not of the typical case.
//
// 80 minutes stays above BOTH the 70-minute axios timeout and the
// 73.3-minute retry deadline, so this can only ever catch a lead that is
// truly orphaned (the axios call itself never returned control at all --
// process crash/restart mid-call), never one still working within its own
// documented budget.
const STALL_TIMEOUT_MS = 80 * 60_000;

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
 *  toggle, or the retry-enrichment endpoint) -- never automatically.
 *
 *  CLAIMS the whole batch atomically (one updateMany, re-checking
 *  enrichmentStatus: "PENDING" in the WHERE clause) before processing any of
 *  it, and works the claimed leads with bounded concurrency rather than one
 *  at a time.
 *
 *  This used to fetch a batch, then process it with
 *  `for (const lead of pending) { await enrichLeadById(lead.id); }` --
 *  sequential and unclaimed. At Parallel's measured ~150-170s per lead (up to
 *  486s for a lead that falls through to Stage 6), a single slow lead
 *  routinely outlasted the 3-minute cron interval (jobs/index.ts). The NEXT
 *  tick's own query for PENDING leads then legitimately found lead[1..N] --
 *  never yet touched, since the first run's sequential loop hadn't reached
 *  them -- started enriching them itself, and the FIRST run's loop
 *  eventually reached those same lead ids too: `enrichLeadById` re-fetches by
 *  id and unconditionally re-marks IN_PROGRESS, with no re-check of current
 *  status, so it re-enriched them a second time regardless of what the other
 *  run had already done. Two concurrent runs paying for the same paid
 *  Parallel Task Run, compounding every 3 minutes.
 *
 *  The re-checked WHERE clause on the updateMany below is what actually
 *  prevents this -- it is a single atomic statement, so if a concurrent call
 *  claims a lead first, this run's updateMany simply does not match that row
 *  (Postgres's own row-level locking makes the two claims mutually
 *  exclusive, not application-level coordination). `enrichLeadById` is left
 *  unchanged: it is also called directly and unconditionally from
 *  lead.routes.ts (immediate enrichment on Add Lead, bulk upload), where
 *  "claim first" does not apply -- a human just triggered exactly this one
 *  lead. */
export async function pollPendingEnrichment() {
  const candidates = await prisma.lead.findMany({
    where: { enrichmentStatus: "PENDING", NOT: { flags: { has: "ON_HOLD" } } },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (candidates.length === 0) return;

  const candidateIds = candidates.map((l) => l.id);
  await prisma.lead.updateMany({
    where: { id: { in: candidateIds }, enrichmentStatus: "PENDING" },
    data: { enrichmentStatus: "IN_PROGRESS", enrichmentStartedAt: new Date() },
  });

  // Re-read which of the candidates THIS run actually claimed -- fewer than
  // `candidateIds.length` if a concurrent run claimed some of them first in
  // the gap between the query above and this one; those are simply left to
  // whichever run claimed them; process the rest.
  const claimed = await prisma.lead.findMany({
    where: { id: { in: candidateIds }, enrichmentStatus: "IN_PROGRESS" },
    select: { id: true },
  });
  if (claimed.length === 0) return;

  await mapWithConcurrency(claimed, POLL_CONCURRENCY, async (lead) => {
    // enrichLeadById's own catch path handles a failed call (reverts to
    // PENDING, flags ON_HOLD/SYSTEM_ERROR) -- this outer catch exists only so
    // one lead throwing something outside that try/catch (a bug, not a
    // provider failure) can't take the whole concurrent batch down, mirroring
    // every other fire-and-forget call site's `.catch((err) => console.error(...))`.
    await enrichLeadById(lead.id).catch((err) =>
      console.error(`[enrichment.job] pollPendingEnrichment: lead ${lead.id} failed:`, err)
    );
  });
}
