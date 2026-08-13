import axios from "axios";
import { prisma } from "../prisma";
import { config } from "../config";

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
      data: { enrichmentStatus: "IN_PROGRESS" },
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
    }

    // Trust the pipeline's own verdict: "enrichment_complete" means it
    // confirmed every critical field (Email_Address, Contact_Number,
    // Years_of_Exp) is now populated; "enrichment_partial" (or anything
    // else/missing) means at least one is still unresolved -- that's a real
    // gap, not something to paper over as "enriched anyway".
    const pipelineStatus = String(data?.enrichment_status || "").toLowerCase();
    const isComplete = pipelineStatus === "enrichment_complete";

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        email: enrichedEmail,
        contactNumber: enrichedContactNumber,
        yearsOfExperience: enrichedYearsOfExp,
        vendorExperience: enrichedVendorExp,
        displayName: enrichedDisplayName,
        identityResolved: isComplete,
        enrichmentStatus: isComplete ? "COMPLETE" : "FLAGGED_REVIEW",
        promotedToGlobalAt: isComplete ? new Date() : undefined,
        justEnrichedUntil: isComplete ? new Date(Date.now() + 24 * 3600_000) : undefined,
      },
    });

    if (!isComplete) {
      console.warn(
        `[enrichment.job] lead ${lead.id} left FLAGGED_REVIEW -- pipeline status=${pipelineStatus || "unknown"}, ` +
          `missing critical fields: ${(data?.audit?.missing_critical_fields || []).join(", ") || "unknown"}`
      );
    }
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
