/** One-off cleanup for queue items holding the auto-written generic template.
 *
 * PATCH /api/leads/:id used to overwrite every queue item's subject and body
 * with a hardcoded template on any lead edit (see the comment where that
 * block used to live in lead.routes.ts). Those bodies are still in the
 * database, and because the compose pane only offers "Generate Draft" for an
 * EMPTY body, each one silently blocks the recruiter from drafting the lead
 * properly -- they see a mail nobody wrote and no way to replace it short of
 * selecting all and deleting.
 *
 * Clearing them restores the Generate Draft affordance. Deliberately narrow:
 *
 *   - never touches a SENT item (that's the record of what actually went out)
 *   - never touches an `aiGenerated` draft (that came from the real pipeline)
 *   - only clears a body containing the template's own signature sentence, so
 *     a recruiter's hand-typed draft is left exactly as they left it
 *
 * Run with --dry to preview.
 *
 * Run via: cd server && npx ts-node scripts/clear-template-email-drafts.ts [--dry]
 */

import { prisma } from "../src/prisma";

const DRY = process.argv.includes("--dry");

// Distinctive enough that no hand-written draft would contain it, and it
// appeared verbatim in every body that block produced.
const TEMPLATE_SIGNATURE = "actively looking to connect with talented freelance";

async function main() {
  const items = await prisma.emailQueueItem.findMany({
    where: { status: { not: "SENT" }, aiGenerated: false, sentAt: null },
    select: { id: true, candidateName: true, subject: true, body: true },
  });

  const stale = items.filter((i) => (i.body || "").includes(TEMPLATE_SIGNATURE));

  console.log(`${items.length} unsent non-AI queue item(s); ${stale.length} hold the auto-written template`);
  for (const i of stale) console.log(`  - ${i.candidateName}: ${JSON.stringify((i.body || "").slice(0, 60))}…`);

  if (DRY) {
    console.log("\n--dry: nothing written");
  } else if (stale.length) {
    const { count } = await prisma.emailQueueItem.updateMany({
      where: { id: { in: stale.map((i) => i.id) } },
      data: { subject: "", body: "" },
    });
    console.log(`\nCleared ${count} item(s) -- each now shows "Generate Draft" in the compose pane`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
