/**
 * Cost guardrail for recruiter-triggered re-enrichment.
 *
 * Autumn is credit-metered and its per-task price isn't documented up front,
 * so nothing about a recruiter re-clicking "Re-enrich" on the same lead is
 * self-limiting -- there is no rate limiting anywhere else in this server to
 * fall back on. Pure function over the lead's own recent runs so both limits
 * are testable without a database.
 *
 * Deliberately per-lead only: an account-wide cap would need a different
 * (and much more disruptive) failure mode -- one busy recruiter locking out
 * everyone else -- and isn't warranted before there's real spend data.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Machine-readable reason, for the API error code. */
  reason?: "COOLDOWN" | "DAILY_CAP";
  /** Recruiter-facing explanation, already carrying the numbers. */
  message?: string;
  /** When the next attempt on this lead becomes possible. */
  retryAt?: Date;
}

export interface RateLimitOptions {
  cooldownMinutes: number;
  dailyCap: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * @param recentStarts `startedAt` of this lead's prior runs, any status --
 *   a run that failed or timed out still spent credits, so it still counts.
 */
export function checkReenrichmentRateLimit(
  recentStarts: Date[],
  now: Date,
  { cooldownMinutes, dailyCap }: RateLimitOptions
): RateLimitDecision {
  const cooldownMs = cooldownMinutes * MINUTE_MS;

  const lastStart = recentStarts.reduce<Date | null>(
    (latest, d) => (latest === null || d > latest ? d : latest),
    null
  );
  if (lastStart && now.getTime() - lastStart.getTime() < cooldownMs) {
    const retryAt = new Date(lastStart.getTime() + cooldownMs);
    const minutesLeft = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / MINUTE_MS));
    return {
      allowed: false,
      reason: "COOLDOWN",
      message: `This lead was re-enriched less than ${cooldownMinutes} minutes ago. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
      retryAt,
    };
  }

  const inLastDay = recentStarts
    .filter((d) => now.getTime() - d.getTime() < DAY_MS)
    .sort((a, b) => a.getTime() - b.getTime());
  if (inLastDay.length >= dailyCap) {
    // The cap frees up when the OLDEST run inside the window rolls out of it.
    const retryAt = new Date(inLastDay[inLastDay.length - dailyCap].getTime() + DAY_MS);
    return {
      allowed: false,
      reason: "DAILY_CAP",
      message: `This lead has already been re-enriched ${dailyCap} times in the last 24 hours.`,
      retryAt,
    };
  }

  return { allowed: true };
}
