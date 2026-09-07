/** One-off validation run for the Clay -> Parallel Tier 2 swap: picks the 10
 * most-enriched leads currently in the database (any source, ranked by the
 * same enrichedFieldCount metric the UI uses), runs each through the REAL
 * enrichment flow (enrichLeadById -- this calls the live enrichment_pipeline
 * service, which calls Parallel for real for any LinkedIn-sourced lead among
 * them, and persists the result onto that lead's actual row), then runs each
 * through the real drafting orchestrator and captures the draft.
 *
 * Writes one JSON file per run to scripts/__output__/parallel-swap-top10.json
 * for a follow-up report -- not meant to be a permanent pipeline component.
 *
 * Run via: cd server && npx ts-node scripts/test-parallel-swap-top10.ts
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/prisma";
import { enrichLeadById } from "../src/jobs/enrichment.job";
import { countPopulatedFields } from "../src/lib/enrichmentCount";
import { buildDraftLeadPayload } from "../src/lib/draftLeadPayload";
import { getDraftingOrchestrator } from "../src/drafting/instance";

const SNAPSHOT_FIELDS = [
  "fullName", "email", "contactNumber", "country", "yearsOfExperience",
  "vendorExperience", "headline", "currentTitle", "aboutSnippet",
  "toolsSoftware", "certifications", "services", "sourceLanguage",
  "targetLanguage", "secondaryLanguages",
] as const;

function snapshot(lead: any) {
  const out: Record<string, any> = {};
  for (const f of SNAPSHOT_FIELDS) {
    const v = lead[f];
    out[f] = v && typeof v === "object" && "toNumber" in v ? v.toNumber() : v;
  }
  return out;
}

async function main() {
  const allLeads = await prisma.lead.findMany();
  const ranked = allLeads
    .map((lead) => ({ lead, count: countPopulatedFields(lead) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  console.log(`Selected top ${ranked.length} leads by enrichedFieldCount:`);
  for (const { lead, count } of ranked) {
    console.log(`  - ${lead.fullName || lead.id} (${lead.source}) count=${count} profileLink=${lead.profileLink}`);
  }
  console.log("");

  const results: any[] = [];

  for (const { lead: before, count: countBefore } of ranked) {
    console.log(`\n=== Enriching: ${before.fullName || before.id} ===`);
    const isLinkedIn = /linkedin\.com\/(in|sales)\//i.test(before.profileLink || "");
    console.log(`  Source=${before.source} isLinkedInProfile=${isLinkedIn} (Parallel only ever fires for LinkedIn leads)`);

    let enrichError: string | null = null;
    try {
      await enrichLeadById(before.id);
    } catch (err: any) {
      enrichError = err?.message || String(err);
      console.error(`  enrichLeadById threw: ${enrichError}`);
    }

    const after = await prisma.lead.findUnique({ where: { id: before.id } });
    if (!after) {
      console.error(`  Lead ${before.id} disappeared?!`);
      continue;
    }

    const countAfter = countPopulatedFields(after);
    const fieldSources = (after.fieldSources as Record<string, string> | null) || {};
    const parallelState = fieldSources._parallel_fallback ?? null;
    const parallelData = (after.parallelData as Record<string, any> | null) || null;

    console.log(`  enrichedFieldCount: ${countBefore} -> ${countAfter}`);
    console.log(`  enrichmentStatus: ${before.enrichmentStatus} -> ${after.enrichmentStatus}`);
    console.log(`  _parallel_fallback state: ${parallelState ?? "(not set -- non-LinkedIn or skipped)"}`);
    console.log(`  parallelData present: ${!!parallelData}`);

    let draft: any = null;
    let draftError: string | null = null;
    try {
      const payload = buildDraftLeadPayload(after, after.email);
      draft = await getDraftingOrchestrator().processDraft(payload, "email", true);
      console.log(`  Draft verdict: ${draft.verdict}`);
    } catch (err: any) {
      draftError = err?.message || String(err);
      console.error(`  processDraft threw: ${draftError}`);
    }

    results.push({
      id: before.id,
      fullName: before.fullName,
      source: before.source,
      profileLink: before.profileLink,
      isLinkedInProfile: isLinkedIn,
      enrichedFieldCount: { before: countBefore, after: countAfter },
      enrichmentStatus: { before: before.enrichmentStatus, after: after.enrichmentStatus },
      fieldSources,
      parallelFallbackState: parallelState,
      parallelData,
      before: snapshot(before),
      after: snapshot(after),
      enrichError,
      draft,
      draftError,
    });
  }

  const outDir = path.join(__dirname, "__output__");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "parallel-swap-top10.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote full results to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
