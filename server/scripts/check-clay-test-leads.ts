/** One-shot check: for the 7 known test-lead profile links, print whether a
 * matching Lead row exists in the real DB and what its current enrichment
 * state is. Read-only -- no writes. Used to watch Clay's async results land
 * via /api/webhooks/clay/:token without needing a success log line. */
import { prisma } from "../src/prisma";

const PROFILE_LINKS = [
  "https://www.linkedin.com/in/divya-shyam-912612177/",
  "https://www.linkedin.com/in/mathumitha-senthil/",
  "https://www.linkedin.com/in/christina-fernandez-68682921/",
  "https://www.linkedin.com/in/alex-anthraper/",
  "https://www.linkedin.com/in/aviktheteddy/",
  "https://www.linkedin.com/in/shraddha-parmar-921929212/",
  "https://www.linkedin.com/in/vijender-kamboj-b3648075/",
];

async function main() {
  for (const link of PROFILE_LINKS) {
    const lead = await prisma.lead.findFirst({ where: { profileLink: link } });
    if (!lead) {
      console.log(`NO_LEAD\t${link}`);
      continue;
    }
    const sources = (lead.fieldSources as Record<string, string>) || {};
    const clayFields = Object.entries(sources).filter(([, v]) => v === "clay").map(([k]) => k);
    console.log(
      `LEAD\t${link}\tid=${lead.id}\tstatus=${lead.enrichmentStatus}\theadline=${lead.headline ? "SET" : "-"}\tclayFields=${clayFields.join(",") || "-"}`
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
