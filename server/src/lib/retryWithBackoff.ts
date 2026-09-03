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
 *
 * Optional `deadlineMs` adds a hard wall-clock cap across the whole
 * attempt+backoff sequence (see RetryOptions.deadlineMs) -- callers that pass
 * it MUST thread the AbortSignal `fn` receives into their HTTP client for the
 * deadline to actually stop the in-flight request, not just stop this
 * function from waiting on it.
 */

export class RetryExhaustedError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "RetryExhaustedError";
  }
}

/** Thrown when `deadlineMs` elapses before the attempt loop (all attempts +
 *  backoff sleeps) settles -- may fire with attempts still remaining. Note
 *  this only stops retryWithBackoff from waiting further; it does not by
 *  itself guarantee the in-flight request stopped running server-side --
 *  callers must thread the AbortSignal passed to `fn` into their HTTP client
 *  (e.g. axios's `signal` option) for the abort to actually propagate. */
export class DeadlineExceededError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DeadlineExceededError";
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
  /** Hard wall-clock cap across the *whole* attempt+backoff sequence, not a
   *  per-attempt timeout. When set, an AbortController is created and its
   *  signal passed as `fn`'s argument -- callers MUST thread that signal into
   *  their HTTP client (axios's `signal` option, an SDK's `signal` request
   *  option, etc.) or the deadline only stops this function from waiting, not
   *  the underlying request from running. On expiry, rejects with
   *  DeadlineExceededError even if attempts remain -- does not wait for the
   *  in-flight attempt to finish. */
  deadlineMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const isRetryable = opts.isRetryable ?? isRetryableByDefault;
  const sleep = opts.sleep ?? realSleep;
  const controller = opts.deadlineMs !== undefined ? new AbortController() : undefined;

  const attemptLoop = async (): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(controller?.signal);
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
  };

  if (opts.deadlineMs === undefined) {
    return attemptLoop();
  }

  const loopPromise = attemptLoop();
  // The loop isn't actually cancelled when the deadline wins the race below --
  // it may keep running (bounded by whatever the caller's HTTP client does
  // with the aborted signal) and reject later. Swallow that so it doesn't
  // surface as an unhandled rejection once we've stopped waiting on it.
  loopPromise.catch(() => {});

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller!.abort();
      reject(new DeadlineExceededError(`Deadline of ${opts.deadlineMs}ms exceeded`));
    }, opts.deadlineMs);
  });

  try {
    return await Promise.race([loopPromise, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
