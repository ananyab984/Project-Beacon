import { useSyncExternalStore, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";

export type DateRangeKey = "7d" | "30d" | "90d" | "1y";

export const RANGE_LABELS: Record<DateRangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last year",
};

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
  return () => {
    listeners.delete(cb);
  };
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
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-accent text-accent-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

// ─── Single Unified Control Box for Range or Specific Date Selection ───

export function DateRangeSelect({ className = "" }: { className?: string }) {
  const { range } = useDateRange();
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const displayLabel = selectedDate
    ? `Date: ${selectedDate.split("-").reverse().join("/")}`
    : RANGE_LABELS[range];

  const handleSelectPreset = (key: DateRangeKey) => {
    setSelectedDate(null);
    setDateRange(key);
    setOpen(false);
  };

  const handleCustomDateChange = (val: string) => {
    if (!val) return;
    setSelectedDate(val);
    // Cycle range scale to trigger dynamic update
    setDateRange(range === "30d" ? "90d" : "30d");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex h-9 min-w-[210px] items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-3 text-xs font-semibold text-foreground hover:border-accent/50 hover:bg-muted/30 transition-colors ${className}`}
        >
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-accent shrink-0" />
            <span>{displayLabel}</span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-60 p-2 space-y-2 shadow-xl border-border bg-card">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-1">
          Preset Time Horizon
        </div>

        <div className="space-y-0.5">
          {(["7d", "30d", "90d", "1y"] as DateRangeKey[]).map((k) => {
            const isSel = !selectedDate && range === k;
            return (
              <button
                key={k}
                onClick={() => handleSelectPreset(k)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isSel
                    ? "bg-accent/15 text-accent font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <span>{RANGE_LABELS[k]}</span>
                {isSel && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            );
          })}
        </div>

        <div className="border-t border-border/60 pt-2 space-y-1.5 px-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Or Select Particular Date
          </div>
          <Input
            type="date"
            value={selectedDate ?? ""}
            onChange={(e) => handleCustomDateChange(e.target.value)}
            className="h-8 text-xs bg-background font-medium border-border/80"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}