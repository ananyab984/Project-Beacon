import axios from "axios";
import { prisma } from "../prisma";
import { config } from "../config";
import { candidateRoleOf } from "../lib/messageTemplates";
import { normalizeServices } from "../lib/normalizeServices";
import { normalizeToolsSoftware } from "../lib/normalizeToolsSoftware";
import { normalizeVendorExperience } from "../lib/normalizeVendorExperience";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";
import { waitWhileBusy } from "../lib/waitWhileBusy";
import { computeOnHoldTransition } from "../lib/onHoldTransition";
import { computeEnrichmentVerdict } from "../lib/enrichmentVerdict";
import { drainWithConcurrency } from "../lib/drainWithConcurrency";
import { pickNextFair, type QueueHead } from "../lib/pickNextFair";
import { countPopulatedFields } from "../lib/enrichmentCount";
import { tierFromFieldSources } from "../lib/enrichmentTier";
import { createNotification, formatEnrichmentCompleteSlackCard } from "../services/notification.service";
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

// How many leads pollPendingEnrichment works on at once -- and, since bulk
// upload / Sheet import now hand their leads to this queue instead of firing
// enrichLeadById per row (that unbounded fan-out is what stalled every bulk
// test), the ceiling on concurrent /enrich calls from ANY ingestion path but
// single Add Lead. A real Parallel call measured 150-170s (up to 486s for a
// thin lead that falls through to Stage 6), so working them one at a time
// took ~50-60 minutes per 20 leads. pollInFlight below makes total
// concurrency actually equal to this number instead of an uncontrolled
// multiple of it (see that comment). Set by ENRICHMENT_CONCURRENCY, which
// also sizes the enrichment service's own pools (`_parallel_executor`,
// `_tier_overlap_executor`) so the two always match.
const POLL_CONCURRENCY = config.enrichmentConcurrency;

// node-cron does not prevent overlapping invocations of the same scheduled
// callback -- it fires on the wall-clock schedule regardless of whether the
// previous pollPendingEnrichment call has resolved. The atomic updateMany
// claim below (re-checking enrichmentStatus: "PENDING") already stops two
// overlapping ticks from double-processing the SAME lead, but does nothing to
// cap TOTAL concurrent Parallel calls across ticks: once a backlog exists and
// leads routinely take longer than the 3-minute tick interval, an
// unguarded next tick claims a fresh batch and starts its own
// POLL_CONCURRENCY-wide pool on top of the still-running one, stacking
// without limit across however many ticks overlap -- silently exceeding
// providers/parallel_client.py's and orchestrator.py's 8-worker bulkheads,
// which then queue the excess invisibly. This flag makes a tick a no-op
// while a previous one is still mid-flight, so total concurrency is always
// exactly POLL_CONCURRENCY, never a multiple of it. Plain in-memory state is
// enough (not a DB-level lock): this service runs as a single Render
// instance, and a boolean that resets to false on every process
// restart/redeploy can never stay stuck "locked" the way a DB row surviving
// a crash could.
let pollInFlight = false;

// Leads THIS process is running right now (enrichLeadById adds on entry,
// removes in its finally) -- what a graceful shutdown drains and then hands
// back to the queue (index.ts) -- and whether it has stopped taking new ones.
const inFlightLeadIds = new Set<string>();
let stopClaiming = false;

/** On SIGTERM (a Render redeploy, `docker stop`), hand the leads this process
 *  was mid-way through back to the queue. Without it they stayed IN_PROGRESS
 *  with nothing working on them -- pollPendingEnrichment only claims PENDING
 *  -- reading "Enriching (96%)" until stallOverdueEnrichments marked them
 *  STALLED + On Hold 80 minutes later, which is what recoverStuckEnrichments
 *  .ts had to clean up by hand. Scoped to this process's own set, so the
 *  overlap during a zero-downtime deploy (old and new instance both alive)
 *  can never requeue the OTHER instance's live work. A hard crash skips this;
 *  the next boot's requeueOrphanedEnrichments picks those leads up. The
 *  cut-off run is re-run, but if the enrichment service outlived this process
 *  (separate services on Render) the re-claimed lead collects that run's
 *  stored result instead of paying again (waitWhileBusy + main.py's
 *  LeadRunRegistry). */
export async function requeueInFlightEnrichments(): Promise<number> {
  if (inFlightLeadIds.size === 0) return 0;
  const ids = [...inFlightLeadIds];
  const { count } = await prisma.lead.updateMany({
    where: { id: { in: ids }, enrichmentStatus: "IN_PROGRESS" },
    data: { enrichmentStatus: "PENDING", enrichmentStartedAt: null },
  });
  console.warn(`[enrichment.job] shutdown: requeued ${count} in-flight lead(s): ${ids.join(", ")}`);
  return count;
}

/** Enriches a single lead by calling the real Python enrichment_pipeline and
 *  trusting ITS verdict (`enrichment_status`) on whether the lead actually
 *  came back enriched -- never a bare "the HTTP call returned 200".
 *
 *  Two separate verdicts come out of one response, and conflating them was a
 *  real bug (see `concluded` / `fullyEnriched` below):
 *   - whether the waterfall CONCLUDED, which decides only whether the poll
 *     job keeps retrying this lead; and
 *   - whether every critical field (email, contact number, years of
 *     experience) was resolved, which decides whether the lead is treated as
 *     finished: promoted to the global recruiter pool, and announced to the
 *     contractor who submitted it.
 */
export async function enrichLeadById(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  // A lead can be soft-deleted WHILE this is in flight -- a run legitimately
  // lasts up to ~68 minutes (orchestrator.py's LEAD_LEVEL_TIMEOUT_SECONDS),
  // which is a wide window for a recruiter to bin it. pollPendingEnrichment
  // and stallOverdueEnrichments both filter `deletedAt: null` when they pick
  // leads up, but nothing re-checked it here, so a lead deleted mid-run still
  // had results (and promotedToGlobalAt/justEnrichedUntil) written back on
  // top of it. Checking here also stops the obvious waste: every provider
  // call below is paid, and spending it on a binned lead buys nothing.
  if (lead.deletedAt) {
    console.log(`[enrichment.job] lead ${lead.id} is in the recycle bin -- skipping enrichment`);
    return;
  }

  // Shared by both the success and catch paths below to write one
  // EnrichmentRun row per attempt (see server/prisma/schema.prisma) -- the
  // Enrichment Evaluation dashboard's whole data source.
  const startedAt = new Date();
  inFlightLeadIds.add(lead.id);

  try {
    // updateMany, not update: `where` can then carry `deletedAt: null`, so a
    // lead binned between the read above and this write is simply not
    // touched (update() would throw on a composite where, and matching on id
    // alone would resurrect the row's status). Same pattern on every lead
    // write in this function.
    await prisma.lead.updateMany({
      where: { id: lead.id, deletedAt: null },
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
    //
    // Retrying is also safe against double-paying: Lead_Id makes the
    // enrichment service refuse a repeat while this lead is still running
    // there (409 -> waitWhileBusy waits and asks again) and hand back the
    // stored result once it has finished (main.py's LeadRunRegistry), so a
    // dropped connection no longer starts a second waterfall.
    const { data } = await waitWhileBusy(() => retryWithBackoff(
      (signal) =>
        axios.post(
          `${config.enrichmentServiceUrl}/enrich`,
          {
            Lead_Id: lead.id,
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
            Vendor_Experience: lead.vendorExperience.join(", "),
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
          {
            timeout: 4_200_000,
            signal,
            headers: { "X-Enrichment-Shared-Secret": config.enrichmentServiceSharedSecret },
          }
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
    ), Date.now() + 4_400_000);

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

    // Policy (explicit product decision, reverses the prior "manual always
    // wins" rule that used to live here): a fresh, verified enrichment
    // result -- brightdata/tavily/parallel/llm_fallback, which is all `el.X`
    // ever is at this point -- now overrides a manual entry too, not just an
    // "existing"/unverified one. A manual value is only ever a placeholder
    // or a best guess until a real provider confirms or corrects it; letting
    // it permanently block a later correct result (confirmed live: a
    // recruiter-typed Years_of_Exp of -6 stayed forever, immune to a real
    // derivation from Parallel's own experience history) was judged the
    // bigger risk than the flip side (a fresh result overwriting a
    // deliberate manual correction) -- so this section no longer checks
    // fieldSources for "manual" at all before merging a fresh value in.

    if (data?.lead) {
      const el = data.lead;
      if (el.Email_Address) enrichedEmail = el.Email_Address;
      if (el.Contact_Number) enrichedContactNumber = el.Contact_Number;
      if (el.Years_of_Exp) {
        const parsed = parseInt(el.Years_of_Exp, 10);
        if (!isNaN(parsed)) enrichedYearsOfExp = parsed as any;
      }
      if (el.Vendor_Experience) enrichedVendorExp = normalizeVendorExperience(el.Vendor_Experience);
      const resolvedName = String(el.Full_Name || el.First_Name || "").trim();
      if (resolvedName) enrichedDisplayName = resolvedName;

      // normalizeServices both splits (on any of , ; / : | -- not just
      // commas) and maps known variants/case-differences onto the canonical
      // service list, so a raw scraped value like "Sub:Dubbing:Audio
      // Description" becomes ["Subtitling","Dubbing","Audio Description"]
      // instead of surviving as one colon-delimited garbage string.
      //
      // Every other field in this block treats a falsy `el.X` as "the
      // pipeline didn't touch this field, keep what's there" -- true for all
      // of them, since enrichment only ever fills a field in, never clears
      // one. Services is the one exception: orchestrator.py's
      // _infer_services_via_llm can legitimately resolve a garbled value to
      // "" when nothing groundable exists to reclassify from (a test/
      // placeholder lead with no real profile text), and that explicit clear
      // must go through -- checked via field_sources rather than value
      // truthiness, since "" is indistinguishable from "untouched" otherwise.
      const servicesSource = (data?.field_sources as Record<string, string> | undefined)?.Services;
      if (el.Services || servicesSource === "llm_fallback") {
        enrichedServices = normalizeServices(el.Services) ?? enrichedServices;
      }
      if (el.Source_Language) enrichedSourceLanguage = el.Source_Language;
      if (el.Target_Language) enrichedTargetLanguage = el.Target_Language;
      if (el.Secondary_Languages) enrichedSecondaryLanguages = splitToArray(el.Secondary_Languages) ?? enrichedSecondaryLanguages;
      if (el.Country_of_Residence) enrichedCountry = el.Country_of_Residence;

      if (el.Headline) enrichedHeadline = el.Headline;
      if (el.About_Snippet) enrichedAboutSnippet = el.About_Snippet;
      if (el.Current_Title) enrichedCurrentTitle = el.Current_Title;
      if (el.Tools_Software) enrichedToolsSoftware = normalizeToolsSoftware(el.Tools_Software);
      if (el.Certifications) enrichedCertifications = splitToArray(el.Certifications) ?? enrichedCertifications;
    }

    const returnedFieldSources = (data?.field_sources as Record<string, string> | undefined) || {};
    // No longer re-asserts a stale "manual" tag over what the pipeline
    // reports (see the policy note above) -- the pipeline's own field_sources
    // response is now authoritative as-is.
    const mergedFieldSources: Record<string, string> = { ...(returnedFieldSources || (lead.fieldSources as any) || {}) };

    // Nothing in this response is still pending: unlike Clay's old async
    // dispatch (`_clay_dispatch: "pending"`, resolved later via its own
    // webhook), Parallel's Stage 3.5 call is synchronous, so every stage in
    // this pass (Bright Data/Tavily scrape, Parallel, AI extraction) has
    // already run or been skipped by the time this arrives. There is no
    // "still awaiting" state to check for.
    //
    // What there IS, is two different questions -- and they used to be
    // collapsed into one `isComplete = conclusion !== "timed_out"` flag that
    // drove every consequence at once:
    //
    //   `leadStatus`    -- did the waterfall reach a terminal state, and may
    //                      a human need to look? Pure RETRY CONTROL: only
    //                      PENDING is re-claimed by pollPendingEnrichment, so
    //                      a lead that ran every stage and found nothing must
    //                      still come to rest (COMPLETE) or the full paid
    //                      waterfall re-runs on it every few minutes forever.
    //                      FLAGGED_REVIEW is terminal in the same way.
    //   `fullyEnriched` -- did it actually come back enriched? The pipeline's
    //                      OWN verdict (orchestrator.py: `enrichment_complete`
    //                      iff every one of core/schema.py's CRITICAL_FIELDS
    //                      -- Email_Address, Contact_Number, Years_of_Exp --
    //                      is populated). Gates the recruiter-facing
    //                      consequences only.
    //
    // This function's contract always claimed it trusted `enrichment_status`
    // ("never on a bare 'the HTTP call returned 200' basis"), but the field
    // was never actually read, so ANY lead that did not time out was stamped
    // identityResolved + promotedToGlobalAt and pushed into the global
    // recruiter pool. Measured 2026-10-01: a real 20-lead batch concluded
    // `exhausted_no_match` on all 20 while the pipeline reported 17 of them
    // `enrichment_partial` (67-94% of fields, no contact details), and the
    // live table read 139/139 COMPLETE -- "COMPLETE" meant "did not time
    // out", never "is enriched". See lib/enrichmentVerdict.ts.
    const conclusion = data?.conclusion as "short_circuit_success" | "exhausted_no_match" | "timed_out" | null | undefined;
    // `identity_match` answers a question nothing else in this response does:
    // is this the person we went looking for? A lead whose profileLink points
    // at someone else comes back looking beautifully complete -- every field
    // populated, just about the wrong human. See core/dedup.py's
    // score_identity_match ("Danny M" case).
    const identityMatch = data?.identity_match as
      | { verdict?: string; confidence?: number | null; input_name?: string; resolved_name?: string; reason?: string }
      | undefined;

    const { fullyEnriched, unrecognizedStatus, identityFlagged, leadStatus, incompleteProfile } = computeEnrichmentVerdict({
      conclusion,
      enrichmentStatus: data?.enrichment_status,
      identityVerdict: identityMatch?.verdict,
      source: lead.source,
      parallelState: returnedFieldSources._parallel_fallback,
    });

    if (identityFlagged) {
      console.warn(
        `[enrichment.job] lead ${lead.id} flagged for identity review (${identityMatch?.verdict}, ` +
          `confidence ${identityMatch?.confidence}): submitted ${JSON.stringify(identityMatch?.input_name)} vs ` +
          `resolved ${JSON.stringify(identityMatch?.resolved_name)} -- ${identityMatch?.reason}`
      );
    }
    if (unrecognizedStatus) {
      console.error(
        `[enrichment.job] lead ${lead.id}: unrecognized enrichment_status ${JSON.stringify(data?.enrichment_status)} -- treating as not fully enriched`
      );
    }

    // On Hold is driven by the waterfall's own conclusion state, a LinkedIn
    // lead Parallel never returned the complete profile for (incompleteProfile),
    // or the recruiter's own manual toggle -- never by field count/contact
    // presence (that was the old, corrected behavior). See
    // computeOnHoldTransition for the shared rules (MANUAL never
    // auto-clears).
    const { flags, onHoldReason } = computeOnHoldTransition({
      currentFlags: (lead.flags as string[]) || [],
      currentOnHoldReason: lead.onHoldReason,
      outcome: conclusion === "timed_out" ? "timed_out" : incompleteProfile ? "incomplete_profile" : "concluded_normally",
    });

    // Parallel's raw Task Run output (see orchestrator.py's parallel_fallback
    // / providers/parallel_client.py's LeadProfile) -- stored verbatim,
    // same "nothing dropped" principle Clay's old clayData followed, now
    // arriving synchronously in this same response instead of via a
    // separate webhook. `called: false` (skipped/already-ran) or a failed
    // call carries no `data` key, so this only ever replaces parallelData
    // with a genuine result, never clobbers a prior one with nothing.
    const parallelResult = data?.parallel_fallback?.data as Record<string, any> | undefined;

    // Deletion is re-checked HERE rather than only at entry because the call
    // above legitimately takes minutes: the recycle-bin click almost always
    // lands during the provider round-trip, not before it. `count` is 0 when
    // that happened, which is what gates the notification below.
    const { count: leadWriteCount } = await prisma.lead.updateMany({
      where: { id: lead.id, deletedAt: null },
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
        // Gates the global recruiter pool together with enrichmentStatus
        // (lead.routes.ts's recruiter scope: `{ identityResolved: true,
        // enrichmentStatus: "COMPLETE" }`), so a lead missing email/phone/YoE
        // no longer reaches every recruiter as a finished record.
        identityResolved: fullyEnriched,
        // Deliberately `concluded`, NOT `fullyEnriched`: this is the retry
        // switch, and a concluded-but-thin lead must stop being re-claimed by
        // pollPendingEnrichment rather than re-running the paid waterfall
        // forever. It now means "automation is done with this lead", while
        // identityResolved above carries "and it actually came back full".
        enrichmentStatus: leadStatus,
        // Both columns existed in the schema from the start and nothing ever
        // wrote to them -- linkedinMatchConfidence is even labelled "Danny M
        // case" there. null means this run made no claim (no name to compare
        // / no years resolved), which is distinct from a low score.
        linkedinMatchConfidence: identityMatch?.confidence ?? null,
        yoeConfidence: (data?.yoe_confidence as number | null | undefined) ?? null,
        flags: flags as any,
        onHoldReason,
        promotedToGlobalAt: fullyEnriched ? new Date() : undefined,
        justEnrichedUntil: fullyEnriched ? new Date(Date.now() + 24 * 3600_000) : undefined,
      },
    });

    // Ping the contractor who added this lead once it's actually done, not on
    // a bare "the call returned" basis. Keyed to `fullyEnriched`, not
    // `concluded`: the message says the profile "is now fully filled in", so
    // sending it for a lead that came back 67% complete with no contact
    // details would simply be untrue. Fires regardless of entry path (poll
    // job or immediate Add-Lead/bulk-upload call) since both funnel through
    // this same function.
    if (fullyEnriched && leadWriteCount > 0 && lead.createdByContractorId) {
      const leadName = enrichedDisplayName || lead.maskedLabel || "your lead";
      createNotification({
        recipientId: lead.createdByContractorId,
        type: "ENRICHMENT_COMPLETE",
        title: `Enrichment finished for ${leadName}`,
        body: `enrichment finished for ${leadName} -- their profile is now fully filled in.`,
        slackCard: formatEnrichmentCompleteSlackCard(leadName, "/contractor"),
        link: "/contractor/leads",
      }).catch((err) => console.error(`[enrichment.job] enrichment-complete notify failed for lead ${lead.id}:`, err));
    }

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
    await prisma.lead.updateMany({
      where: { id: lead.id, deletedAt: null },
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
  } finally {
    inFlightLeadIds.delete(lead.id);
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
      // Never re-touch a lead sitting in the Global Leads recycle bin.
      deletedAt: null,
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
 *  CLAIMS each lead atomically (claimNextPendingLead's updateMany re-checks
 *  enrichmentStatus: "PENDING" in its WHERE clause), one per free worker, and
 *  drains the queue with bounded concurrency rather than one at a time.
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
 *  The re-checked WHERE clause on claimNextPendingLead's updateMany is what
 *  actually prevents this -- it is a single atomic statement, so if a
 *  concurrent call claims a lead first, this run's updateMany simply does not
 *  match that row (Postgres's own row-level locking makes the two claims
 *  mutually exclusive, not application-level coordination). `enrichLeadById`
 *  is left unchanged: it is also called directly and unconditionally from
 *  lead.routes.ts (immediate enrichment on single Add Lead), where "claim
 *  first" does not apply -- a human just triggered exactly this one lead.
 *  Bulk upload and Sheet import no longer call it directly; they queue
 *  PENDING leads and kick this function. */
export async function pollPendingEnrichment() {
  // See pollInFlight's own comment above -- skip this tick entirely rather
  // than let it stack a second concurrent claim-and-process cycle on top of
  // one still running.
  if (pollInFlight) {
    console.log("[enrichment.job] pollPendingEnrichment: previous run still in flight, skipping this tick");
    return;
  }
  pollInFlight = true;
  try {
    // Drains the whole PENDING queue, POLL_CONCURRENCY at a time, claiming
    // one lead per free worker (see lib/drainWithConcurrency.ts for why not a
    // fixed batch). Leads that land mid-drain (a bulk upload) are picked up by
    // the same workers; pollInFlight makes every tick a no-op until it's empty.
    // Terminates: every enrichLeadById outcome leaves the lead non-PENDING or
    // ON_HOLD (computeOnHoldTransition), so nothing is claimed twice in a loop.
    await drainWithConcurrency(POLL_CONCURRENCY, claimNextPendingLead, async (leadId) => {
      // enrichLeadById's own catch path handles a failed call (reverts to
      // PENDING, flags ON_HOLD/SYSTEM_ERROR) -- this outer catch exists only so
      // one lead throwing something outside that try/catch (a bug, not a
      // provider failure) can't take the whole drain down, mirroring
      // every other fire-and-forget call site's `.catch((err) => console.error(...))`.
      await enrichLeadById(leadId).catch((err) =>
        console.error(`[enrichment.job] pollPendingEnrichment: lead ${leadId} failed:`, err)
      );
    });
  } finally {
    pollInFlight = false;
  }
}

/** Atomically claims the next PENDING lead to enrich, or null when none is
 *  left. "Next" is fair across uploaders (lib/pickNextFair.ts): the oldest
 *  eligible lead of whoever has the fewest leads in flight, so one big upload
 *  can't hold every slot while someone else's small one waits. The re-checked
 *  `enrichmentStatus: "PENDING"` in the updateMany WHERE is the claim: if
 *  anything else (another drain worker, or enrichLeadById called directly
 *  from lead.routes.ts) took the row between the read and the write, the
 *  update matches nothing and we just pick again. */
async function claimNextPendingLead(): Promise<string | null> {
  if (stopClaiming) return null; // shutting down: let the drain wind down
  for (;;) {
    const [inFlight, heads] = await Promise.all([
      prisma.$queryRaw<{ owner: string; n: bigint }[]>`
        SELECT COALESCE(created_by_recruiter_id, created_by_contractor_id, 'unowned') AS owner, COUNT(*) AS n
        FROM leads
        WHERE enrichment_status = 'IN_PROGRESS' AND deleted_at IS NULL
        GROUP BY 1`,
      // DISTINCT ON in SQL, not Prisma's `distinct` (which dedupes in memory
      // after fetching every pending row).
      prisma.$queryRaw<QueueHead[]>`
        SELECT DISTINCT ON (owner) id, owner, created_at AS "createdAt"
        FROM (
          SELECT id, created_at, COALESCE(created_by_recruiter_id, created_by_contractor_id, 'unowned') AS owner
          FROM leads
          WHERE enrichment_status = 'PENDING' AND deleted_at IS NULL AND NOT ('ON_HOLD' = ANY(flags))
        ) pending
        ORDER BY owner, created_at`,
    ]);
    const next = pickNextFair(heads, new Map(inFlight.map((row) => [row.owner, Number(row.n)])));
    if (!next) return null;
    const { count } = await prisma.lead.updateMany({
      where: { id: next.id, enrichmentStatus: "PENDING", deletedAt: null },
      data: { enrichmentStatus: "IN_PROGRESS", enrichmentStartedAt: new Date() },
    });
    if (count === 1) return next.id;
  }
}

/** Graceful shutdown, step 1: claim nothing new (running drains finish their
 *  current lead and stop). */
export function stopClaimingEnrichments() {
  stopClaiming = true;
}

/** Graceful shutdown, step 2: resolves once every enrichment this process
 *  started has finished, or after `timeoutMs`. */
export async function waitForActiveEnrichments(timeoutMs: number, pollMs = 1000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (inFlightLeadIds.size > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Leads left IN_PROGRESS by an earlier process (one that crashed, or was
 *  killed before its graceful shutdown could requeue them). A lead this
 *  process claims gets enrichmentStartedAt >= bootTime (enrichLeadById
 *  re-stamps it when it starts), so anything older can't be ours.
 *
 *  ponytail: only correct with ONE backend running jobs per database --
 *  another live backend's in-flight leads look orphaned too. That's already
 *  the deployment rule (cronLock.ts, docs/DOCKER_DEPLOY.md); the upgrade path
 *  is tagging each claim with its process. */
export function orphanedEnrichmentsWhere(bootTime: Date) {
  return {
    enrichmentStatus: "IN_PROGRESS" as const,
    deletedAt: null,
    OR: [{ enrichmentStartedAt: { lt: bootTime } }, { enrichmentStartedAt: null }],
  };
}

export async function requeueOrphanedEnrichments(bootTime: Date): Promise<number> {
  const { count } = await prisma.lead.updateMany({
    where: orphanedEnrichmentsWhere(bootTime),
    data: { enrichmentStatus: "PENDING", enrichmentStartedAt: null },
  });
  if (count > 0) console.warn(`[enrichment.job] requeued ${count} lead(s) left IN_PROGRESS by an earlier process`);
  return count;
}
