/** A lead whose waterfall run never concluded -- stalled, or held for a system error / timeout -- is re-run through
 *  the same pipeline (Parallel layer) via POST /:id/retry-enrichment, never through Autumn re-enrichment. */
export function mustRetryThroughPipeline(lead: {
  enrichmentStatus: string;
  flags: string[];
  onHoldReason: string | null;
}): boolean {
  return (
    lead.enrichmentStatus === "STALLED" ||
    (lead.flags.includes("ON_HOLD") && (lead.onHoldReason === "SYSTEM_ERROR" || lead.onHoldReason === "TIMEOUT"))
  );
}
