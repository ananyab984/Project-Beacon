import { createFileRoute } from "@tanstack/react-router";
import { useClientDemands, leads, type ClientDemand } from "@/lib/g3-mock";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LeadCard } from "@/components/g3/lead-card";

export const Route = createFileRoute("/recruiter/clients")({
  head: () => ({
    meta: [
      { title: "Clients & Market — Global3 Recruiter" },
      { name: "description", content: "Client demand vs. filled headcount per language and service." },
    ],
  }),
  component: RecruiterClientsPage,
});

function RecruiterClientsPage() {
  const clientDemands = useClientDemands();
  const [q, setQ] = useState("");
  const [client, setClient] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drill, setDrill] = useState<string | null>(null);

  const clients = useMemo(() => Array.from(new Set(clientDemands.map(d => d.client))), [clientDemands]);

  const filtered = clientDemands.filter(d =>
    (q === "" || d.language.toLowerCase().includes(q.toLowerCase()) || d.client.toLowerCase().includes(q.toLowerCase()) || (d.project_name ?? "").toLowerCase().includes(q.toLowerCase())) &&
    (client === "all" || d.client === client) &&
    (statusFilter === "all" || d.status === statusFilter)
  );

  const active = filtered.find(d => d.id === drill);
  const coveringLeads = active ? leads.filter(l => l.language === active.language).slice(0, 6) : [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Filter by language, client, project…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Language demand progress bar summary */}
      <LanguageSummaryBar demands={filtered} />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Language · Services</th>
              <th className="px-5 py-3 font-medium">Client · Project</th>
              <th className="px-5 py-3 font-medium">Priority</th>
              <th className="px-5 py-3 font-medium">Deadline</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right">Required</th>
              <th className="px-5 py-3 font-medium text-right">Filled</th>
              <th className="px-5 py-3 font-medium text-right">Remaining</th>
              <th className="px-5 py-3 font-medium w-32">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groupByLanguage(filtered).map(({ language, rows }) => {
              const allServices = Array.from(new Set(rows.flatMap(r => r.services)));
              const totalNeeded = rows.reduce((s, r) => s + r.headcount_needed, 0);
              const totalFilled = rows.reduce((s, r) => s + r.filled, 0);
              const met = totalFilled >= totalNeeded;
              return (
                <>
                  <tr key={`${language}-header`} className="bg-muted/25">
                    <td colSpan={9} className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-foreground">{language}</span>
                        <span className="text-[10px] text-muted-foreground">· {rows.length} client{rows.length > 1 ? "s" : ""}</span>
                        {met
                          ? <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">✓ Hiring complete</span>
                          : <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">Still hiring · {totalNeeded - totalFilled} remaining</span>
                        }
                        <div className="ml-2 flex flex-wrap gap-1">
                          {allServices.map(s => (
                            <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                  {rows.map((d) => (
                    <tr key={d.id} onClick={() => setDrill(d.id)} className="cursor-pointer transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3.5 pl-8">
                        <div className="flex flex-wrap gap-1">
                          {d.services.map(s => (
                            <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">{s}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-foreground">{d.client}</div>
                        {d.project_name && <div className="text-[11px] text-muted-foreground">{d.project_name}</div>}
                      </td>
                      <td className="px-5 py-3.5"><PriorityPill priority={d.priority} /></td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground tabular-nums">
                        {d.deadline ? new Date(d.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={d.status} /></td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{d.headcount_needed}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{d.filled}</td>
                      <td className={`px-5 py-3.5 text-right tabular-nums font-semibold ${d.gap > 3 ? "text-warning" : d.gap > 0 ? "text-foreground" : "text-[oklch(0.5_0.14_155)]"}`}>{d.gap}</td>
                      <td className="px-5 py-3.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-accent" style={{ width: `${(d.filled / d.headcount_needed) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
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
                <TotalTile label="Required" value={active.headcount_needed} />
                <TotalTile label="Filled" value={active.filled} tone="ok" />
                <TotalTile label="Remaining" value={active.gap} tone={active.gap > 3 ? "warn" : active.gap > 0 ? "muted" : "ok"} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
                {active.project_name && <><dt className="text-muted-foreground">Project</dt><dd className="font-medium text-foreground">{active.project_name}</dd></>}
                <dt className="text-muted-foreground">Priority</dt>
                <dd><PriorityPill priority={active.priority} /></dd>
                {active.deadline && <><dt className="text-muted-foreground">Deadline</dt><dd className="font-medium tabular-nums">{new Date(active.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</dd></>}
                <dt className="text-muted-foreground">Status</dt>
                <dd><StatusBadge status={active.status} /></dd>
              </dl>

              {/* Language-wise demand detail */}
              <h3 className="mt-6 text-sm font-semibold">Requirements by service</h3>
              <div className="mt-3 space-y-2">
                {active.service_breakdown.map(sb => {
                  const pct = sb.needed ? Math.min(100, (sb.filled / sb.needed) * 100) : 0;
                  const met = sb.gap === 0;
                  return (
                    <div key={sb.service} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-foreground">{sb.service}</div>
                          {met && <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">✓ Requirement met</span>}
                        </div>
                        <div className="flex items-center gap-4 text-xs tabular-nums">
                          <span className="text-muted-foreground">Required <span className="font-semibold text-foreground">{sb.needed}</span></span>
                          <span className="text-muted-foreground">Filled <span className="font-semibold text-foreground">{sb.filled}</span></span>
                          <span className={`font-semibold ${sb.gap > 2 ? "text-warning" : sb.gap > 0 ? "text-foreground" : "text-[oklch(0.55_0.14_155)]"}`}>Remaining {sb.gap}</span>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Met / still hiring summary */}
              <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Hiring summary</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-accent/10 border border-accent/20 p-2">
                    <div className="text-[10px] text-accent font-medium">Requirements met</div>
                    <div className="mt-1 text-sm font-semibold">
                      {active.service_breakdown.filter(s => s.gap === 0).map(s => s.service).join(", ") || "None yet"}
                    </div>
                  </div>
                  <div className={`rounded-lg p-2 ${active.gap > 0 ? "bg-warning/10 border border-warning/20" : "bg-accent/10 border border-accent/20"}`}>
                    <div className={`text-[10px] font-medium ${active.gap > 0 ? "text-warning" : "text-accent"}`}>Still required</div>
                    <div className="mt-1 text-sm font-semibold">
                      {active.gap > 0
                        ? `${active.gap} headcount · ${active.service_breakdown.filter(s => s.gap > 0).map(s => `${s.service} (${s.gap})`).join(", ")}`
                        : "All filled ✓"}
                    </div>
                  </div>
                </div>
              </div>

              <h3 className="mt-6 text-sm font-semibold">Recommended Leads</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Candidates matching this language who could help close the gap.</p>
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

function LanguageSummaryBar({ demands }: { demands: ClientDemand[] }) {
  const byLang = useMemo(() => {
    const map = new Map<string, { needed: number; filled: number }>();
    for (const d of demands) {
      const cur = map.get(d.language) ?? { needed: 0, filled: 0 };
      map.set(d.language, { needed: cur.needed + d.headcount_needed, filled: cur.filled + d.filled });
    }
    return Array.from(map, ([language, v]) => ({ language, ...v, gap: v.needed - v.filled }));
  }, [demands]);

  if (!byLang.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {byLang.slice(0, 4).map(({ language, needed, filled, gap }) => (
        <div key={language} className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-[11px] font-semibold text-foreground">{language}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold tabular-nums">{filled}</span>
            <span className="text-[11px] text-muted-foreground">/ {needed}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-accent transition-all" style={{ width: `${needed ? Math.min(100, (filled / needed) * 100) : 0}%` }} />
          </div>
          <div className={`mt-1 text-[10px] font-medium ${gap > 0 ? "text-warning" : "text-accent"}`}>
            {gap > 0 ? `${gap} remaining` : "Complete ✓"}
          </div>
        </div>
      ))}
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

function PriorityPill({ priority }: { priority: ClientDemand["priority"] }) {
  const map = {
    critical: "bg-destructive/15 text-destructive",
    high: "bg-warning/15 text-warning",
    standard: "bg-muted text-muted-foreground",
  }[priority];
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${map}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: ClientDemand["status"] }) {
  const map = {
    active: "bg-accent/15 text-accent",
    fulfilled: "bg-[oklch(0.62_0.14_155)]/15 text-[oklch(0.42_0.14_155)]",
    paused: "bg-muted text-muted-foreground",
  }[status];
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${map}`}>{status}</span>;
}

function groupByLanguage(rows: ClientDemand[]) {
  const map = new Map<string, ClientDemand[]>();
  for (const r of rows) {
    const arr = map.get(r.language) ?? [];
    arr.push(r);
    map.set(r.language, arr);
  }
  return Array.from(map, ([language, rows]) => ({ language, rows }));
}
