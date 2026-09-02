import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "@/hooks/use-mobile";

function mockMatchMedia() {
  const listeners: Array<(e: any) => void> = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: any) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  }));
  return { fire: () => listeners.forEach((cb) => cb({})) };
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

describe("useIsMobile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports true below the mobile breakpoint", () => {
    mockMatchMedia();
    setWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("reports false at/above the mobile breakpoint", () => {
    mockMatchMedia();
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates when the media query change event fires", () => {
    const { fire } = mockMatchMedia();
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    setWidth(400);
    act(() => fire());
    expect(result.current).toBe(true);
  });
});
