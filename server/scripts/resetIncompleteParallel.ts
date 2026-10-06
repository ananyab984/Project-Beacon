/**
 * Re-opens Parallel for LinkedIn leads the old bar stamped `complete` on a
 * result that was not the profile.
 *
 * Why these rows need fixing rather than just re-enriching: orchestrator.py
 * used to settle `_parallel_fallback = "complete"` as soon as ANY one field
 * came back -- Country alone was enough -- and a settled lead is never sent to
 * Parallel again, however many times it is re-enriched. Christopher Boyce is
 * the reported case: Enriched, Country from Parallel, everything else empty.
 *
 * For each match this clears the marker (so Parallel runs again, on the new
 * completeness bar) and sets enrichmentStatus back to PENDING (so the poll job
 * picks it up). A lead carrying ON_HOLD is skipped: the poll job excludes it
 * anyway, and a recruiter's own hold is theirs to lift.
 *
 * ponytail: matches on "parallelData has neither headline nor current_title",
 * the dominant shape of the old false-complete. It does not replicate
 * orchestrator.py's per-section check (_parallel_completeness), so a stored
 * result with a headline but an empty detected section is not re-opened here.
 * Upgrade path: re-open on that full check if such leads turn up.
 *
 * Dry run by default: prints the matches and writes nothing.
 *   npx ts-node scripts/resetIncompleteParallel.ts
 *   npx ts-node scripts/resetIncompleteParallel.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

async function main() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, source: "LINKEDIN", NOT: { flags: { has: "ON_HOLD" } } },
    select: { id: true, fullName: true, displayName: true, fieldSources: true, parallelData: true },
    orderBy: { createdAt: "asc" },
  });

  const matches = leads.filter((l) => {
    const sources = (l.fieldSources ?? {}) as Record<string, string>;
    const parallel = (l.parallelData ?? {}) as Record<string, unknown>;
    return sources._parallel_fallback === "complete" && !has(parallel.headline) && !has(parallel.current_title);
  });

  console.log(`Scanned ${leads.length} LinkedIn leads.`);
  if (matches.length === 0) {
    console.log("No falsely-complete Parallel results found.");
    return;
  }
  console.log(`\n${matches.length} lead(s) would be re-opened for Parallel:\n`);
  for (const l of matches) console.log(`  ${(l.fullName || l.displayName || "(unnamed)").slice(0, 40)}  ${l.id}`);

  if (!APPLY) {
    console.log("\nDry run -- nothing written. Re-run with --apply to commit these changes.");
    return;
  }

  for (const l of matches) {
    const { _parallel_fallback, _parallel_core_count, ...rest } = (l.fieldSources ?? {}) as Record<string, string>;
    await prisma.lead.update({ where: { id: l.id }, data: { fieldSources: rest, enrichmentStatus: "PENDING" } });
  }
  console.log(`\nDone. ${matches.length} lead(s) re-opened; the poll job will re-enrich them.`);
}

main()
  .catch((err) => {
    console.error("resetIncompleteParallel failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
