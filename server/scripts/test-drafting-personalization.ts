/** Draft-quality harness: runs real leads through the real drafting
 * orchestrator on BOTH channels and dumps subject/body/verdict/checks, so a
 * personalization change can be eyeballed side by side before it ships.
 *
 * Names on argv pick specific leads; with no args it takes the N most
 * enriched. Read-only with respect to the Lead table -- it drafts and reports,
 * it never writes enrichment or queues a message.
 *
 * Run via: cd server && npx ts-node scripts/test-drafting-personalization.ts [names...]
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/prisma";
import { countPopulatedFields } from "../src/lib/enrichmentCount";
import { buildDraftLeadPayload } from "../src/lib/draftLeadPayload";
import { getDraftingOrchestrator } from "../src/drafting/instance";
import { fromRecord } from "../src/drafting/leads";

const HOW_MANY = 5;

async function main() {
  const argNames = process.argv.slice(2);
  const all = await prisma.lead.findMany();
  const chosen = argNames.length
    ? all.filter((l) => argNames.some((n) => (l.fullName || "").toLowerCase().includes(n.toLowerCase())))
    : all
        .map((lead) => ({ lead, count: countPopulatedFields(lead) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, HOW_MANY)
        .map((x) => x.lead);

  console.log(`Drafting for ${chosen.length} lead(s) on both channels\n`);
  const results: any[] = [];

  for (const lead of chosen) {
    const payload = buildDraftLeadPayload(lead, lead.email);
    const parsed = fromRecord(payload);
    const available = parsed.specificFactCandidates();

    console.log("=".repeat(78));
    console.log(`${lead.fullName}  (greeting name resolved to: "${parsed.firstName}")`);
    console.log(`named details available on profile (${available.length}): ${available.slice(0, 10).join(" | ")}`);

    const perLead: any = { name: lead.fullName, greetingName: parsed.firstName, available, channels: {} };

    for (const channel of ["email", "linkedin"] as const) {
      try {
        const d = await getDraftingOrchestrator().processDraft(payload, channel, true);
        const spec = d.evaluation.checks.find((c) => c.name === "named_specificity");
        const failed = d.evaluation.checks.filter((c) => !c.passed);
        console.log(`\n--- ${channel.toUpperCase()} --- verdict=${d.verdict}  flags=${JSON.stringify(d.flags)}`);
        if (spec) console.log(`    named_specificity: ${spec.detail}`);
        for (const c of failed) console.log(`    FAILED [${c.severity}] ${c.name}: ${c.detail}`);
        if (d.subject) console.log(`\nSubject: ${d.subject}`);
        console.log(`\n${d.body}\n`);
        if (channel === "linkedin") console.log(`(${d.body.length} chars)`);
        perLead.channels[channel] = {
          subject: d.subject,
          body: d.body,
          verdict: d.verdict,
          flags: d.flags,
          chars: d.body.length,
          checks: d.evaluation.checks,
        };
      } catch (err: any) {
        console.error(`    ${channel} draft threw: ${err?.message || err}`);
        perLead.channels[channel] = { error: err?.message || String(err) };
      }
    }
    results.push(perLead);
  }

  const outDir = path.join(__dirname, "__output__");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "drafting-personalization.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
