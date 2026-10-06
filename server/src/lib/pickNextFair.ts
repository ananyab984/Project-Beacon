/** The oldest eligible PENDING lead of one uploader (see claimNextPendingLead). */
export interface QueueHead {
  id: string;
  owner: string;
  createdAt: Date;
}

/**
 * Which lead to enrich next: the queue head of the uploader with the FEWEST
 * leads currently being enriched, oldest first on a tie. Oldest-first across
 * everyone made one 1,000-lead upload hold every slot for hours while a
 * second recruiter's 20 leads waited behind it; this shares the slots between
 * whoever has work queued, and a lone uploader still gets all of them.
 */
export function pickNextFair(heads: QueueHead[], inFlightByOwner: Map<string, number>): QueueHead | null {
  let best: QueueHead | null = null;
  for (const head of heads) {
    if (!best) {
      best = head;
      continue;
    }
    const mine = inFlightByOwner.get(head.owner) ?? 0;
    const theirs = inFlightByOwner.get(best.owner) ?? 0;
    if (mine < theirs || (mine === theirs && head.createdAt < best.createdAt)) best = head;
  }
  return best;
}
