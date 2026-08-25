import { prisma } from "../src/prisma";
import { enrichLeadById } from "../src/jobs/enrichment.job";

async function main() {
  const leads = await prisma.lead.findMany({
    where: { profileLink: { not: null } },
    select: { id: true, fullName: true, displayName: true },
  });
  console.log(`Found ${leads.length} leads with a profile link to re-enrich.\n`);

  for (const lead of leads) {
    const name = lead.displayName || lead.fullName || lead.id;
    process.stdout.write(`Re-enriching ${name} (${lead.id})... `);
    try {
      await enrichLeadById(lead.id);
      const after = await prisma.lead.findUnique({
        where: { id: lead.id },
        select: {
          services: true,
          headline: true,
          toolsSoftware: true,
          certifications: true,
          currentTitle: true,
          enrichmentStatus: true,
        },
      });
      console.log(
        `done. status=${after?.enrichmentStatus} services=${JSON.stringify(after?.services)} ` +
          `headline=${JSON.stringify(after?.headline)} tools=${JSON.stringify(after?.toolsSoftware)} ` +
          `certifications=${JSON.stringify(after?.certifications)} currentTitle=${JSON.stringify(after?.currentTitle)}`
      );
    } catch (err: any) {
      console.log(`ERROR: ${err?.message || err}`);
    }
    // small delay to be gentle on BrightData rate limits
    await new Promise((r) => setTimeout(r, 1500));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
