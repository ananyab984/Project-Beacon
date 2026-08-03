import { useSyncExternalStore } from "react";

export type DateRangeKey = "7d" | "30d" | "90d" | "1y";

export const RANGE_LABELS: Record<DateRangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last year",
};

// Multiplier applied to KPI base values so dashboards visibly react to the toggle.
export const RANGE_SCALE: Record<DateRangeKey, number> = {
  "7d": 0.25,
  "30d": 1,
  "90d": 3,
  "1y": 12,
};

const KEY = "g3:date-range";
const listeners = new Set<() => void>();

function read(): DateRangeKey {
  if (typeof window === "undefined") return "30d";
  const v = window.localStorage.getItem(KEY) as DateRangeKey | null;
  return v && v in RANGE_SCALE ? v : "30d";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setDateRange(v: DateRangeKey) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, v);
  listeners.forEach((l) => l());
}

export function useDateRange() {
  const value = useSyncExternalStore(subscribe, read, () => "30d" as DateRangeKey);
  return { range: value, scale: RANGE_SCALE[value], label: RANGE_LABELS[value] };
}

export function scaleValue(v: number, scale: number) {
  return Math.max(0, Math.round(v * scale));
}

export function DateRangeToggle({ className = "" }: { className?: string }) {
  const { range } = useDateRange();
  const opts: DateRangeKey[] = ["7d", "30d", "90d", "1y"];
  return (
    <div
      role="tablist"
      aria-label="Date range"
      className={`inline-flex items-center rounded-lg border border-border bg-card p-0.5 ${className}`}
    >
      {opts.map((k) => {
        const active = range === k;
        return (
          <button
            key={k}
            role="tab"
            aria-selected={active}
            onClick={() => setDateRange(k)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "7d" ? "7d" : k === "30d" ? "30d" : k === "90d" ? "90d" : "1y"}
          </button>
        );
      })}
    </div>
  );
}