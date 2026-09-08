/** Validation run for recruiter-triggered Autumn re-enrichment.
 *
 * Two phases, in order:
 *
 *  1. SAFETY CHECK (always) -- creates its own throwaway lead pointing at a
 *     profile the PoC already enriched successfully, plants a manually-entered
 *     value on it, runs one real Autumn task, and asserts the run completed
 *     AND that the manual value survived. Deletes the lead afterwards, so no
 *     real lead's data is at stake while proving the flow works.
 *
 *  2. TEN REAL LEADS (only with --confirm) -- runs the same real flow against
 *     the 10 most-enriched leads that have a profile link, writing the results
 *     onto their actual rows. This is the recruiter-facing pass.
 *
 * Both phases spend real Autumn credits (one task per lead), so the script
 * refuses to start if the account has none, and phase 2 needs --confirm
 * because it mutates real lead rows.
 *
 * Writes scripts/__output__/autumn-reenrich.json for a follow-up report.
 *
 * Run via: cd server && npx ts-node scripts/test-autumn-reenrich.ts [--confirm]
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import { prisma } from "../src/prisma";
import { config } from "../src/config";
import { runAutumnReenrichment, parseCreditSnapshot } from "../src/jobs/reenrichment.job";
import { countPopulatedFields } from "../src/lib/enrichmentCount";

const RUN_REAL_LEADS = process.argv.includes("--confirm");
const REAL_LEAD_COUNT = Number(process.argv.find((a) => a.startsWith("--leads="))?.split("=")[1] ?? 10);

// A profile the PoC enriched successfully (POC/autumn_poc/output_edge_cases.json).
const SAFETY_PROFILE_URL = "https://www.bodalgo.com/en/voice-over-talents/lucy-newman-williams";
const MANUAL_HEADLINE = "MANUAL: recruiter typed this, it must survive";

const results: any[] = [];

async function readCredits() {
  const { data } = await axios.get(`${config.autumnBaseUrl}/credits`, {
    headers: { "X-API-Key": config.autumnApiKey },
    timeout: 30_000,
  });
  return parseCreditSnapshot(data);
}

/** Runs one lead through the real flow and returns what it did. */
async function reenrichOnce(leadId: string, label: string) {
  const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const run = await prisma.reenrichmentRun.create({ data: { leadId } });
  const startedAt = Date.now();
  await runAutumnReenrichment(run.id);
  const seconds = Math.round((Date.now() - startedAt) / 1000);

  const finished = await prisma.reenrichmentRun.findUniqueOrThrow({ where: { id: run.id } });
  const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const row = {
    label,
    leadId,
    profileLink: before.profileLink,
    seconds,
    status: finished.status,
    taskId: finished.taskId,
    fieldsWritten: finished.fieldsWritten,
    creditsUsed: finished.creditsUsed,
    message: finished.message,
    enrichedCountBefore: countPopulatedFields(before),
    enrichedCountAfter: countPopulatedFields(after),
    onHold: after.flags.includes("ON_HOLD") ? after.onHoldReason : null,
    // Before/after on every mapped field: the point of this pass is judging
    // whether Autumn IMPROVED each real lead, and a bare field count can't
    // show a good value being replaced by a worse (or wrong-person) one.
    changes: (["displayName", "headline", "currentTitle", "aboutSnippet", "country", "certifications"] as const)
      .map((f) => ({ field: f, before: (before as any)[f], after: (after as any)[f] }))
      .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after)),
    autumnRow: (after.autumnData as any)?.row ?? null,
  };
  console.log(
    `  ${label}: ${row.status} in ${seconds}s — ${row.fieldsWritten ?? 0} field(s), ` +
      `Enriched ${row.enrichedCountBefore} -> ${row.enrichedCountAfter}, credits ${row.creditsUsed ?? "?"}` +
      (row.message ? ` — ${row.message}` : "")
  );
  results.push(row);
  return { row, after };
}

async function safetyCheck() {
  console.log("\n=== PHASE 1: safety check on a throwaway lead ===");
  const lead = await prisma.lead.create({
    data: {
      source: "BODALGO",
      fullName: "ZZ Autumn Safety Check",
      displayName: "ZZ Autumn Safety Check",
      profileLink: SAFETY_PROFILE_URL,
      headline: MANUAL_HEADLINE,
      fieldSources: { Headline: "manual" },
      flags: [],
    },
  });

  try {
    const { row, after } = await reenrichOnce(lead.id, "safety-check");
    const failures: string[] = [];
    if (row.status !== "COMPLETED") failures.push(`run status was ${row.status}, expected COMPLETED`);
    if (after.headline !== MANUAL_HEADLINE) failures.push("the manually-entered headline was overwritten");
    if ((after.fieldSources as any)?.Headline !== "manual") failures.push('the "manual" tag was lost, so the NEXT run would clobber it');
    if (!after.autumnData) failures.push("raw Autumn output was not stored");
    if ((row.fieldsWritten ?? 0) === 0) failures.push("no fields were written at all");

    if (failures.length) {
      console.error("\nSAFETY CHECK FAILED:");
      failures.forEach((f) => console.error(`  - ${f}`));
      return false;
    }
    console.log("  PASS — completed, manual value preserved, raw output stored");
    return true;
  } finally {
    await prisma.lead.delete({ where: { id: lead.id } });
    console.log(`  cleaned up throwaway lead ${lead.id}`);
  }
}

async function realLeads() {
  console.log(`\n=== PHASE 2: ${REAL_LEAD_COUNT} real leads ===`);
  // Autumn researches a URL, so a lead without one can't be re-enriched.
  const candidates = await prisma.lead.findMany({
    where: { profileLink: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // Spread the picks across sources rather than taking the top N outright:
  // extraction quality varies by platform (a ProZ print-view page and a
  // LinkedIn profile are nothing alike), so N leads from one source would
  // tell us about that source and nothing else.
  const bySource = new Map<string, typeof candidates>();
  for (const lead of candidates.sort((a, b) => countPopulatedFields(b) - countPopulatedFields(a))) {
    const bucket = bySource.get(lead.source) ?? [];
    bucket.push(lead);
    bySource.set(lead.source, bucket);
  }
  const picked: { lead: (typeof candidates)[number] }[] = [];
  for (let round = 0; picked.length < REAL_LEAD_COUNT; round++) {
    const added = [...bySource.values()].filter((b) => b[round]).length;
    if (!added) break; // every source exhausted
    for (const bucket of bySource.values()) {
      if (bucket[round] && picked.length < REAL_LEAD_COUNT) picked.push({ lead: bucket[round] });
    }
  }

  console.log(
    `  selected ${picked.length} lead(s) across ${new Set(picked.map((p) => p.lead.source)).size} source(s): ` +
      `${picked.map((p) => p.lead.source).join(", ")}\n`
  );
  for (const [i, { lead }] of picked.entries()) {
    const name = lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? lead.id;
    await reenrichOnce(lead.id, `${i + 1}/${picked.length} ${name}`);
  }
}

async function main() {
  if (!config.autumnApiKey) {
    console.error("AUTUMN_API_KEY is not set in server/.env — nothing to test.");
    process.exit(1);
  }

  const credits = await readCredits();
  console.log(`Autumn credits: ${credits.remaining} remaining (${credits.used} used)`);
  if (!credits.remaining) {
    console.error("\nAccount has no credits remaining — every task would fail with 402.");
    console.error("Top up the Autumn account, then re-run this script.");
    process.exit(1);
  }

  // --skip-safety is for a follow-up run in the same session, where phase 1
  // already passed minutes ago and re-running it is just 28 wasted credits.
  if (process.argv.includes("--skip-safety")) {
    console.log("\nSkipping phase 1 (--skip-safety).");
  } else if (!(await safetyCheck())) {
    console.error("\nStopping before touching real leads — fix the safety check first.");
    process.exit(1);
  }

  if (RUN_REAL_LEADS) {
    await realLeads();
  } else {
    console.log(`\nSkipping phase 2. Re-run with --confirm to re-enrich ${REAL_LEAD_COUNT} real leads.`);
  }

  const outPath = path.join(__dirname, "__output__", "autumn-reenrich.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nWrote ${outPath}`);

  const after = await readCredits();
  console.log(`Credits spent this run: ${(after.used ?? 0) - (credits.used ?? 0)}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
