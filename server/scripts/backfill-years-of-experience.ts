/**
 * One-time backfill for leads that already have Parallel's raw experience
 * history stored (Lead.parallelData) but never got a Years_of_Exp value --
 * the exact gap fixed going forward in enrichment_pipeline/orchestrator.py's
 * _years_of_experience_from_parallel_entries (PR: "derive years of
 * experience from Parallel's dated roles"). This applies that same
 * derivation retroactively, computed directly from data already sitting in
 * Postgres -- no re-enrichment, no new Parallel/BrightData/Claude API calls.
 *
 * Same rules as the live pipeline: career span (earliest start year to
 * latest end year, a current role counting as this year), never a
 * count-based estimate; only touches leads where yearsOfExperience is still
 * null and fieldSources.Years_of_Exp isn't tagged "manual"; tags the field
 * "parallel" on write, exactly like a fresh enrichment run would.
 *
 * Run: cd server && npx ts-node scripts/backfill-years-of-experience.ts
 */
import { prisma } from "../src/prisma";

const CURRENT_ROLE_MARKERS = ["present", "current", "now", "today", "actual", "heute", "presente", "atual", "aujourd'hui", "laufend"];

function extractYear(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const match = text.match(/(?:19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

function isCurrentMarker(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const lowered = text.trim().toLowerCase();
  return CURRENT_ROLE_MARKERS.some((m) => lowered.includes(m));
}

/** Mirrors enrichment_pipeline/orchestrator.py's
 *  _years_of_experience_from_parallel_entries exactly -- same rule, ported
 *  to TS purely so this one-off backfill can run directly against Postgres
 *  without shelling out to Python. */
function yearsOfExperienceFromEntries(experience: unknown): number | null {
  if (!Array.isArray(experience) || experience.length === 0) return null;

  const startYears: number[] = [];
  const endYears: number[] = [];
  const currentYear = new Date().getFullYear();

  for (const entry of experience) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const startYear = extractYear(e.start_date);
    if (startYear) startYears.push(startYear);

    if (e.is_current || isCurrentMarker(e.end_date)) {
      endYears.push(currentYear);
    } else {
      const endYear = extractYear(e.end_date);
      if (endYear) endYears.push(endYear);
    }
  }

  if (startYears.length === 0) return null;
  const earliestStart = Math.min(...startYears);
  const latestEnd = endYears.length > 0 ? Math.max(...endYears) : Math.max(...startYears);
  const span = latestEnd - earliestStart;
  return span >= 0 ? span : null;
}

async function main() {
  const candidates = (
    await prisma.lead.findMany({
      where: { yearsOfExperience: null },
      select: { id: true, fullName: true, displayName: true, parallelData: true, fieldSources: true },
    })
  ).filter((l) => l.parallelData !== null);

  let updated = 0;
  let skippedManual = 0;
  let skippedNoDerivableData = 0;

  for (const lead of candidates) {
    const fieldSources = (lead.fieldSources as Record<string, string> | null) ?? {};
    if (fieldSources["Years_of_Exp"] === "manual") {
      skippedManual++;
      continue;
    }

    const parallelData = lead.parallelData as Record<string, unknown> | null;
    const derived = yearsOfExperienceFromEntries(parallelData?.experience);
    if (derived === null) {
      skippedNoDerivableData++;
      continue;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        yearsOfExperience: derived,
        fieldSources: { ...fieldSources, Years_of_Exp: "parallel" } as any,
      },
    });
    updated++;
    console.log(`Updated ${lead.displayName ?? lead.fullName} (${lead.id}): Years_of_Exp = ${derived}`);
  }

  console.log(`\n${updated} lead(s) updated, ${skippedManual} skipped (manual Years_of_Exp), ${skippedNoDerivableData} skipped (no derivable dates)`);
  await prisma.$disconnect();
}
main();
