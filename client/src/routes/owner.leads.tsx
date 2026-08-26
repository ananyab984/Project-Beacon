import { createFileRoute } from "@tanstack/react-router";
import { parseCsvLeads } from "@/lib/g3-mock";
import { api } from "@/lib/api";
import type { ApiLead, ApiUser, LeadSource, LeadStage } from "@/lib/api-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, ArrowUpDown, Upload, Download, Mail, UserPlus, X, Trash2, Table2, KanbanSquare } from "lucide-react";
import { useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/features/manual-enrichment-dialog";
import { LeadKanbanBoard } from "@/components/features/lead-kanban-board";

export const Route = createFileRoute("/owner/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Global3 Owner" },
      { name: "description", content: "CRM-style lead management: search, filter, sort, bulk actions." },
    ],
  }),
  component: LeadsPage,
});

const VALID_SOURCES: LeadSource[] = ["LINKEDIN", "PROZ", "ADA", "ATA", "ATAA", "BODALGO", "FREELANCER", "APOLLO"];

/** Best-effort mapping of a free-text / legacy source string to the LeadSource enum. */
function mapToLeadSource(raw: string | undefined | null): LeadSource {
  if (!raw) return "LINKEDIN";
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "");
  const hit = VALID_SOURCES.find((s) => s === upper || upper.includes(s));
  return hit ?? "LINKEDIN";
}

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
  const [q, setQ] = useState("");
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
  const [assignOpen, setAssignOpen] = useState(false);
  const [mode, setMode] = useState<"table" | "board">("table");
  const pageSize = 12;

  const filters = useMemo(
    () => ({
      q: q || undefined,
      language: lang !== "all" ? lang : undefined,
      country: country !== "all" ? country : undefined,
      service: service !== "all" ? service : undefined,
      recruiterId: rec !== "all" ? rec : undefined,
      stage: stage !== "all" ? stage : undefined,
      dateRange: dateRange !== "all" ? dateRange : undefined,
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
  const services = useMemo(
    () => Array.from(new Set(optionLeads.flatMap((l) => l.services))),
    [optionLeads],
  );
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

  const enrichMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ApiLead> }) => api.updateLead(id, patch),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to update lead"),
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage, closureReason }: { id: string; stage: string; closureReason?: string }) =>
      api.updateLead(id, { stage, closureReason } as Partial<ApiLead>),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to update stage"),
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

  const bulkCreateMutation = useMutation({
    mutationFn: (rows: Array<Partial<ApiLead> & { fullName: string; source: string }>) => api.bulkCreateLeads(rows),
    onSuccess: (res) => {
      const succeeded = res.results.filter((r) => !!r.leadId).length;
      toast.success(`Imported ${succeeded} of ${res.results.length} rows`);
      invalidateLeads();
    },
    onError: (err: any) => toast.error(err?.message ?? "Bulk upload failed"),
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

  const handleMarkEnriched = (id: string, updated: Partial<LeadForEnrichment>) => {
    const currentFlags = enrichRaw?.flags ?? [];
    enrichMutation.mutate({
      id,
      patch: {
        identityResolved: true,
        enrichmentStatus: "COMPLETE",
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
        flags: currentFlags.filter((f) => f !== "ON_HOLD"),
      },
    });
    setEnrichRaw(null);
    toast.success("Lead marked as Enriched & Email Queue updated!");
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
          <div role="tablist" aria-label="Lead view" className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <ViewTab active={mode === "table"} onClick={() => setMode("table")} label="Table" icon={Table2} />
            <ViewTab active={mode === "board"} onClick={() => setMode("board")} label="Board" icon={KanbanSquare} />
          </div>
          <BulkUploadDialog onSubmitRows={(rows) => bulkCreateMutation.mutate(rows)} />
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
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Source</th>
                <SortableTh label="Recruiter" k="recruiter" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
                <SortableTh label="Activity" k="activity" sortBy={sortBy} sortDir={sortDir} onClick={sortToggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leadsQuery.isLoading && (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
              )}
              {leadsQuery.isError && (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-sm text-destructive">Failed to load leads.</td></tr>
              )}
              {!leadsQuery.isLoading && !leadsQuery.isError && view.map((l) => {
                const r = recruiterList.find((x) => x.id === l.assignedRecruiterId);
                const label = l.displayName ?? l.fullName ?? l.maskedLabel ?? "—";
                const isSel = selected.has(l.id);
                const isEnriched = l.enrichmentStatus === "COMPLETE";
                // See recruiter.leads.tsx for why this reads `flags` rather
                // than inferring "On Hold" from enrichmentStatus alone -- a
                // lead awaiting Clay's async webhook reply was being shown
                // as stuck the instant it actually started enriching.
                const isOnHold = !isEnriched && (l.flags ?? []).includes("ON_HOLD");
                const isPending = !isEnriched && !isOnHold;
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
                      {isEnriched ? (
                        <span className="font-semibold text-xs text-emerald-400">
                          Enriched
                        </span>
                      ) : isPending ? (
                        <span className="font-semibold text-xs text-amber-400">
                          Enriching…
                        </span>
                      ) : (
                        <button
                          onClick={() => setEnrichRaw(l)}
                          className="font-semibold text-xs text-warning hover:underline cursor-pointer"
                        >
                          On Hold
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {l.targetLanguage ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.country ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {l.services.map((s) => (
                          <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium">{formatStageLabel(l.stage)}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.availability}</td>
                    <td className="px-4 py-3 text-foreground/80">{l.source}</td>
                    <td className="px-4 py-3 text-foreground/80">{r?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{relativeTime(l.lastActivityAt)}</td>
                  </tr>
                );
              })}
              {!leadsQuery.isLoading && !leadsQuery.isError && view.length === 0 && (
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
      )}

      {/* Manual Enrichment Modal */}
      <ManualEnrichmentDialog
        open={!!enrichLead}
        onOpenChange={(o) => !o && setEnrichRaw(null)}
        lead={enrichLead}
        onMarkEnriched={handleMarkEnriched}
      />

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

function ViewTab({
  active, onClick, label, icon: Icon,
}: { active: boolean; onClick: () => void; label: string; icon: typeof Table2 }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
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

function BulkUploadDialog({ onSubmitRows }: { onSubmitRows: (rows: Array<Partial<ApiLead> & { fullName: string; source: string }>) => void }) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || "";
      const parsed = parseCsvLeads(text);
      if (parsed.length > 0) {
        const rows = parsed.map((l: any) => ({
          fullName: l.display_name ?? l.masked_label,
          source: mapToLeadSource(l.source),
          services: l.services,
          country: l.country || undefined,
          profileLink: l.profile_link || undefined,
          sourceLanguage: l.source_language || "English",
          targetLanguage: l.target_language || l.language || "English",
          email: l.email || undefined,
          contactNumber: l.phone || undefined,
          yearsOfExperience: l.years_experience || undefined,
          vendorExperience: l.vendor_experience || undefined,
        }));
        onSubmitRows(rows);
        toast.success(`Uploaded ${file.name}. Importing ${parsed.length} candidate leads…`);
        setOpen(false);
      } else {
        toast.info(`Uploaded ${file.name}. Ensure file contains Name, Email, Language, or Service headers.`);
      }
    };
    reader.readAsText(file);
  };

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
        <label className="cursor-pointer block border-2 border-dashed border-border rounded-xl p-8 text-center space-y-2 hover:border-primary/50 transition-colors">
          <input ref={fileInputRef} type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" />
          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="text-xs font-semibold">Click to select or drop CSV/XLSX file here</div>
          <div className="text-[11px] text-muted-foreground">Supported fields: name, email, language, country, services, source</div>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
