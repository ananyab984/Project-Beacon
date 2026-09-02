/**
 * One shared exponential-backoff retry utility for every external/network
 * call in this server (Claude, Unipile, the enrichment pipeline's /enrich
 * call, and anything added later) -- so no call site reimplements its own
 * retry loop, and the retry contract (interval sequence, what counts as
 * retryable, how exhaustion is surfaced) stays identical everywhere it's used.
 *
 * Contract: up to 4 retries after the initial attempt, at 1s / 2s / 4s / 8s
 * (total worst-case wait before giving up on one call is ~15s). A
 * non-retryable error (default: HTTP 400/401/403) short-circuits immediately
 * without burning a retry. `onExhausted` fires exactly once, only when every
 * attempt has failed, so callers can surface a single user-facing
 * notification ("this is taking longer than expected") instead of failing
 * silently or one toast per retry.
 */

export class RetryExhaustedError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "RetryExhaustedError";
  }
}

/** Default retry classifier for axios/Anthropic-SDK-shaped errors: retries
 * network errors (no response at all) and 5xx/429, but not 400/401/403 or
 * any other 4xx -- those mean the request itself is wrong and won't
 * succeed just by trying again. */
export function isRetryableByDefault(err: unknown): boolean {
  const status = (err as any)?.response?.status ?? (err as any)?.status;
  if (status === undefined || status === null) return true; // no response -- network/timeout error
  if (status === 429) return true; // rate limit -- worth retrying
  if (status >= 500) return true;
  return false; // 400/401/403/other 4xx -- non-retryable
}

export interface RetryOptions {
  /** Retries after the initial attempt. Default 4 (5 attempts total). */
  retries?: number;
  /** Delay before the first retry, doubling each subsequent retry. Default 1000ms. */
  baseDelayMs?: number;
  /** Returns false to short-circuit immediately without burning a retry. */
  isRetryable?: (err: unknown) => boolean;
  /** Fires exactly once, only when every attempt has been exhausted. */
  onExhausted?: (err: unknown) => void;
  /** Optional observability hook, fired before each backoff wait. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests -- defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const isRetryable = opts.isRetryable ?? isRetryableByDefault;
  const sleep = opts.sleep ?? realSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) {
        throw err; // non-retryable -- surface immediately, no backoff burned
      }
      if (attempt >= retries) {
        break; // every attempt exhausted
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  opts.onExhausted?.(lastErr);
  throw new RetryExhaustedError(
    `All ${retries + 1} attempts failed: ${(lastErr as any)?.message ?? lastErr}`,
    lastErr
  );
}
