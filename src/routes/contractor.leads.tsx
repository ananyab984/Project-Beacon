import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { myContractorLeads, useRecruiterStore, type RecruiterLead } from "@/lib/recruiter-mock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ArrowUpDown } from "lucide-react";

export const Route = createFileRoute("/contractor/leads")({
  head: () => ({
    meta: [
      { title: "My Leads — Global3 Contractor" },
      { name: "description", content: "Every lead you've submitted. Enrichment and outreach are handled by the team." },
    ],
  }),
  component: MyLeadsPage,
});

type SortKey = "lead" | "country" | "source" | "submitted";

function MyLeadsPage() {
  useRecruiterStore();
  const all = useMemo(() => myContractorLeads(), []);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("submitted");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const countries = useMemo(() => Array.from(new Set(all.map((l) => l.country_of_residence).filter(Boolean))), [all]);
  const sources = useMemo(() => Array.from(new Set(all.map((l) => l.source).filter(Boolean))), [all]);

  const filtered = useMemo(() => {
    const rows = all.filter((l) => {
      const ql = q.toLowerCase();
      return (
        (q === "" || l.full_name.toLowerCase().includes(ql) || l.email_address.toLowerCase().includes(ql)) &&
        (country === "all" || l.country_of_residence === country) &&
        (source === "all" || l.source === source) &&
        (status === "all" ||
          (status === "flagged" && l.dup_flagged) ||
          (status === "clean" && !l.dup_flagged) ||
          (status === "pending" && l.enrichment_status === "pending") ||
          (status === "complete" && l.enrichment_status === "complete"))
      );
    });
    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = sortVal(a, sortBy);
      const vb = sortVal(b, sortBy);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return rows;
  }, [all, q, country, source, status, sortBy, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const view = filtered.slice((page - 1) * pageSize, page * pageSize);

  function sortToggle(k: SortKey) {
    if (sortBy === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("asc"); }
  }
  function clearFilters() {
    setQ(""); setCountry("all"); setSource("all"); setStatus("all"); setPage(1);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search my leads by name or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Badge variant="outline" className="text-[11px]">{all.length} submitted</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <FilterSelect value={country} onChange={(v) => { setCountry(v); setPage(1); }} placeholder="Country" options={countries} />
        <FilterSelect value={source} onChange={(v) => { setSource(v); setPage(1); }} placeholder="Source" options={sources} />
        <FilterSelect
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          placeholder="Status"
          options={["flagged", "clean", "pending", "complete"]}
          labelFor={(v) => ({ flagged: "Duplicate flagged", clean: "Clean submissions", pending: "Enriching", complete: "Enriched" })[v] ?? v}
        />
        <div />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 text-left text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <SortableTh label="Lead" k="lead" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Country" k="country" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Source" k="source" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Languages</th>
                <th className="px-4 py-3">Services</th>
                <th className="px-4 py-3">Status</th>
                <SortableTh label="Submitted" k="submitted" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.full_name}</span>
                      {l.dup_flagged && (
                        <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">duplicate</Badge>
                      )}
                    </div>
                    {l.first_name && <div className="text-[11px] text-muted-foreground">{l.first_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-foreground/80">{l.country_of_residence || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{l.source}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground/80">{l.email_address || l.contact_number || "—"}</td>
                  <td className="px-4 py-3 text-foreground/80">
                    {l.source_language && l.target_language ? `${l.source_language} → ${l.target_language}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(l.services ?? []).map((s) => (
                        <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
                      ))}
                      {!l.services?.length && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {l.enrichment_status === "complete" ? (
                      <Badge variant="secondary" className="text-[10px]">Enriched</Badge>
                    ) : (
                      <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">Enriching</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {view.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No leads match these filters.
                    <button className="ml-2 text-primary hover:underline" onClick={clearFilters}>Clear filters</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing <span className="tabular-nums text-foreground">{view.length}</span> of{" "}
            <span className="tabular-nums text-foreground">{filtered.length}</span> leads
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="tabular-nums">Page {page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function sortVal(l: RecruiterLead, k: SortKey): string | number {
  switch (k) {
    case "lead": return l.full_name;
    case "country": return l.country_of_residence;
    case "source": return l.source;
    case "submitted": return l.created_at;
  }
}

function SortableTh({ label, k, sortBy, sortDir, onClick }: { label: string; k: SortKey; sortBy: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void }) {
  const active = sortBy === k;
  return (
    <th className="px-4 py-3">
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wide transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function FilterSelect({ value, onChange, placeholder, options, labelFor }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[]; labelFor?: (v: string) => string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {placeholder.toLowerCase()}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{labelFor ? labelFor(o) : o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}