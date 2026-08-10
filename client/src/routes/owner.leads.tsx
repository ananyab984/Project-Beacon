import { createFileRoute } from "@tanstack/react-router";
import { leads, recruiters, stageOrder, type Lead } from "@/lib/g3-mock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, ArrowUpDown, Upload, Download, Mail, UserPlus, X, AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/features/manual-enrichment-dialog";

export const Route = createFileRoute("/owner/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Global3 Owner" },
      { name: "description", content: "CRM-style lead management: search, filter, sort, bulk actions." },
    ],
  }),
  component: LeadsPage,
});

const CURRENT_GLOBAL_RECRUITER_ID = "r1"; // Divya

// Language → country proxy for filtering + display.
const languageCountry: Record<string, string> = {
  French: "France", Japanese: "Japan", German: "Germany", Korean: "South Korea",
  "Spanish (LatAm)": "Mexico", Arabic: "UAE", Mandarin: "China",
  "Portuguese (BR)": "Brazil", Italian: "Italy", Dutch: "Netherlands",
};

type SortKey = "lead" | "language" | "country" | "stage" | "recruiter" | "activity";
type LeadScope = "global" | "mine";

function LeadsPage() {
  const [scope, setScope] = useState<LeadScope>("global");
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("all");
  const [country, setCountry] = useState("all");
  const [service, setService] = useState("all");
  const [rec, setRec] = useState("all");
  const [stage, setStage] = useState<string>("all");
  const [dateRange, setDateRange] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrichLead, setEnrichLead] = useState<LeadForEnrichment | null>(null);
  const [version, setVersion] = useState(0);
  const pageSize = 12;

  const globalEnrichedLeads = useMemo(
    () => leads.filter((l) => l.identity_resolved && !l.flags.includes("On Hold")),
    [version],
  );

  const mineCount = useMemo(
    () => leads.filter((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID).length,
    [version],
  );

  const baseSet = useMemo(
    () => (scope === "mine" ? leads.filter((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID) : globalEnrichedLeads),
    [scope, version, globalEnrichedLeads],
  );

  const languages = useMemo(() => Array.from(new Set(leads.map((l) => l.language))), []);
  const services = useMemo(() => Array.from(new Set(leads.flatMap((l) => l.services))), []);
  const countries = useMemo(() => Array.from(new Set(leads.map((l) => languageCountry[l.language] ?? "—"))), []);

  const filtered = useMemo(() => {
    const rows = baseSet.filter((l) => {
      const c = languageCountry[l.language] ?? "—";
      return (
        (q === "" ||
          l.masked_label.toLowerCase().includes(q.toLowerCase()) ||
          (l.display_name?.toLowerCase().includes(q.toLowerCase()) ?? false)) &&
        (lang === "all" || l.language === lang) &&
        (country === "all" || c === country) &&
        (service === "all" || l.services.includes(service)) &&
        (rec === "all" || l.recruiter_id === rec) &&
        (stage === "all" || l.stage === stage) &&
        (dateRange === "all" || matchesDate(l.last_activity, dateRange))
      );
    });
    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = sortVal(a, sortBy);
      const vb = sortVal(b, sortBy);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return rows;
  }, [baseSet, q, lang, country, service, rec, stage, dateRange, sortBy, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const view = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pageIds = view.map((l) => l.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggle(id: string) {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  }
  function togglePage() {
    const n = new Set(selected);
    if (allChecked) pageIds.forEach((id) => n.delete(id));
    else pageIds.forEach((id) => n.add(id));
    setSelected(n);
  }
  function sortToggle(k: SortKey) {
    if (sortBy === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("asc"); }
  }
  function clearFilters() {
    setQ(""); setLang("all"); setCountry("all"); setService("all");
    setRec("all"); setStage("all"); setDateRange("all"); setPage(1);
  }

  const handleMarkEnriched = (id: string, updated: Partial<LeadForEnrichment>) => {
    const targetLead = leads.find((l) => l.id === id);
    if (targetLead) {
      targetLead.identity_resolved = true;
      targetLead.display_name = updated.name || targetLead.display_name || "Enriched Lead";
      targetLead.language = updated.language || targetLead.language;
      targetLead.services = updated.services || targetLead.services;
      targetLead.flags = targetLead.flags.filter((f) => f !== "On Hold");
      setVersion((v) => v + 1);
    }
  };

  const manualEnrichmentNeededCount = useMemo(
    () => leads.filter((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID && (!l.identity_resolved || l.flags.includes("On Hold"))).length,
    [version],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Manual Enrichment Banner */}
      {manualEnrichmentNeededCount > 0 && scope === "mine" && (
        <div className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>{manualEnrichmentNeededCount} leads require manual enrichment.</strong> Please review missing candidate details to promote them to Global Leads.
            </span>
          </div>
          <Button
            size="sm"
            className="bg-warning text-warning-foreground hover:bg-warning/90 text-xs font-semibold h-7"
            onClick={() => {
              const firstOnHold = leads.find((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID && (!l.identity_resolved || l.flags.includes("On Hold")));
              if (firstOnHold) {
                setEnrichLead({
                  id: firstOnHold.id,
                  name: firstOnHold.display_name || firstOnHold.masked_label,
                  language: firstOnHold.language,
                  services: firstOnHold.services,
                  years_experience: firstOnHold.years_experience,
                  verified_email: firstOnHold.verified_email,
                });
              }
            }}
          >
            Review Now
          </Button>
        </div>
      )}

      {/* Toolbar: search + scope switcher tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads by name or ID…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <BulkUploadDialog />
          {/* Scope Tab Switcher: Global Leads vs My Leads */}
          <div role="tablist" aria-label="Lead scope" className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <ScopeTab active={scope === "global"} onClick={() => { setScope("global"); setPage(1); setSelected(new Set()); }} label="Global Leads" count={globalEnrichedLeads.length} />
            <ScopeTab active={scope === "mine"} onClick={() => { setScope("mine"); setPage(1); setSelected(new Set()); }} label="My Leads" count={mineCount} />
          </div>
        </div>
      </div>

      {/* Filters row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <FilterSelect value={country} onChange={(v) => { setCountry(v); setPage(1); }} placeholder="Country" options={countries} />
        <FilterSelect value={lang} onChange={(v) => { setLang(v); setPage(1); }} placeholder="Language" options={languages} />
        <FilterSelect value={service} onChange={(v) => { setService(v); setPage(1); }} placeholder="Service" options={services} />
        <FilterSelect
          value={rec}
          onChange={(v) => { setRec(v); setPage(1); }}
          placeholder="Recruiter"
          options={recruiters.map((r) => r.id)}
          labelFor={(v) => recruiters.find((r) => r.id === v)?.name ?? v}
        />
        <FilterSelect value={stage} onChange={(v) => { setStage(v); setPage(1); }} placeholder="Status" options={stageOrder as unknown as string[]} />
        <FilterSelect
          value={dateRange}
          onChange={(v) => { setDateRange(v); setPage(1); }}
          placeholder="Date Added"
          options={["24h", "7d", "30d"]}
          labelFor={(v) => ({ "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" })[v] ?? v}
        />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-medium">{selected.size} selected</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => toast.success(`Assigning ${selected.size} leads…`)}>
              <UserPlus className="h-3.5 w-3.5" /> Assign
            </Button>
            <Button variant="outline" size="sm" onClick={() => toast.success(`Queued ${selected.size} emails`)}>
              <Mail className="h-3.5 w-3.5" /> Email
            </Button>
            <Button variant="outline" size="sm" onClick={() => toast.success("Exporting selection…")}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 text-left text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allChecked} onCheckedChange={togglePage} aria-label="Select page" />
                </th>
                <SortableTh label="Lead" k="lead" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <th className="px-4 py-3 font-semibold text-foreground">ENRICHMENT STATUS</th>
                <SortableTh label="Language" k="language" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Country" k="country" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <th className="px-4 py-3">Services</th>
                <SortableTh label="Status" k="stage" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Source</th>
                <SortableTh label="Recruiter" k="recruiter" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Activity" k="activity" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.map((l) => {
                const r = recruiters.find((x) => x.id === l.recruiter_id);
                const label = l.identity_resolved ? l.display_name ?? l.masked_label : l.masked_label;
                const c = languageCountry[l.language] ?? "—";
                const isSel = selected.has(l.id);
                const isOnHold = !l.identity_resolved || l.flags.includes("On Hold");
                return (
                  <tr key={l.id} className={`transition-colors ${isSel ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                    <td className="px-4 py-3">
                      <Checkbox checked={isSel} onCheckedChange={() => toggle(l.id)} aria-label={`Select ${label}`} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isOnHold ? (
                        <button
                          onClick={() => setEnrichLead({
                            id: l.id,
                            name: label,
                            language: l.language,
                            services: l.services,
                            years_experience: l.years_experience,
                            verified_email: l.verified_email,
                          })}
                          className="font-semibold text-xs text-warning hover:underline cursor-pointer"
                        >
                          On Hold
                        </button>
                      ) : (
                        <span className="font-semibold text-xs text-emerald-400">
                          Enriched
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {l.language}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{c}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {l.services.map((s) => (
                          <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium">{l.stage}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.availability}</td>
                    <td className="px-4 py-3 text-foreground/80">{l.source}</td>
                    <td className="px-4 py-3 text-foreground/80">{r?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.last_activity}</td>
                  </tr>
                );
              })}
              {view.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No leads match these filters.
                    <button className="ml-2 text-primary hover:underline" onClick={clearFilters}>Clear filters</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
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

      {/* Manual Enrichment Modal */}
      <ManualEnrichmentDialog
        open={!!enrichLead}
        onOpenChange={(o) => !o && setEnrichLead(null)}
        lead={enrichLead}
        onMarkEnriched={handleMarkEnriched}
      />
    </div>
  );
}

function ScopeTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
        active ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
        {count}
      </span>
    </button>
  );
}

function FilterSelect({
  value, onChange, placeholder, options, labelFor,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
  labelFor?: (v: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs">
        <SelectValue placeholder={`All ${placeholder.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {placeholder.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{labelFor ? labelFor(o) : o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortableTh({
  label, k, sortBy, sortDir, onClick,
}: {
  label: string;
  k: SortKey;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const active = sortBy === k;
  return (
    <th className="px-4 py-3">
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 text-left font-semibold hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "text-primary" : "text-muted-foreground/60"}`} />
      </button>
    </th>
  );
}

function sortVal(l: (typeof leads)[number], k: SortKey): string | number {
  switch (k) {
    case "lead": return l.display_name ?? l.masked_label;
    case "language": return l.language;
    case "country": return languageCountry[l.language] ?? "";
    case "stage": return stageOrder.indexOf(l.stage);
    case "recruiter": return l.recruiter_id;
    case "activity": return l.last_activity;
    default: return "";
  }
}

function matchesDate(ago: string, range: string): boolean {
  if (range === "all") return true;
  if (range === "24h") return ago.includes("m ago") || ago.includes("h ago");
  if (range === "7d") return ago.includes("m ago") || ago.includes("h ago") || (ago.includes("d ago") && parseInt(ago) <= 7);
  if (range === "30d") return true;
  return true;
}

function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-3.5 w-3.5" /> Bulk Upload
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Upload Leads</DialogTitle>
          <DialogDescription>Upload a CSV or Excel sheet with candidate info to create leads in bulk.</DialogDescription>
        </DialogHeader>
        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center space-y-2">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="text-xs font-semibold">Drop CSV/XLSX file here, or click to browse</div>
          <div className="text-[11px] text-muted-foreground">Supported fields: name, email, language, country, services, source</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { toast.success("Bulk import complete!"); setOpen(false); }}>Upload &amp; Process</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
