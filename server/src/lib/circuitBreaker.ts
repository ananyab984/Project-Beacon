/** Minimal per-instance circuit breaker: after `failureThreshold` consecutive
 * failures, short-circuits further calls for `cooldownMs` instead of hitting
 * the upstream at all, then allows one probe call through (half-open) --
 * closing again on success, re-opening on failure. Intended for one
 * long-lived instance per third-party dependency (Claude, Groq, ...), not a
 * new instance per call. Transparent under normal conditions: a healthy
 * upstream never trips it. */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: BreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt < this.options.cooldownMs) {
        throw new Error("circuit breaker is open -- upstream has failed repeatedly, refusing to call it again yet");
      }
      this.state = "HALF_OPEN";
    }

    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      this.state = "CLOSED";
      return result;
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.options.failureThreshold) {
        this.state = "OPEN";
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}
