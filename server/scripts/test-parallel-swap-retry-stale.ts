/** Companion to test-parallel-swap-top10.ts: re-runs the leads whose
 * Stage 3.5 marker is a STALE `_parallel_fallback: "failed"` left over from
 * an earlier run against the broken per-call-timeout config.
 *
 * orchestrator.py's `already_ran` gate treats ANY existing
 * `_parallel_fallback` value (including "failed") as "already attempted, do
 * not re-call", so those leads get silently SKIPPED forever rather than
 * re-attempted -- even after the root cause is fixed. This clears just that
 * one key (leaving every other fieldSources entry untouched) so the lead
 * gets a genuine fresh Parallel attempt, then runs the same
 * enrichment + drafting capture as the main script.
 *
 * Run via: cd server && npx ts-node scripts/test-parallel-swap-retry-stale.ts
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

// Leads to force a fresh Parallel attempt for. Pass names on argv to
// override; defaults to the three that were skipped in the top-10 run
// because of a stale "failed" marker from the broken-timeout run. Targeted
// by name rather than by marker value because clearing the marker (below) is
// itself what makes a lead no longer match a marker-based filter -- an
// interrupted run would otherwise silently skip whatever it already cleared.
const DEFAULT_TARGETS = ["ananth", "Mathumitha", "Enver XIN"];

async function main() {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS;
  const all = await prisma.lead.findMany();
  const stale = all.filter((l) => targets.some((t) => (l.fullName || "").includes(t)));

  console.log(`Forcing a fresh Parallel attempt for ${stale.length} lead(s) (targets: ${targets.join(", ")}):`);
  for (const l of stale) console.log(`  - ${l.fullName} (${l.profileLink})`);
  console.log("");

  const results: any[] = [];

  for (const before of stale) {
    console.log(`\n=== Clearing stale marker + re-enriching: ${before.fullName} ===`);
    const cleared = { ...((before.fieldSources as Record<string, string> | null) || {}) };
    delete cleared._parallel_fallback;
    await prisma.lead.update({
      where: { id: before.id },
      data: { fieldSources: cleared as any },
    });
    console.log("  stale _parallel_fallback marker cleared");

    const countBefore = countPopulatedFields(before);
    let enrichError: string | null = null;
    try {
      await enrichLeadById(before.id);
    } catch (err: any) {
      enrichError = err?.message || String(err);
      console.error(`  enrichLeadById threw: ${enrichError}`);
    }

    const after = await prisma.lead.findUnique({ where: { id: before.id } });
    if (!after) continue;

    const countAfter = countPopulatedFields(after);
    const fieldSources = (after.fieldSources as Record<string, string> | null) || {};
    console.log(`  enrichedFieldCount: ${countBefore} -> ${countAfter}`);
    console.log(`  _parallel_fallback state: ${fieldSources._parallel_fallback ?? "(not set)"}`);

    let draft: any = null;
    let draftError: string | null = null;
    try {
      draft = await getDraftingOrchestrator().processDraft(buildDraftLeadPayload(after, after.email), "email", true);
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
      isLinkedInProfile: /linkedin\.com\/(in|sales)\//i.test(before.profileLink || ""),
      enrichedFieldCount: { before: countBefore, after: countAfter },
      enrichmentStatus: { before: before.enrichmentStatus, after: after.enrichmentStatus },
      fieldSources,
      parallelFallbackState: fieldSources._parallel_fallback ?? null,
      parallelData: after.parallelData,
      before: snapshot(before),
      after: snapshot(after),
      enrichError,
      draft,
      draftError,
    });
  }

  const outDir = path.join(__dirname, "__output__");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "parallel-swap-retry-stale.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote results to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
