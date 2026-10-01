/**
 * One-time backfill for leads whose Services got shredded from a JSON
 * object into garbage tokens ("rate", "10", "{id", "it-IT}") before
 * normalizeServices.ts learned to parse that shape (see
 * server/src/lib/normalizeServices.ts) and before
 * enrichment_pipeline/orchestrator.py's _infer_services_via_llm learned to
 * reclassify a garbled value, not just an empty one.
 *
 * Unlike backfill-years-of-experience.ts, this can't be pure computation --
 * classifying real services from a profile's Headline/Current_Title/
 * About_Snippet/Certifications text needs an actual Claude call, which only
 * the Python enrichment service can make (see llm_fallback/client.py). So
 * this calls the exact same production entry point a recruiter's own
 * "Retry enrichment" button already uses (enrichLeadById), just selected
 * against every lead whose current Services value looks garbled rather than
 * one at a time by hand. Requires the enrichment service (ENRICHMENT_SERVICE_URL)
 * to be running.
 *
 * Run: cd server && npx ts-node scripts/backfill-garbled-services.ts
 */
import { prisma } from "../src/prisma";
import { enrichLeadById } from "../src/jobs/enrichment.job";

// Mirrors enrichment_pipeline/orchestrator.py's _looks_garbled exactly --
// same rule, ported to TS so this script can select candidates directly
// from Postgres without shelling out to Python.
const GARBLED_TOKENS = new Set(["id", "rate", "min_rate", "task", "service", "source_language", "target_language"]);

function looksGarbled(services: string[]): boolean {
  return services.some((raw) => {
    const token = raw.trim();
    if (!token) return false;
    if (/^\d+$/.test(token)) return true;
    if (/[{}[\]]/.test(token)) return true;
    return GARBLED_TOKENS.has(token.toLowerCase());
  });
}

async function main() {
  const candidates = await prisma.lead.findMany({
    where: { services: { isEmpty: false } },
    select: { id: true, fullName: true, displayName: true, services: true, fieldSources: true, enrichmentStatus: true },
  });

  const garbled = candidates.filter((l) => looksGarbled(l.services));
  console.log(`${garbled.length} of ${candidates.length} lead(s) with any Services look garbled.\n`);

  let fixed = 0;
  let skippedManual = 0;
  let skippedInProgress = 0;
  let failed = 0;

  for (const lead of garbled) {
    const label = lead.displayName ?? lead.fullName;
    const fieldSources = (lead.fieldSources as Record<string, string> | null) ?? {};

    if (fieldSources["Services"] === "manual") {
      console.log(`Skipping ${label} (${lead.id}): Services is a manual entry, never auto-overwritten.`);
      skippedManual++;
      continue;
    }
    if (lead.enrichmentStatus === "IN_PROGRESS") {
      console.log(`Skipping ${label} (${lead.id}): enrichment already in progress.`);
      skippedInProgress++;
      continue;
    }

    console.log(`Re-enriching ${label} (${lead.id})`);
    console.log(`  before: ${JSON.stringify(lead.services)}`);
    try {
      await enrichLeadById(lead.id);
      const updated = await prisma.lead.findUnique({ where: { id: lead.id }, select: { services: true } });
      console.log(`  after:  ${JSON.stringify(updated?.services)}`);
      fixed++;
    } catch (err) {
      console.error(`  FAILED:`, err);
      failed++;
    }
  }

  console.log(
    `\n${fixed} lead(s) re-enriched, ${skippedManual} skipped (manual Services), ` +
      `${skippedInProgress} skipped (already in progress), ${failed} failed`
  );
  await prisma.$disconnect();
}

main();
