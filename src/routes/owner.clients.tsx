import { createFileRoute } from "@tanstack/react-router";
import { languageDemand, leads } from "@/lib/g3-mock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LeadCard } from "@/components/g3/lead-card";
import { openClientDemand } from "@/components/g3/client-demand-dialog";

export const Route = createFileRoute("/owner/clients")({
  head: () => ({
    meta: [
      { title: "Clients & Market — Global3" },
      { name: "description", content: "Client demand vs. filled headcount, per language and service." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const [q, setQ] = useState("");
  const [client, setClient] = useState("all");
  const [drill, setDrill] = useState<string | null>(null);

  const clients = useMemo(() => Array.from(new Set(languageDemand.map(d => d.client))), []);

  const filtered = languageDemand.filter(d =>
    (q === "" || d.language.toLowerCase().includes(q.toLowerCase())) &&
    (client === "all" || d.client === client)
  );

  const active = filtered.find(d => `${d.language}-${d.client}` === drill);
  const coveringLeads = active ? leads.filter(l => l.language === active.language).slice(0, 6) : [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Filter by language…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button onClick={openClientDemand} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Add Client Demand
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Language · Services</th>
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-5 py-3 font-medium text-right">Needed</th>
              <th className="px-5 py-3 font-medium text-right">Filled</th>
              <th className="px-5 py-3 font-medium text-right">Gap</th>
              <th className="px-5 py-3 font-medium w-40">Fill rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groupByLanguage(filtered).map(({ language, rows }) => {
              const allServices = Array.from(new Set(rows.flatMap(r => r.services)));
              return (
                <>
                  <tr key={`${language}-header`} className="bg-muted/25">
                    <td colSpan={6} className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-foreground">{language}</span>
                        <span className="text-[10px] text-muted-foreground">· {rows.length} client{rows.length > 1 ? "s" : ""}</span>
                        <div className="ml-2 flex flex-wrap gap-1">
                          {allServices.map(s => (
                            <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                  {rows.map((d) => {
                    const key = `${d.language}-${d.client}`;
                    return (
                      <tr key={key} onClick={() => setDrill(key)} className="cursor-pointer transition-colors hover:bg-muted/40">
                        <td className="px-5 py-3.5 pl-8">
                          <div className="flex flex-wrap gap-1">
                            {d.services.map(s => (
                              <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">{s}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-foreground">{d.client}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums">{d.headcount_needed}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums">{d.filled}</td>
                        <td className={`px-5 py-3.5 text-right tabular-nums font-semibold ${d.gap > 3 ? "text-warning" : d.gap > 0 ? "text-foreground" : "text-[oklch(0.5_0.14_155)]"}`}>{d.gap}</td>
                        <td className="px-5 py-3.5">
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-accent" style={{ width: `${(d.filled / d.headcount_needed) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sheet open={!!active} onOpenChange={o => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-auto">
          {active && (
            <>
              <SheetHeader>
                <SheetTitle>{active.language} — {active.client}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <TotalTile label="Needed" value={active.headcount_needed} />
                <TotalTile label="Filled" value={active.filled} tone="ok" />
                <TotalTile label="Gap" value={active.gap} tone={active.gap > 3 ? "warn" : active.gap > 0 ? "muted" : "ok"} />
              </div>

              <h3 className="mt-6 text-sm font-semibold">Staffing by service</h3>
              <div className="mt-3 space-y-2">
                {active.service_breakdown.map(sb => {
                  const pct = sb.needed ? Math.min(100, (sb.filled / sb.needed) * 100) : 0;
                  return (
                    <div key={sb.service} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-foreground">{sb.service}</div>
                        <div className="flex items-center gap-4 text-xs tabular-nums">
                          <span className="text-muted-foreground">Needed <span className="font-semibold text-foreground">{sb.needed}</span></span>
                          <span className="text-muted-foreground">Filled <span className="font-semibold text-foreground">{sb.filled}</span></span>
                          <span className={`font-semibold ${sb.gap > 2 ? "text-warning" : sb.gap > 0 ? "text-foreground" : "text-[oklch(0.55_0.14_155)]"}`}>Gap {sb.gap}</span>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <h3 className="mt-6 text-sm font-semibold">Recommended Leads</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Top candidates matching this language who could help close the gap.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {coveringLeads.map(l => <LeadCard key={l.id} lead={l} compact />)}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TotalTile({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "text-[oklch(0.55_0.14_155)]" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function groupByLanguage(rows: typeof languageDemand) {
  const map = new Map<string, typeof languageDemand>();
  for (const r of rows) {
    const arr = map.get(r.language) ?? [];
    arr.push(r);
    map.set(r.language, arr);
  }
  return Array.from(map, ([language, rows]) => ({ language, rows }));
}

