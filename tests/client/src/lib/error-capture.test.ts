import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

describe("error-capture", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined when nothing captured", async () => {
    const { consumeLastCapturedError } = await import("@/lib/error-capture");
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("captures a window error event and returns it once", async () => {
    const { consumeLastCapturedError } = await import("@/lib/error-capture");
    const err = new Error("boom");
    window.dispatchEvent(new ErrorEvent("error", { error: err }));
    expect(consumeLastCapturedError()).toBe(err);
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("captures an unhandledrejection reason", async () => {
    const { consumeLastCapturedError } = await import("@/lib/error-capture");
    const reason = new Error("rejected");
    const event = new Event("unhandledrejection") as any;
    event.reason = reason;
    window.dispatchEvent(event);
    expect(consumeLastCapturedError()).toBe(reason);
  });

  it("expires captured errors after the TTL", async () => {
    vi.useFakeTimers();
    const { consumeLastCapturedError } = await import("@/lib/error-capture");
    const err = new Error("stale");
    window.dispatchEvent(new ErrorEvent("error", { error: err }));
    vi.advanceTimersByTime(6_000);
    expect(consumeLastCapturedError()).toBeUndefined();
  });
});
