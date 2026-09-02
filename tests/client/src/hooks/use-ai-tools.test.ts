import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiToolsEnabled } from "@/hooks/use-ai-tools";

describe("useAiToolsEnabled", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to false", () => {
    const { result } = renderHook(() => useAiToolsEnabled());
    expect(result.current[0]).toBe(false);
  });

  it("reads a persisted true value", () => {
    window.localStorage.setItem("g3.ai_tools_enabled", "1");
    const { result } = renderHook(() => useAiToolsEnabled());
    expect(result.current[0]).toBe(true);
  });

  it("setter persists and updates the hook value", () => {
    const { result } = renderHook(() => useAiToolsEnabled());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("g3.ai_tools_enabled")).toBe("1");

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("g3.ai_tools_enabled")).toBe("0");
  });

  it("syncs across hook instances via the custom event", () => {
    const a = renderHook(() => useAiToolsEnabled());
    const b = renderHook(() => useAiToolsEnabled());
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });
});
