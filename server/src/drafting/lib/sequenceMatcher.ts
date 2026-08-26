/**
 * Direct port of the subset of CPython's difflib.SequenceMatcher needed for
 * .ratio() (Ratcliff/Obershelp longest-matching-block algorithm, including
 * the `autojunk` heuristic for sequences >= 200 elements) -- no npm package
 * used, see DEPLOYMENT plan notes for why. Ported from CPython's difflib.py
 * (find_longest_match / get_matching_blocks / ratio), operating on strings
 * as sequences of characters exactly as Python does. isjunk is never used
 * by editLogger.ts (matches difflib.SequenceMatcher(None, a, b) in Python),
 * so the isjunk-only "bjunk" set is always empty here -- autojunk-derived
 * "popular" elements are removed from the b2j index entirely (not added to
 * bjunk), matching CPython's own distinction between the two.
 */

type Match = [number, number, number]; // [aIndex, bIndex, size]

function buildB2j(b: string): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  for (let i = 0; i < b.length; i++) {
    const elt = b[i];
    const indices = b2j.get(elt);
    if (indices) indices.push(i);
    else b2j.set(elt, [i]);
  }

  const n = b.length;
  if (n >= 200) {
    const ntest = Math.floor(n / 100) + 1;
    for (const [elt, idxs] of b2j) {
      if (idxs.length > ntest) b2j.delete(elt);
    }
  }

  return b2j;
}

function findLongestMatch(
  a: string,
  b: string,
  b2j: Map<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number
): Match {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;

  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const js = b2j.get(a[i]);
    if (js) {
      for (const j of js) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    j2len = newj2len;
  }

  // isjunk is never passed by callers of sequenceMatcherRatio(), so there is
  // no junk-only extension pass here (CPython's bjunk-gated while-loops are
  // always no-ops in that case) -- only the non-junk extension applies.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }

  return [besti, bestj, bestsize];
}

function getMatchingBlocks(a: string, b: string, b2j: Map<string, number[]>): Match[] {
  const la = a.length;
  const lb = b.length;
  const queue: [number, number, number, number][] = [[0, la, 0, lb]];
  const matchingBlocks: Match[] = [];

  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const match = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    const [i, j, k] = match;
    if (k) {
      matchingBlocks.push(match);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }

  matchingBlocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  const nonAdjacent: Match[] = [];
  for (const [i2, j2, k2] of matchingBlocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) nonAdjacent.push([i1, j1, k1]);
      i1 = i2;
      j1 = j2;
      k1 = k2;
    }
  }
  if (k1) nonAdjacent.push([i1, j1, k1]);
  nonAdjacent.push([la, lb, 0]);

  return nonAdjacent;
}

/** Equivalent to Python's difflib.SequenceMatcher(None, a, b).ratio(). */
export function sequenceMatcherRatio(a: string, b: string): number {
  const b2j = buildB2j(b);
  const blocks = getMatchingBlocks(a, b, b2j);
  const matches = blocks.reduce((sum, blk) => sum + blk[2], 0);
  const length = a.length + b.length;
  return length ? (2.0 * matches) / length : 1.0;
}
