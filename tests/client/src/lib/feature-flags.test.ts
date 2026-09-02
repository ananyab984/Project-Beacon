import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiFeature, FEATURES } from "@/lib/feature-flags";

describe("feature-flags", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("useAiFeature", () => {
    it("defaults to false when localStorage has no value", () => {
      const { result } = renderHook(() => useAiFeature());
      expect(result.current[0]).toBe(false);
    });

    it("reads an existing '1' value as true", () => {
      window.localStorage.setItem("g3.features.ai", "1");
      const { result } = renderHook(() => useAiFeature());
      expect(result.current[0]).toBe(true);
    });

    it("reads an existing '0' value as false", () => {
      window.localStorage.setItem("g3.features.ai", "0");
      const { result } = renderHook(() => useAiFeature());
      expect(result.current[0]).toBe(false);
    });

    it("setter persists to localStorage and updates the hook value", () => {
      const { result } = renderHook(() => useAiFeature());
      act(() => {
        result.current[1](true);
      });
      expect(window.localStorage.getItem("g3.features.ai")).toBe("1");
      expect(result.current[0]).toBe(true);
    });

    it("setter false writes '0'", () => {
      const { result } = renderHook(() => useAiFeature());
      act(() => {
        result.current[1](true);
      });
      act(() => {
        result.current[1](false);
      });
      expect(window.localStorage.getItem("g3.features.ai")).toBe("0");
      expect(result.current[0]).toBe(false);
    });

    it("propagates a change to another hook instance via the custom event", () => {
      const a = renderHook(() => useAiFeature());
      const b = renderHook(() => useAiFeature());
      act(() => {
        a.result.current[1](true);
      });
      expect(b.result.current[0]).toBe(true);
    });

    it("reacts to a native 'storage' event (cross-tab change)", () => {
      const { result } = renderHook(() => useAiFeature());
      window.localStorage.setItem("g3.features.ai", "1");
      act(() => {
        window.dispatchEvent(new Event("storage"));
      });
      expect(result.current[0]).toBe(true);
    });
  });

  describe("FEATURES.ai", () => {
    it("reflects current localStorage state non-reactively", () => {
      expect(FEATURES.ai).toBe(false);
      window.localStorage.setItem("g3.features.ai", "1");
      expect(FEATURES.ai).toBe(true);
    });
  });
});
