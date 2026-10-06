/**
 * Re-runs `call` while it fails with HTTP 409 -- the enrichment service saying
 * it is still running this same lead from an earlier request whose response
 * never arrived (see enrichment_pipeline/main.py's LeadRunRegistry) -- waiting
 * the server's Retry-After between tries, until `deadlineAt` (epoch ms). Once
 * that earlier run finishes, the next try gets its stored result, so a
 * dropped connection costs a short wait instead of a second paid waterfall.
 * Anything other than a 409 is returned or thrown untouched.
 */
export async function waitWhileBusy<T>(
  call: () => Promise<T>,
  deadlineAt: number,
  deps: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
): Promise<T> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  for (;;) {
    try {
      return await call();
    } catch (err: any) {
      if (err?.response?.status !== 409 || now() >= deadlineAt) throw err;
      const retryAfterMs = (Number(err.response.headers?.["retry-after"]) || 15) * 1000;
      await sleep(Math.min(retryAfterMs, deadlineAt - now()));
    }
  }
}
