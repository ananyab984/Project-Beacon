/**
 * One-time backfill for leads that already have Parallel's raw payload
 * stored (Lead.parallelData) but an empty services[] -- the exact gap fixed
 * going forward in enrichment_pipeline/orchestrator.py's
 * _merge_parallel_fields (PR: "let Parallel enrich Services too"). Parallel
 * previously mapped nothing into Services at all, so a lead whose Tier 1
 * scrape found no structured skills and no free-text match (the common
 * BrightData case) stayed permanently un-serviced even when Parallel's own
 * headline/current_title/about_snippet payload for that same lead plainly
 * named a service. This applies that same derivation retroactively, computed
 * directly from data already sitting in Postgres -- no re-enrichment, no new
 * Parallel/BrightData/Claude API calls.
 *
 * Same precedence as the live pipeline: a structured `skills` list verbatim
 * first, else a keyword scan of headline/current_title/about_snippet against
 * the canonical service-category aliases (mirrors
 * enrichment_pipeline/parsers/service_aliases.py exactly); only touches
 * leads where services is still empty and fieldSources.Services isn't
 * tagged "manual"; tags the field "parallel" on write, exactly like a fresh
 * enrichment run would; runs the result through the same normalizeServices
 * canonicalization enrichment.job.ts applies to a live Parallel result.
 *
 * Run: cd server && npx ts-node scripts/backfill-services-from-parallel.ts
 */
import { prisma } from "../src/prisma";
import { normalizeServices } from "../src/lib/normalizeServices";

/** Mirrors enrichment_pipeline/parsers/service_aliases.py exactly. */
const SERVICE_ALIASES: Record<string, string[]> = {
  "Audio Description": ["audio description"],
  "Subtitling": ["subtitling", "subtitler", "subtitles"],
  "Closed Captioning": ["closed captioning", "closed caption"],
  "Captioning": ["captioning"],
  "Dubbing": ["dubbing", "dubbing artist", "dubbing director"],
  "Voice-over": ["voice-over", "voice over", "voiceover"],
  "Interpretation": ["interpretation", "interpreter", "interpreting"],
  "Translation": ["translation", "translator"],
  "Localization": ["localization", "localisation"],
  "Transcription": ["transcription", "transcriber"],
  "Proofreading": ["proofreading", "proofreader"],
  "Transcreation": ["transcreation"],
  "Copywriting": ["copywriting", "copywriter"],
  "Linguistic QA": ["linguistic qa", "lqa"],
  "Post-Editing": ["post-editing", "post editing", "mtpe"],
};

/** Same absence-prose guard as orchestrator.py's _ABSENCE_PROSE_MARKERS, so a
 *  narrated "none listed" string never gets treated as a real skill. */
const ABSENCE_PROSE_MARKERS = [
  "no certification", "none listed", "not listed", "isn't listed", "is listed",
  "not available", "not specified", "not provided", "not disclosed",
  "not shared", "not shown", "no data", "none found", "not found",
  "no email", "no phone", "profile evidence", "no information",
];

function isAbsenceProse(text: string): boolean {
  const lowered = text.toLowerCase();
  return ABSENCE_PROSE_MARKERS.some((m) => lowered.includes(m));
}

function extractServicesFromText(textBlob: string): string[] {
  const lowered = textBlob.toLowerCase();
  const matched: string[] = [];
  for (const [canonical, aliases] of Object.entries(SERVICE_ALIASES)) {
    if (aliases.some((a) => lowered.includes(a))) matched.push(canonical);
  }
  return matched;
}

function servicesFromParallelData(parallelData: Record<string, unknown> | null): string | null {
  if (!parallelData) return null;

  const skills = parallelData.skills;
  if (Array.isArray(skills)) {
    const kept = skills.map((s) => String(s)).filter((s) => s && !isAbsenceProse(s));
    if (kept.length > 0) return kept.join(", ");
  }

  const textBlob = [parallelData.headline, parallelData.current_title, parallelData.about_snippet]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" | ");
  if (!textBlob) return null;

  const matched = extractServicesFromText(textBlob);
  return matched.length > 0 ? matched.join(", ") : null;
}

async function main() {
  const candidates = (
    await prisma.lead.findMany({
      where: { services: { equals: [] } },
      select: { id: true, fullName: true, displayName: true, parallelData: true, fieldSources: true },
    })
  ).filter((l) => l.parallelData !== null);

  let updated = 0;
  let skippedManual = 0;
  let skippedNoDerivableData = 0;

  for (const lead of candidates) {
    const fieldSources = (lead.fieldSources as Record<string, string> | null) ?? {};
    if (fieldSources["Services"] === "manual") {
      skippedManual++;
      continue;
    }

    const derived = servicesFromParallelData(lead.parallelData as Record<string, unknown> | null);
    if (derived === null) {
      skippedNoDerivableData++;
      continue;
    }

    const normalized = normalizeServices(derived);

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        services: normalized,
        fieldSources: { ...fieldSources, Services: "parallel" } as any,
      },
    });
    updated++;
    console.log(`Updated ${lead.displayName ?? lead.fullName} (${lead.id}): Services = ${normalized.join(", ")}`);
  }

  console.log(`\n${updated} lead(s) updated, ${skippedManual} skipped (manual Services), ${skippedNoDerivableData} skipped (no derivable data)`);
  await prisma.$disconnect();
}
main();
