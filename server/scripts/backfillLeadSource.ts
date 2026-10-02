/**
 * Re-derives `source` for existing leads using the same detection the create
 * paths now use (src/lib/detectLeadSource.ts), correcting rows written before
 * that fix landed.
 *
 * Why these rows need fixing rather than just aging out: `source` is what
 * enrichment_pipeline/core/source_router.py routes on. A row stuck at
 * LINKEDIN with a bodalgo.com link sends every re-enrichment to Bright Data,
 * which rejects it outright (`validation_error: Value should match pattern
 * .*linkedin`) -- a guaranteed-to-fail Tier 1 call, forever, on each run.
 *
 * Dry run by default: prints the exact diff and writes nothing.
 *   npx ts-node scripts/backfillLeadSource.ts
 *   npx ts-node scripts/backfillLeadSource.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { detectLeadSource } from "../src/lib/detectLeadSource";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  // Only rows with a profile link: that link is the evidence detection runs
  // on. A lead without one has nothing new to learn from, and re-deriving it
  // from the label alone would churn rows without improving them.
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, NOT: { profileLink: null } },
    select: { id: true, fullName: true, displayName: true, source: true, profileLink: true },
    orderBy: { createdAt: "asc" },
  });

  const changes = leads
    .map((l) => ({ lead: l, next: detectLeadSource(l.source, l.profileLink) }))
    .filter(({ lead, next }) => next !== lead.source);

  console.log(`Scanned ${leads.length} leads with a profile link.`);
  if (changes.length === 0) {
    console.log("No source corrections needed.");
    return;
  }

  console.log(`\n${changes.length} row(s) would change:\n`);
  for (const { lead, next } of changes) {
    const name = lead.fullName || lead.displayName || "(unnamed)";
    console.log(`  ${name.slice(0, 28).padEnd(28)} ${lead.source.padEnd(10)} -> ${next.padEnd(10)} ${lead.profileLink}`);
  }

  if (!APPLY) {
    console.log("\nDry run -- nothing written. Re-run with --apply to commit these changes.");
    return;
  }

  // Grouped by target value so this is one UPDATE per distinct source rather
  // than one per row; the set is small either way, but it keeps the write a
  // handful of statements instead of N round trips to Neon.
  const byNext = new Map<string, string[]>();
  for (const { lead, next } of changes) {
    byNext.set(next, [...(byNext.get(next) ?? []), lead.id]);
  }

  let updated = 0;
  for (const [next, ids] of byNext) {
    const res = await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { source: next as any },
    });
    updated += res.count;
    console.log(`  updated ${res.count} row(s) -> ${next}`);
  }
  console.log(`\nDone. ${updated} row(s) corrected.`);
}

main()
  .catch((err) => {
    console.error("backfillLeadSource failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
