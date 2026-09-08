import { prisma } from "../prisma";

/**
 * Attaches each lead's latest Autumn re-enrichment state to an API response,
 * the same way withEnrichedFieldCount attaches the enriched-field count.
 *
 * The leads table needs this to render a Re-enrich button that's already
 * disabled when a run is in flight -- including when the recruiter navigated
 * away mid-run and came back, which is exactly the case a purely client-side
 * "pending" flag gets wrong.
 */

export interface ReenrichmentSummary {
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT";
  lastRunAt: Date | null;
}

const IDLE: ReenrichmentSummary = { status: "IDLE", lastRunAt: null };

/** One query for the whole page, not one per lead. */
export async function attachReenrichmentStatus<T extends { id: string }>(
  leads: T[]
): Promise<(T & { reenrichment: ReenrichmentSummary })[]> {
  if (leads.length === 0) return [];

  // ponytail: `distinct` narrows to the newest run per lead, but the engine
  // still scans this page's runs to do it. Fine while a lead is capped at a
  // handful of runs a day; if history grows, swap for a raw DISTINCT ON.
  const latest = await prisma.reenrichmentRun.findMany({
    where: { leadId: { in: leads.map((l) => l.id) } },
    orderBy: { startedAt: "desc" },
    distinct: ["leadId"],
    select: { leadId: true, status: true, startedAt: true },
  });

  const byLead = new Map(latest.map((r) => [r.leadId, { status: r.status, lastRunAt: r.startedAt }]));
  return leads.map((lead) => ({ ...lead, reenrichment: byLead.get(lead.id) ?? IDLE }));
}
