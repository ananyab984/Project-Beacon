import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { EnrichmentStatusCell } from "@/components/features/enrichment-status-cell";
import type { ApiLead, ApiUser, LeadSource, LeadStage } from "@/lib/api-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ArrowUpDown, Download, Mail, UserPlus, X, Trash2, Table2, KanbanSquare, ChevronDown, Plus } from "lucide-react";
import { AddLeadDialog } from "@/components/features/add-lead-dialog";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/features/manual-enrichment-dialog";
import { EnrichmentDetailsDialog } from "@/components/features/enrichment-details-dialog";
import { ReenrichmentModal, useReenrichment } from "@/components/features/reenrichment-modal";
import { LeadKanbanBoard } from "@/components/features/lead-kanban-board";
import { ServicesCell } from "@/components/features/services-cell";
import { STANDARD_SERVICES } from "@/lib/services";

export const Route = createFileRoute("/owner/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Global3 Owner" },
      { name: "description", content: "CRM-style lead management: search, filter, sort, bulk actions." },
    ],
  }),
  // Lets the global search (⌘K) deep-link here with a query already applied,
  // e.g. selecting a lead result navigates to /owner/leads?q=<name> instead
  // of landing on an unfiltered list -- same pattern recruiter.leads.tsx
  // already uses for its `scope` param.
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: LeadsPage,
});


/** "NEGOTIATING" -> "Negotiating"; "INVITE_SENT" -> "Invite sent". */
function formatStageLabel(stage: string): string {
  return stage.charAt(0) + stage.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Relative time string from an ISO date, without pulling in a date library. */
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STAGE_OPTIONS: LeadStage[] = ["NEW", "CONTACTED", "REPLIED", "NEGOTIATING", "INVITE_SENT", "ONBOARDED", "COLD"];

type SortKey = "lead" | "language" | "country" | "stage" | "recruiter" | "activity";

function LeadsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState(Route.useSearch().q ?? "");
  const [lang, setLang] = useState("all");
  const [country, setCountry] = useState("all");
  const [service, setService] = useState("all");
  const [rec, setRec] = useState("all");
  const [stage, setStage] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [sortBy, setSortBy] = useState<SortKey>("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrichRaw, setEnrichRaw] = useState<ApiLead | null>(null);
  const [detailsLead, setDetailsLead] = useState<ApiLead | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [mode, setMode] = useState<"table" | "board">("table");
  const [pageSize, setPageSize] = useState(50);

  const filters = useMemo(
    () => ({
      q: q || undefined,
      language: lang !== "all" ? lang : undefined,
      country: country !== "all" ? country : undefined,
      service: service !== "all" ? service : undefined,
      recruiterId: rec !== "all" ? rec : undefined,
      stage: stage !== "all" ? stage : undefined,
      dateRange: dateRange !== "all" ? dateRange : undefined,
      // ponytail: client-side pagination over a single capped fetch (server
      // clamps limit to 100, see lead.routes.ts). Fine up to ~100 leads;
      // once a tenant exceeds that, wire the existing cursor/nextCursor
      // pagination into an infinite query instead of bumping this further.
      limit: 200,
    }),
    [q, lang, country, service, rec, stage, dateRange],
  );

  const leadsQuery = useQuery({
    queryKey: ["leads", filters],
    queryFn: () => api.getLeads(filters),
  });
  // Unfiltered pull (best-effort, capped) purely to populate the filter dropdown
  // option lists — the backend has no "distinct values" endpoint, so this is an
  // approximation over a bounded sample rather than the true global set.
  const optionsQuery = useQuery({
    queryKey: ["leads", "filter-options"],
    queryFn: () => api.getLeads({ limit: 200 }),
    staleTime: 60_000,
  });

  const recruitersQuery = useQuery({
    queryKey: ["users", "RECRUITER"],
    queryFn: () => api.getUsers("RECRUITER"),
  });
  const recruiterList: ApiUser[] = recruitersQuery.data?.users ?? [];

  const allLeads = leadsQuery.data?.leads ?? [];
  const optionLeads = optionsQuery.data?.leads ?? [];

  const languages = useMemo(
    () => Array.from(new Set(optionLeads.map((l) => l.targetLanguage).filter((v): v is string => !!v))),
    [optionLeads],
  );
  // Sourced from the canonical list, not derived from raw Lead.services --
  // that free-text data used to surface every typo/case-variant/concatenated
  // value ever ingested as its own filter option (e.g. "Sub:Dubbing:Audio
  // Description" as one entry). A fixed, canonical list can't drift that way.
  const services = STANDARD_SERVICES;
  const countries = useMemo(
    () => Array.from(new Set(optionLeads.map((l) => l.country).filter((v): v is string => !!v))),
    [optionLeads],
  );

  const deleteMutation = useMutation({
    mutationFn: (leadIds: string[]) => api.deleteLeads(leadIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setSelected(new Set());
      toast.success(`Deleted ${data.deletedCount} lead${data.deletedCount > 1 ? "s" : ""} successfully!`);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete leads");
    },
  });

  const baseSet = useMemo(() => allLeads, [allLeads]);

  const filtered = useMemo(() => {
    const rows = [...baseSet];
    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = sortVal(a, sortBy);
      const vb = sortVal(b, sortBy);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return rows;
  }, [baseSet, sortBy, sortDir]);

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

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["email-queue"] });
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  // Error feedback is handled by the two dialogs that use this (both now
  // await mutateAsync and show their own contextual error) -- no onError
  // toast here to avoid double-toasting the same failure.
  const enrichMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ApiLead> }) => api.updateLead(id, patch),
    onSuccess: () => invalidateLeads(),
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage, closureReason }: { id: string; stage: string; closureReason?: string }) =>
      api.updateLead(id, { stage, closureReason } as Partial<ApiLead>),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to update stage"),
  });

  const retryEnrichmentMutation = useMutation({
    mutationFn: (id: string) => api.retryLeadEnrichment(id),
    onSuccess: () => {
      invalidateLeads();
      toast.success("Queued for re-enrichment");
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to retry enrichment"),
  });

  const reenrichment = useReenrichment(invalidateLeads);

  // Manual On Hold toggle -- reuses the existing (previously unused) flags
  // endpoints, same as DNC/Watching/High Priority. Independent of field
  // count and of enrichmentStatus.
  const holdMutation = useMutation({
    mutationFn: (id: string) => api.addLeadFlag(id, "ON_HOLD"),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to put lead on hold"),
  });
  const unholdMutation = useMutation({
    mutationFn: (id: string) => api.removeLeadFlag(id, "ON_HOLD"),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to take lead off hold"),
  });

  const removeServiceMutation = useMutation({
    mutationFn: ({ id, service }: { id: string; service: string }) => api.removeLeadService(id, service),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to remove service"),
  });

  const assignMutation = useMutation({
    mutationFn: ({ ids, recruiterId }: { ids: string[]; recruiterId: string }) =>
      api.bulkUpdateLeads(ids, { recruiterId }),
    onSuccess: (res) => {
      toast.success(`Assigned ${res.updated} lead(s)`);
      invalidateLeads();
      setSelected(new Set());
      setAssignOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to assign leads"),
  });

  const enrichLead: LeadForEnrichment | null = enrichRaw
    ? {
        id: enrichRaw.id,
        name: enrichRaw.displayName ?? enrichRaw.fullName ?? enrichRaw.maskedLabel ?? "",
        email: enrichRaw.email,
        phone: enrichRaw.contactNumber,
        country: enrichRaw.country,
        profile_link: enrichRaw.profileLink,
        language: enrichRaw.targetLanguage ?? "",
        source_language: enrichRaw.sourceLanguage,
        target_language: enrichRaw.targetLanguage,
        services: enrichRaw.services,
        years_experience: enrichRaw.yearsOfExperience,
        vendor_experience: enrichRaw.vendorExperience,
      }
    : null;

  // Returns the mutation promise -- the dialog itself now awaits this and
  // only closes/toasts on success. No longer strips ON_HOLD here either -- a
  // manual field edit must not auto-clear it as a side effect (On Hold is
  // now driven only by the waterfall's own conclusion state or the
  // recruiter's explicit toggle).
  const handleMarkEnriched = (id: string, updated: Partial<LeadForEnrichment>) => {
    const shouldMarkComplete = updated.enrichment_status === "complete";
    return enrichMutation.mutateAsync({
      id,
      patch: {
        ...(shouldMarkComplete ? { identityResolved: true, enrichmentStatus: "COMPLETE" } : {}),
        displayName: updated.name,
        services: updated.services,
        sourceLanguage: updated.source_language,
        targetLanguage: updated.target_language,
        country: updated.country,
        profileLink: updated.profile_link,
        yearsOfExperience: updated.years_experience,
        vendorExperience: updated.vendor_experience,
        contactNumber: updated.phone,
        email: updated.email,
      },
    });
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Toolbar: search + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search global leads by name or ID…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                {mode === "table" ? <Table2 className="h-3.5 w-3.5" /> : <KanbanSquare className="h-3.5 w-3.5" />}
                {mode === "table" ? "Table" : "Board"}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setMode("table")}>
                <Table2 className="h-3.5 w-3.5" /> Table
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("board")}>
                <KanbanSquare className="h-3.5 w-3.5" /> Board
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild variant="outline" size="icon" className="h-8 w-8" title="Recycle Bin">
            <Link to="/owner/leads/recycle-bin">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">Recycle Bin</span>
            </Link>
          </Button>
          <AddLeadDialog
            trigger={
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">
                <Plus className="h-3.5 w-3.5" /> Add a Lead
              </Button>
            }
          />
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
          options={recruiterList.map((r) => r.id)}
          labelFor={(v) => recruiterList.find((r) => r.id === v)?.name ?? v}
        />
        <FilterSelect
          value={stage}
          onChange={(v) => { setStage(v); setPage(1); }}
          placeholder="Status"
          options={STAGE_OPTIONS}
          labelFor={formatStageLabel}
        />
        <FilterSelect
          value={dateRange}
          onChange={(v) => { setDateRange(v as typeof dateRange); setPage(1); }}
          placeholder="Date Added"
          options={["24h", "7d", "30d"]}
          labelFor={(v) => ({ "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" })[v] ?? v}
        />
      </div>

      {/* Bulk action bar */}
      {mode === "table" && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-medium">{selected.size} selected</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setAssignOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Assign
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                api.downloadLeadsExport(filters as unknown as Record<string, string | undefined>)
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Export failed"));
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(Array.from(selected))}
              className="h-8 text-xs gap-1.5 font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Lead{selected.size > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      )}

      {/* Board */}
      {mode === "board" && (
        <LeadKanbanBoard
          leads={filtered}
          recruiters={recruiterList}
          isLoading={leadsQuery.isLoading}
          onStageChange={(id, stage, closureReason) => stageMutation.mutate({ id, stage, closureReason })}
          onRemoveService={(id, service) => removeServiceMutation.mutate({ id, service })}
        />
      )}

      {/* Table */}
      {mode === "table" && (
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
                <th className="px-4 py-3">Source</th>
                <SortableTh label="Recruiter" k="recruiter" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Activity" k="activity" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leadsQuery.isLoading && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
              )}
              {leadsQuery.isError && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-destructive">Failed to load leads.</td></tr>
              )}
              {!leadsQuery.isLoading && !leadsQuery.isError && view.map((l) => {
                const r = recruiterList.find((x) => x.id === l.assignedRecruiterId);
                const label = l.displayName ?? l.fullName ?? l.maskedLabel ?? "—";
                const isSel = selected.has(l.id);
                // Which state this lead is in, and how each state renders,
                // now lives in EnrichmentStatusCell -- both leads tables read
                // the same logic from there instead of keeping a copy each.
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
                      <EnrichmentStatusCell
                        lead={l}
                        onOpenDetails={setDetailsLead}
                        onRetry={(id) => retryEnrichmentMutation.mutate(id)}
                        retryPending={retryEnrichmentMutation.isPending}
                        onReenrich={reenrichment.start}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {l.targetLanguage ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.country ?? "—"}</td>
                    <td className="px-4 py-3">
                      <ServicesCell
                        services={l.services}
                        onRemove={(service) => removeServiceMutation.mutate({ id: l.id, service })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium">{formatStageLabel(l.stage)}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.source}</td>
                    <td className="px-4 py-3 text-foreground/80">{r?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{relativeTime(l.lastActivityAt)}</td>
                  </tr>
                );
              })}
              {!leadsQuery.isLoading && !leadsQuery.isError && view.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 w-[68px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[12, 30, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="tabular-nums">Page {page} / {pageCount}</span>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Manual Enrichment Modal */}
      <ManualEnrichmentDialog
        open={!!enrichLead}
        onOpenChange={(o) => !o && setEnrichRaw(null)}
        lead={enrichLead}
        onMarkEnriched={handleMarkEnriched}
      />

      <EnrichmentDetailsDialog
        open={!!detailsLead}
        onOpenChange={(o) => !o && setDetailsLead(null)}
        lead={detailsLead}
        onSave={(id, patch) => enrichMutation.mutateAsync({ id, patch })}
        onToggleHold={(id, hold) => (hold ? holdMutation : unholdMutation).mutateAsync(id)}
      />

      <ReenrichmentModal {...reenrichment.modalProps} />

      {/* Assign picker */}
      <AssignRecruiterDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        recruiters={recruiterList}
        onAssign={(recruiterId) => assignMutation.mutate({ ids: Array.from(selected), recruiterId })}
        pending={assignMutation.isPending}
      />
    </div>
  );
}

function AssignRecruiterDialog({
  open, onOpenChange, recruiters, onAssign, pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recruiters: ApiUser[];
  onAssign: (recruiterId: string) => void;
  pending: boolean;
}) {
  const [recruiterId, setRecruiterId] = useState<string>("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign to recruiter</DialogTitle>
          <DialogDescription>Choose a recruiter to assign the selected leads to.</DialogDescription>
        </DialogHeader>
        <Select value={recruiterId} onValueChange={setRecruiterId}>
          <SelectTrigger><SelectValue placeholder="Select recruiter" /></SelectTrigger>
          <SelectContent>
            {recruiters.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!recruiterId || pending} onClick={() => recruiterId && onAssign(recruiterId)}>
            {pending ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function sortVal(l: ApiLead, k: SortKey): string | number {
  switch (k) {
    case "lead": return l.displayName ?? l.fullName ?? l.maskedLabel ?? "";
    case "language": return l.targetLanguage ?? "";
    case "country": return l.country ?? "";
    case "stage": return STAGE_OPTIONS.indexOf(l.stage);
    case "recruiter": return l.assignedRecruiterId ?? "";
    case "activity": return l.lastActivityAt ?? "";
    default: return "";
  }
}

