/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once.
 *
 * Written for enrichment.job.ts's pollPendingEnrichment, which used to
 * process its batch one lead at a time (`for (const lead of pending) { await
 * enrichLeadById(lead.id); }`) -- at Parallel's measured ~150-170s per lead,
 * a 20-lead batch took ~50-60 minutes. `concurrency: 4` cuts that to ~15
 * minutes while staying within providers/parallel_client.py's own 8-worker
 * bulkhead (`_parallel_executor`) on the enrichment service side.
 *
 * A failure in one item does not stop the others -- each is caught and
 * reported individually, mirroring `enrichLeadById`'s own
 * `.catch((err) => console.error(...))` pattern at every other call site, so
 * one bad lead can't take a whole batch down.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
