import { prisma } from "../src/prisma";

/**
 * One-off repair for leads whose stored `parallelData` holds the empty-row
 * shape (`"experience": [{}, {}, {}]`) produced by the output schema that
 * declared those entries as free-form objects with no properties.
 *
 * Those leads are stuck twice over: the rows carry no data, AND their
 * `fieldSources._parallel_fallback` reads "complete", which
 * orchestrator.py's `_parallel_state_is_settled` treats as final -- so a
 * re-run skips Stage 3.5 entirely and they would keep their blank rows
 * forever, even now that the schema is fixed. Clearing the marker is what
 * lets Parallel be called again for them.
 *
 * Dry run by default: each re-enrichment is a real, paid Parallel Task Run
 * (~150-170s), and the poller works through PENDING leads one at a time, so
 * queueing a large batch is a deliberate act with a real cost and a long
 * tail. Pass --apply to actually write.
 *
 *   npx ts-node scripts/reset-empty-parallel-rows.ts           # report only
 *   npx ts-node scripts/reset-empty-parallel-rows.ts --apply   # queue them
 */

/** Mirrors orchestrator.py's `_has_content`: does this value carry actual
 *  data, or is it a well-formed shell? A list of empty entries is non-empty
 *  and says nothing, which is the entire bug. */
function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !k.startsWith("_"))
      .some(([, v]) => hasContent(v));
  }
  return true;
}

const NESTED_FIELDS = ["experience", "education", "languages"] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "asc" } });

  const stale = leads.filter((lead) => {
    const parallel = lead.parallelData as Record<string, unknown> | null;
    if (!parallel) return false;
    // Only leads that actually have rows to lose. A lead whose profile
    // genuinely lists no experience/education/languages has nothing to
    // recover and must not be re-billed for a second identical answer.
    const rows = NESTED_FIELDS.flatMap((f) => (Array.isArray(parallel[f]) ? (parallel[f] as unknown[]) : []));
    return rows.length > 0 && !rows.some(hasContent);
  });

  console.log(`${leads.length} leads scanned, ${stale.length} carrying rows with no data inside.\n`);

  for (const lead of stale) {
    const parallel = lead.parallelData as Record<string, unknown>;
    const counts = NESTED_FIELDS.map((f) => `${f}=${Array.isArray(parallel[f]) ? (parallel[f] as unknown[]).length : 0}`).join(" ");
    const sources = (lead.fieldSources as Record<string, string> | null) ?? {};
    // A recruiter's own hold is theirs to lift -- never queue past it.
    const manuallyHeld = lead.onHoldReason === "MANUAL";
    const name = lead.displayName || lead.fullName || lead.id;
    console.log(`  ${apply ? "queueing" : "would queue"} ${name} (${counts}, marker=${sources._parallel_fallback ?? "none"})${manuallyHeld ? " -- SKIPPED, manually on hold" : ""}`);
    if (!apply || manuallyHeld) continue;

    const { _parallel_fallback, ...rest } = sources;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        fieldSources: rest as any,
        enrichmentStatus: "PENDING",
        // pollPendingEnrichment excludes any ON_HOLD lead, so a system-placed
        // hold has to come off or the lead would sit PENDING and never run.
        flags: lead.flags.filter((f) => f !== "ON_HOLD"),
        onHoldReason: null,
      },
    });
  }

  console.log(
    apply
      ? `\nDone. Queued leads re-run on the next enrichment poll (every 3 min, one lead at a time).`
      : `\nDry run -- nothing written. Re-run with --apply to queue these.`
  );
  await prisma.$disconnect();
}

main();
