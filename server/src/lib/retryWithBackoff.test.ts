import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff, RetryExhaustedError, isRetryableByDefault } from "./retryWithBackoff";

describe("retryWithBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on the first attempt with no delay and no retries", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds on attempt 2 after exactly one 1s wait", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail once")).mockResolvedValueOnce("ok");
    const promise = retryWithBackoff(fn);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("succeeds on attempt 3 after 1s + 2s waits", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");
    const promise = retryWithBackoff(fn);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds on attempt 4 after 1s + 2s + 4s waits", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))
      .mockResolvedValueOnce("ok");
    const promise = retryWithBackoff(fn);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("asserts the exact 1s/2s/4s/8s interval sequence via onRetry", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const onRetry = vi.fn();
    const promise = retryWithBackoff(fn, { onRetry }).catch(() => {});
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    await promise;
    expect(onRetry).toHaveBeenCalledTimes(4);
    expect(onRetry.mock.calls.map((c) => c[2])).toEqual([1000, 2000, 4000, 8000]);
  });

  it("makes exactly 5 attempts (1 initial + 4 retries) before giving up", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const promise = retryWithBackoff(fn).catch((e) => e);
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    const err = await promise;
    expect(fn).toHaveBeenCalledTimes(5);
    expect(err).toBeInstanceOf(RetryExhaustedError);
  });

  it("surfaces the error (not swallowed) when all attempts fail", async () => {
    const originalErr = new Error("root cause");
    const fn = vi.fn().mockRejectedValue(originalErr);
    const promise = retryWithBackoff(fn).catch((e) => e);
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    const err = await promise;
    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect((err as RetryExhaustedError).cause).toBe(originalErr);
  });

  it("fires onExhausted exactly once, not once per retry", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const onExhausted = vi.fn();
    const promise = retryWithBackoff(fn, { onExhausted }).catch(() => {});
    for (const wait of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait);
    }
    await promise;
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("never fires onExhausted when a retry eventually succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail once")).mockResolvedValueOnce("ok");
    const onExhausted = vi.fn();
    const promise = retryWithBackoff(fn, { onExhausted });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("short-circuits immediately on a non-retryable error -- zero retries burned", async () => {
    const authError = { response: { status: 401 } };
    const fn = vi.fn().mockRejectedValue(authError);
    await expect(retryWithBackoff(fn)).rejects.toBe(authError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("short-circuits on a custom isRetryable classifier without waiting", async () => {
    const malformedError = new Error("malformed request");
    const fn = vi.fn().mockRejectedValue(malformedError);
    await expect(
      retryWithBackoff(fn, { isRetryable: () => false })
    ).rejects.toBe(malformedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does retry a 429 and a 500 by default", async () => {
    const rateLimited = { response: { status: 429 } };
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce("ok");
    const promise = retryWithBackoff(fn);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toBe("ok");

    const serverError = { response: { status: 500 } };
    const fn2 = vi.fn().mockRejectedValueOnce(serverError).mockResolvedValueOnce("ok");
    const promise2 = retryWithBackoff(fn2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise2).toBe("ok");
  });

  it("retries concurrent/parallel calls independently -- one's failure timing never affects another's", async () => {
    // Lead A fails once then succeeds; Lead B succeeds immediately. Both run
    // concurrently, simulating two leads enriching at once.
    const fnA = vi.fn().mockRejectedValueOnce(new Error("A fails once")).mockResolvedValueOnce("A-done");
    const fnB = vi.fn().mockResolvedValue("B-done");

    const promiseA = retryWithBackoff(fnA);
    const promiseB = retryWithBackoff(fnB);

    // B resolves immediately without needing any timer advance.
    expect(await promiseB).toBe("B-done");
    expect(fnB).toHaveBeenCalledTimes(1);

    // A still needs its 1s backoff before succeeding -- advancing time for
    // A's retry must not have been required for (and must not re-trigger) B.
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promiseA).toBe("A-done");
    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1); // still just once -- unaffected by A's retry
  });
});

describe("isRetryableByDefault", () => {
  it.each([
    [{ response: { status: 400 } }, false],
    [{ response: { status: 401 } }, false],
    [{ response: { status: 403 } }, false],
    [{ response: { status: 404 } }, false],
    [{ response: { status: 429 } }, true],
    [{ response: { status: 500 } }, true],
    [{ response: { status: 503 } }, true],
    [new Error("ECONNREFUSED"), true], // no response at all -- network error
    [{ status: 401 }, false], // Anthropic SDK-style error shape (no .response wrapper)
  ])("%o -> retryable=%s", (err, expected) => {
    expect(isRetryableByDefault(err)).toBe(expected);
  });
});
