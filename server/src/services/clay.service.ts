import { prisma } from "../prisma";
import { config } from "../config";
import { candidateRoleOf } from "../lib/messageTemplates";

/** Clay's own field names for its "Enrich person" action (verified against
 * real captured payloads during the POC, not guessed) -- this is a
 * translation layer onto the canonical Lead columns, mirroring
 * enrichment_pipeline's providers/clay_field_mapping.py so both sides of the
 * pipeline agree on what Clay's raw fields mean.
 */
function mapClayEnrichment(raw: Record<string, any>) {
  const canonical: Record<string, any> = {};

  const about = raw.summary || raw.about;
  if (about) canonical.aboutSnippet = about;

  if (raw.headline) canonical.headline = raw.headline;
  if (raw.title) canonical.currentTitle = raw.title;

  const certifications = raw.certifications;
  if (Array.isArray(certifications) && certifications.length) {
    canonical.certifications = certifications.map((c: any) => (typeof c === "string" ? c : c?.name || c?.title || String(c))).filter(Boolean);
  }

  const country = raw.country || raw.location_name;
  if (country) canonical.country = country;

  const fullName = raw.name || raw.fullName;
  if (fullName) canonical.displayName = fullName;

  return canonical;
}

/** Was previously a curated subset (experience/education/languages/courses/
 * projects/currentExperience only) -- explicitly changed to store the ENTIRE
 * raw Clay payload verbatim instead. Any field-by-field curation silently
 * drops whatever wasn't anticipated (e.g. `connections`, `jobs_count`,
 * `volunteering`, `structured_location` are all real keys Clay sends that the
 * old curated list never captured) -- the storage layer should be lossless;
 * deciding what's *useful* for a prompt belongs to the drafting layer, not
 * here. `clayData` on the Lead row is therefore just `rawEnrichment` as-is.
 */

export class ClayService {
  /** Stage 3: matches Clay's outbound webhook payload back to the Lead it
   * belongs to, patches in only the fields Clay actually returned (never
   * overwrites with something empty), stamps fieldSources: "clay" for each,
   * and clears the Stage-3.5 "_clay_dispatch" pending marker so a future
   * /enrich call for this lead doesn't think Clay is still awaited.
   *
   * `token`/`secretHeader` verification mirrors UnipileService.handleWebhookEvent
   * exactly -- same two-factor "opaque path token + secret header" defense,
   * since this route is necessarily public (Clay can't hold our session auth).
   */
  static async handleWebhookEvent(token: string, secretHeader: string | undefined, body: any) {
    if (token !== config.clayWebhookPathToken) {
      throw { statusCode: 401, message: "Invalid webhook path token" };
    }
    if (secretHeader !== config.clayWebhookSecret) {
      throw { statusCode: 401, message: "Invalid webhook secret header" };
    }

    const correlationId = body?.source_row_index;
    const rawEnrichment = body?.linkedin_enrichment;
    if (!correlationId || typeof rawEnrichment !== "object" || rawEnrichment === null) {
      throw { statusCode: 400, message: "Payload must include source_row_index and linkedin_enrichment" };
    }

    // orchestrator.py's Stage 3.5 uses Profile_Link itself as the
    // correlation id (no separate lead-id field crosses the /enrich
    // boundary today) -- match the same way here.
    const lead = await prisma.lead.findFirst({ where: { profileLink: correlationId } });
    if (!lead) {
      return { status: "no_matching_lead", correlationId };
    }

    const patch = mapClayEnrichment(rawEnrichment);

    // `contact_details` is a TOP-LEVEL sibling of linkedin_enrichment in the
    // body (from the "Personal Email" finder column), not nested inside it --
    // was being silently dropped entirely. This is the one field that
    // actually unlocks email drafts and genuine COMPLETE status, so validate
    // and apply it here. Fill-only: never overwrite a real email already on
    // file, same convention as the manual TO-field fix on the email route.
    const rawEmail = typeof body?.contact_details === "string" ? body.contact_details.trim() : "";
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
    if (isValidEmail && !lead.email) {
      patch.email = rawEmail;
    }

    const hasRawData = Object.keys(rawEnrichment).length > 0;
    if (Object.keys(patch).length === 0 && !hasRawData) {
      // Clay still answered -- just with nothing usable (e.g. its waterfall
      // genuinely found no data for this profile). That's still "Clay gave
      // us its response, this is the max obtainable" -- clear the dispatch
      // marker so enrichLeadById's next pass doesn't wait on this forever,
      // and mark the lead terminal/Enriched rather than leaving it stuck
      // PENDING with no automated step left to try.
      const fieldSources = { ...((lead.fieldSources as Record<string, string>) || {}) };
      fieldSources._clay_dispatch = "complete";
      const currentFlags = ((lead.flags as string[]) || []).filter((f) => f !== "ON_HOLD");
      const hasContact = !!(lead.email || lead.contactNumber);
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          fieldSources: fieldSources as any,
          identityResolved: true,
          enrichmentStatus: "COMPLETE",
          flags: (hasContact ? currentFlags : Array.from(new Set([...currentFlags, "ON_HOLD"]))) as any,
          promotedToGlobalAt: new Date(),
          justEnrichedUntil: new Date(Date.now() + 24 * 3600_000),
        },
      });
      return { status: "empty_enrichment", leadId: lead.id };
    }

    const fieldSources = { ...((lead.fieldSources as Record<string, string>) || {}) };
    for (const key of Object.keys(patch)) {
      fieldSources[key] = "clay";
    }
    // Clear the Stage 3.5 dispatch marker -- Clay has now answered, so a
    // future re-enrichment of this lead shouldn't skip Clay believing it's
    // still awaiting a pending result.
    fieldSources._clay_dispatch = "complete";

    // "Enriched" means the pipeline reached a terminal state, not "we have a
    // way to contact them" -- Clay having responded with something usable
    // (we're past the empty-response early-return above) IS that terminal
    // state: whatever it found is the maximum obtainable for this profile
    // automatically, so enrichmentStatus goes to COMPLETE unconditionally
    // below. ON_HOLD stays a separate, reachability-specific signal:
    // "enrichment is done, but we still have no contact info" -- not a
    // progress indicator.
    const hasContact = !!(patch.email || patch.contactNumber || lead.email || lead.contactNumber);
    const currentFlags = ((lead.flags as string[]) || []).filter((f) => f !== "ON_HOLD");

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...patch,
        // Keep the prior payload if this particular webhook event didn't
        // Merge onto any prior payload (per-key, new wins) rather than
        // replacing wholesale -- a later, thinner event (e.g. a stale
        // AI-agent column re-firing) shouldn't wipe out richer data an
        // earlier event already captured for keys it doesn't itself carry.
        clayData: { ...((lead.clayData as Record<string, any>) || {}), ...rawEnrichment } as any,
        fieldSources: fieldSources as any,
        // We now know the lead's real identity/profile content even without
        // contact info -- separate concept from "can we reach them yet".
        identityResolved: true,
        enrichmentStatus: "COMPLETE" as const,
        flags: (hasContact ? currentFlags : Array.from(new Set([...currentFlags, "ON_HOLD"]))) as any,
        promotedToGlobalAt: new Date(),
        justEnrichedUntil: new Date(Date.now() + 24 * 3600_000),
      },
    });

    // Same dashboard-sync side effect enrichLeadById performs -- keep the
    // service tag current on any queued draft for this lead.
    const candidateRole = candidateRoleOf(lead.services, lead.targetLanguage);
    await prisma.emailQueueItem.updateMany({ where: { leadId: lead.id }, data: { candidateRole } }).catch(() => {});
    await prisma.conversation.updateMany({ where: { leadId: lead.id }, data: { candidateRole } }).catch(() => {});

    return { status: "applied", leadId: lead.id, fieldsUpdated: Object.keys(patch) };
  }
}
