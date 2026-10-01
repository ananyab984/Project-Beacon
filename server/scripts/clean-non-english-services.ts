/** One-off backfill: re-runs normalizeServices over every lead's already-
 *  stored `services` array, dropping any non-English duplicate that
 *  slipped through before normalizeServices.ts's language filter existed
 *  (BrightData's `skills` list has no language normalization at all, so a
 *  profile's own-language duplicate of an English skill -- "Teamwork" and
 *  "Trabalho em equipe" side by side -- was joined straight into Services).
 *
 *  Purely deterministic, no external calls.
 *
 *  Run: cd server && npx ts-node scripts/clean-non-english-services.ts
 */
import { prisma } from "../src/prisma";
import { normalizeServices } from "../src/lib/normalizeServices";

function arraysDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.some((v, i) => v !== sb[i]);
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null },
    select: { id: true, fullName: true, displayName: true, services: true },
  });
  console.log(`Checking ${leads.length} leads for non-English service entries.\n`);

  let updated = 0;
  for (const lead of leads) {
    const cleaned = normalizeServices(lead.services);
    if (!arraysDiffer(cleaned, lead.services)) continue;

    const name = lead.displayName || lead.fullName || lead.id;
    console.log(`${name} (${lead.id}): ${JSON.stringify(lead.services)} -> ${JSON.stringify(cleaned)}`);
    await prisma.lead.update({ where: { id: lead.id }, data: { services: cleaned } });
    updated++;
  }

  console.log(`\nDone. updated=${updated} total=${leads.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
