// Central feature flags. Everything AI-related stays in code but is hidden
// from the UI when its flag is off. Backed by localStorage so the Owner
// Settings toggle flips it live without a rebuild.
import { useSyncExternalStore } from "react";

const KEY = "g3.features.ai";
const EVENT = "g3-features-changed";
const DEFAULT_AI = false;

function readAi(): boolean {
  if (typeof window === "undefined") return DEFAULT_AI;
  const v = window.localStorage.getItem(KEY);
  return v === null ? DEFAULT_AI : v === "1";
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const h = () => cb();
  window.addEventListener(EVENT, h);
  window.addEventListener("storage", h);
  return () => {
    window.removeEventListener(EVENT, h);
    window.removeEventListener("storage", h);
  };
}

export function useAiFeature(): [boolean, (v: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readAi, () => DEFAULT_AI);
  const set = (v: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY, v ? "1" : "0");
    window.dispatchEvent(new Event(EVENT));
  };
  return [enabled, set];
}

// Back-compat proxy for non-hook call sites (read-only, non-reactive).
export const FEATURES = {
  get ai() {
    return readAi();
  },
};