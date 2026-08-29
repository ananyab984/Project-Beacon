import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiLead } from "@/lib/api-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ArrowUpDown, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/features/manual-enrichment-dialog";

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
  const queryClient = useQueryClient();
  const leadsQuery = useQuery({
    queryKey: ["leads", "mine"],
    queryFn: () => api.getMyLeads(),
  });
  const all = leadsQuery.data?.leads ?? [];

  const [q, setQ] = useState("");
  const [country, setCountry] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("submitted");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [enrichRaw, setEnrichRaw] = useState<ApiLead | null>(null);
  const pageSize = 12;

  const countries = useMemo(() => Array.from(new Set(all.map((l) => l.country).filter((v): v is string => !!v))), [all]);
  const sources = useMemo(() => Array.from(new Set(all.map((l) => l.source).filter(Boolean))), [all]);

  const onHoldCount = useMemo(
    () => all.filter((l) => l.enrichmentStatus === "PENDING" || l.dupFlagged).length,
    [all],
  );

  const filtered = useMemo(() => {
    const rows = all.filter((l) => {
      const ql = q.toLowerCase();
      const name = (l.fullName ?? "").toLowerCase();
      const email = (l.email ?? "").toLowerCase();
      return (
        (q === "" || name.includes(ql) || email.includes(ql)) &&
        (country === "all" || l.country === country) &&
        (source === "all" || l.source === source) &&
        (status === "all" ||
          (status === "flagged" && l.dupFlagged) ||
          (status === "clean" && !l.dupFlagged) ||
          (status === "pending" && l.enrichmentStatus === "PENDING") ||
          (status === "complete" && l.enrichmentStatus === "COMPLETE"))
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

  const enrichMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ApiLead> }) => api.updateLead(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads", "mine"] }),
    onError: (err: any) => toast.error(err?.message ?? "Failed to update lead"),
  });

  const enrichLead: LeadForEnrichment | null = enrichRaw
    ? {
        id: enrichRaw.id,
        name: enrichRaw.fullName ?? enrichRaw.displayName ?? enrichRaw.maskedLabel ?? "",
        email: enrichRaw.email,
        phone: enrichRaw.contactNumber,
        language: enrichRaw.targetLanguage ?? enrichRaw.sourceLanguage ?? "",
        source_language: enrichRaw.sourceLanguage,
        target_language: enrichRaw.targetLanguage,
        services: enrichRaw.services ?? [],
        years_experience: enrichRaw.yearsOfExperience,
        vendor_experience: enrichRaw.vendorExperience,
      }
    : null;

  const handleMarkEnriched = (id: string, updated: Partial<LeadForEnrichment>) => {
    enrichMutation.mutate({
      id,
      patch: {
        identityResolved: true,
        fullName: updated.name,
        email: updated.email,
        contactNumber: updated.phone,
        services: updated.services,
        sourceLanguage: updated.source_language,
        targetLanguage: updated.target_language,
        yearsOfExperience: updated.years_experience,
        vendorExperience: updated.vendor_experience,
      },
    });
    setEnrichRaw(null);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* On Hold Notification Alert Banner for Contractors */}
      {onHoldCount > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-amber-100">
              <strong className="font-semibold text-amber-300">{onHoldCount} lead{onHoldCount > 1 ? "s" : ""} require manual enrichment review.</strong>{" "}
              <span className="text-amber-200/90">Please complete missing details to verify your submitted lead.</span>
            </span>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 text-black font-semibold hover:bg-amber-400 border-none shrink-0 shadow-sm"
            onClick={() => {
              const firstOnHold = all.find((l) => l.enrichmentStatus === "PENDING" || l.dupFlagged);
              if (firstOnHold) setEnrichRaw(firstOnHold);
            }}
          >
            Review Now
          </Button>
        </div>
      )}

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
                <th className="px-4 py-3 font-semibold text-foreground">ENRICHMENT STATUS</th>
                <SortableTh label="Country" k="country" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Source" k="source" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Languages</th>
                <th className="px-4 py-3">Services</th>
                <SortableTh label="Submitted" k="submitted" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leadsQuery.isLoading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
              )}
              {leadsQuery.isError && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-destructive">Failed to load your leads.</td></tr>
              )}
              {!leadsQuery.isLoading && !leadsQuery.isError && view.map((l) => {
                const isOnHold = l.enrichmentStatus === "PENDING" || l.dupFlagged;
                const label = l.fullName ?? l.displayName ?? l.maskedLabel ?? "—";
                return (
                  <tr key={l.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{label}</span>
                        {l.dupFlagged && (
                          <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">duplicate</Badge>
                        )}
                      </div>
                      {l.firstName && <div className="text-[11px] text-muted-foreground">{l.firstName}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {isOnHold ? (
                        <button
                          onClick={() => setEnrichRaw(l)}
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
                    <td className="px-4 py-3 text-foreground/80">{l.country || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{l.source}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.email || l.contactNumber || "—"}</td>
                    <td className="px-4 py-3 text-foreground/80">
                      {l.sourceLanguage && l.targetLanguage ? `${l.sourceLanguage} → ${l.targetLanguage}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(l.services ?? []).map((s) => (
                          <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
                        ))}
                        {!l.services?.length && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
              {!leadsQuery.isLoading && !leadsQuery.isError && view.length === 0 && (
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

      {/* Manual Enrichment Modal for Contractors */}
      <ManualEnrichmentDialog
        open={!!enrichLead}
        onOpenChange={(o) => !o && setEnrichRaw(null)}
        lead={enrichLead}
        onMarkEnriched={handleMarkEnriched}
      />
    </div>
  );
}

function sortVal(l: ApiLead, k: SortKey): string | number {
  switch (k) {
    case "lead": return l.fullName ?? l.displayName ?? l.maskedLabel ?? "";
    case "country": return l.country ?? "";
    case "source": return l.source;
    case "submitted": return l.createdAt;
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
