/** Brings every Parallel-eligible lead in the database onto Parallel-sourced
 * Tier 2 data, so enrichment provenance is consistent across the whole table
 * rather than split between leads enriched before and after the Clay swap.
 *
 * Skips leads already carrying `_parallel_fallback: "complete"` (their Tier 2
 * pass already ran against Parallel -- re-running would re-pay for the same
 * result), and clears a stale `"failed"` marker first, since orchestrator.py's
 * `already_ran` gate treats ANY existing value as "already attempted" and
 * would otherwise skip the lead forever.
 *
 * Tier 2 runs for every platform (the LinkedIn-only gate was a Clay holdover
 * -- see orchestrator.py's _run_parallel_stage), so eligibility here is
 * simply "has a profile URL to research". A lead with no Profile_Link at all
 * is reported as ineligible rather than silently counted as done.
 *
 * Run via: cd server && npx ts-node scripts/enrich-all-with-parallel.ts [--force]
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/prisma";
import { enrichLeadById } from "../src/jobs/enrichment.job";
import { countPopulatedFields } from "../src/lib/enrichmentCount";

const FORCE = process.argv.includes("--force");
const hasProfileUrl = (l: { profileLink: string | null }) => !!(l.profileLink || "").trim();

async function main() {
  const all = await prisma.lead.findMany();
  const eligible = all.filter(hasProfileUrl);
  const ineligible = all.filter((l) => !hasProfileUrl(l));

  const parallelState = (l: any) => ((l.fieldSources as Record<string, string> | null) || {})._parallel_fallback ?? null;
  const todo = FORCE ? eligible : eligible.filter((l) => parallelState(l) !== "complete");

  console.log(`${all.length} leads total`);
  console.log(`  ${eligible.length} Parallel-eligible (has a profile URL)`);
  console.log(`  ${eligible.length - todo.length} already parallel=complete, skipping`);
  console.log(`  ${todo.length} to enrich now`);
  console.log(`  ${ineligible.length} NOT Parallel-eligible (no profile URL to research):`);
  for (const l of ineligible) console.log(`      - ${l.fullName} [${l.source}] ${l.profileLink || "(no profile link)"}`);
  console.log("");

  const results: any[] = [];
  let done = 0;

  for (const before of todo) {
    done++;
    console.log(`\n[${done}/${todo.length}] ${before.fullName} — ${before.profileLink}`);

    // Clear a stale terminal marker so the orchestrator actually re-attempts.
    const existing = (before.fieldSources as Record<string, string> | null) || {};
    if (existing._parallel_fallback) {
      const cleared = { ...existing };
      delete cleared._parallel_fallback;
      await prisma.lead.update({ where: { id: before.id }, data: { fieldSources: cleared as any } });
      console.log(`  cleared stale _parallel_fallback="${existing._parallel_fallback}"`);
    }

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
    const state = parallelState(after);
    console.log(`  parallel=${state ?? "(not set)"}  fields ${countBefore}->${countPopulatedFields(after)}  status=${after.enrichmentStatus}`);

    results.push({
      id: before.id,
      fullName: before.fullName,
      profileLink: before.profileLink,
      parallelState: state,
      enrichedFieldCount: { before: countBefore, after: countPopulatedFields(after) },
      enrichmentStatus: after.enrichmentStatus,
      hasParallelData: !!after.parallelData,
      enrichError,
    });
  }

  const outDir = path.join(__dirname, "__output__");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "enrich-all-parallel.json"), JSON.stringify({ results, ineligible: ineligible.map((l) => ({ fullName: l.fullName, source: l.source, profileLink: l.profileLink })) }, null, 2));

  const ok = results.filter((r) => r.parallelState === "complete").length;
  console.log(`\n=== ${ok}/${results.length} reached parallel=complete ===`);
  for (const r of results.filter((r) => r.parallelState !== "complete")) {
    console.log(`  NOT complete: ${r.fullName} -> ${r.parallelState ?? "(not set)"} ${r.enrichError ? "(" + r.enrichError + ")" : ""}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
