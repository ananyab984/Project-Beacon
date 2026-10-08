/**
 * Runs `concurrency` workers that each repeatedly `claimNext()` an item and
 * `fn(item)` it, until `claimNext()` returns null.
 *
 * Written for enrichment.job.ts's pollPendingEnrichment. It used to claim a
 * fixed batch of 20 leads up front (marking every one IN_PROGRESS with a
 * fresh enrichmentStartedAt) and then map over them 8 at a time -- so 12 of
 * them sat "in progress" while really just waiting for a free slot, their UI
 * progress estimate already ticking toward its 96% cap, and the next batch
 * couldn't start until the slowest lead of the current one finished (one
 * ~68-minute thin lead held 7 idle slots hostage). Claiming one item per
 * free worker means an item is only ever marked in progress at the moment
 * work on it actually starts, and a slow item only ever occupies its own
 * slot.
 *
 * Items arriving while workers are draining (e.g. a bulk upload mid-run) are
 * picked up by the same workers, so total concurrency stays `concurrency`.
 *
 * A failure in `fn` rejects the whole drain (bare Promise.all) -- callers
 * that need "keep going regardless" must catch inside `fn`, as
 * enrichment.job.ts does.
 */
export async function drainWithConcurrency<T>(
  concurrency: number,
  claimNext: () => Promise<T | null>,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const worker = async () => {
    for (;;) {
      // A failed claim (e.g. a DB pool timeout) ends THIS worker only; the others keep draining and the
      // next tick restarts the pool, instead of one error rejecting the drain and letting a second pool stack up.
      let item: T | null;
      try {
        item = await claimNext();
      } catch (err) {
        console.error("[drainWithConcurrency] claimNext failed, stopping this worker:", err);
        return;
      }
      if (item === null) return;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
