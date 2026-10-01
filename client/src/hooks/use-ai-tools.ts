import { useSyncExternalStore } from "react";

const KEY = "g3.ai_tools_enabled";
const EVENT = "g3-ai-tools-changed";

function read(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1";
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useAiToolsEnabled(): [boolean, (v: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const set = (v: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY, v ? "1" : "0");
    window.dispatchEvent(new Event(EVENT));
  };
  return [enabled, set];
}