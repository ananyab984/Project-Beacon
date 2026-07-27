import { createFileRoute } from "@tanstack/react-router";
import { useClientDemands } from "@/lib/g3-mock";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export const Route = createFileRoute("/contractor/requirements")({
  head: () => ({
    meta: [
      { title: "Requirements — Global3 Contractor" },
      { name: "description", content: "Current language hiring requirements showing required, filled, and remaining headcount." },
    ],
  }),
  component: RequirementsPage,
});

function RequirementsPage() {
  const clientDemands = useClientDemands();
  const [q, setQ] = useState("");

  // Aggregate by language (sum across clients — contractors don't need per-client breakdown)
  const byLanguage = useMemo(() => {
    const map = new Map<string, { needed: number; filled: number; gap: number }>();
    for (const d of clientDemands.filter(d => d.status !== "paused")) {
      const cur = map.get(d.language) ?? { needed: 0, filled: 0, gap: 0 };
      map.set(d.language, {
        needed: cur.needed + d.headcount_needed,
        filled: cur.filled + d.filled,
        gap: cur.gap + d.gap,
      });
    }
    return Array.from(map, ([language, v]) => ({ language, ...v })).sort((a, b) => b.gap - a.gap);
  }, [clientDemands]);

  const filtered = byLanguage.filter(r =>
    q === "" || r.language.toLowerCase().includes(q.toLowerCase())
  );

  const totalNeeded = filtered.reduce((s, r) => s + r.needed, 0);
  const totalFilled = filtered.reduce((s, r) => s + r.filled, 0);
  const totalGap = filtered.reduce((s, r) => s + r.gap, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header description */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/[0.04] via-accent/[0.04] to-transparent px-6 py-5">
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Current hiring requirements</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Language headcount requirements</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Active hiring targets across all languages. Focus your outreach on languages with the highest remaining headcount.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Total Required" value={totalNeeded} />
        <SummaryTile label="Total Filled" value={totalFilled} tone="ok" />
        <SummaryTile label="Total Remaining" value={totalGap} tone={totalGap > 0 ? "warn" : "ok"} />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Filter by language…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
      </div>

      {/* Requirements table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Language</th>
              <th className="px-5 py-3 font-medium text-right">Required</th>
              <th className="px-5 py-3 font-medium text-right">Filled</th>
              <th className="px-5 py-3 font-medium text-right">Remaining</th>
              <th className="px-5 py-3 font-medium w-40">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(r => {
              const pct = r.needed ? Math.min(100, (r.filled / r.needed) * 100) : 100;
              const complete = r.gap === 0;
              return (
                <tr key={r.language} className="transition-colors hover:bg-muted/30">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{r.language}</span>
                      {complete && (
                        <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">Complete ✓</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums font-medium">{r.needed}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{r.filled}</td>
                  <td className={`px-5 py-4 text-right tabular-nums font-semibold ${r.gap > 5 ? "text-warning" : r.gap > 0 ? "text-foreground" : "text-[oklch(0.5_0.14_155)]"}`}>
                    {r.gap > 0 ? r.gap : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${complete ? "bg-[oklch(0.62_0.14_155)]" : "bg-accent"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">{Math.round(pct)}%</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No requirements match your filter.
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-[oklch(0.55_0.14_155)]" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
