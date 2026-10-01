// Shared evaluation-framework UI primitives used across owner + recruiter surfaces.
import { TrendingDown, TrendingUp } from "lucide-react";

export function KpiTile({
  label,
  value,
  unit = "pct",
  trend,
  tone,
  hint,
  context,
}: {
  label: string;
  value: number | string;
  unit?: "pct" | "days" | "score";
  trend?: number;         // signed delta vs prior period, same unit
  tone?: "positive" | "warning" | "critical" | "neutral";
  hint?: string;
  context?: string;
}) {
  const display =
    typeof value === "string" ? value :
    unit === "pct" ? `${value}%` :
    unit === "days" ? `${(value as number).toFixed(1)}d` :
    String(value);
  const trendColor = trend === undefined ? "" : trend >= 0 ? "text-[oklch(0.55_0.14_155)]" : "text-warning";
  const TrendIcon = trend === undefined ? null : trend >= 0 ? TrendingUp : TrendingDown;
  const valueTone =
    tone === "critical" ? "text-destructive" :
    tone === "warning" ? "text-warning" :
    tone === "positive" ? "text-accent" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className={`text-2xl font-semibold tabular-nums ${valueTone}`}>{display}</div>
        {TrendIcon && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            {Math.abs(trend as number).toFixed(unit === "days" ? 1 : 0)}{unit === "pct" ? "%" : unit === "days" ? "d" : ""}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      {context && <div className="mt-1 text-[11px] font-medium text-muted-foreground">{context}</div>}
    </div>
  );
}

export function ScoreRing({ score, size = 88, label = "Overall" }: { score: number; size?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, score));
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const tone =
    pct >= 80 ? "text-accent" :
    pct >= 60 ? "text-primary" :
    pct >= 40 ? "text-warning" : "text-destructive";
  return (
    <div className="flex items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="var(--muted)" fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className={tone}
            stroke="currentColor"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            fill="none"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-semibold tabular-nums ${tone}`}>{pct}</span>
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">/100</span>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-sm font-medium">
          {pct >= 80 ? "Strong" : pct >= 60 ? "On track" : pct >= 40 ? "Needs attention" : "At risk"}
        </div>
      </div>
    </div>
  );
}