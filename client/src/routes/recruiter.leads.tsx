import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { EnrichmentStatusCell } from "@/components/features/enrichment-status-cell";
import type { ApiLead, ApiUser, LeadSource, LeadStage, LeadTimelineEvent } from "@/lib/api-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  ArrowUpDown,
  Download,
  Mail,
  UserPlus,
  X,
  Activity,
  Clock,
  AlertTriangle,
  Trash2,
  Table2,
  KanbanSquare,
  ChevronDown,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ManualEnrichmentDialog,
  type LeadForEnrichment,
} from "@/components/features/manual-enrichment-dialog";
import { EnrichmentDetailsDialog } from "@/components/features/enrichment-details-dialog";
import { ReenrichmentModal, useReenrichment } from "@/components/features/reenrichment-modal";
import { LeadKanbanBoard } from "@/components/features/lead-kanban-board";
import { ServicesCell } from "@/components/features/services-cell";
import { LeadNotifyBell } from "@/components/features/lead-notify-bell";
import { STANDARD_SERVICES } from "@/lib/services";

export const Route = createFileRoute("/recruiter/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Global3 Recruiter" },
      {
        name: "description",
        content:
          "CRM-style lead management for recruiters: global vs my leads, filters, bulk actions.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    scope: (s.scope === "mine" ? "mine" : "global") as Scope,
  }),
  component: LeadsPage,
});


function formatStageLabel(stage: string): string {
  return stage.charAt(0) + stage.slice(1).toLowerCase().replace(/_/g, " ");
}

// Purely a visual completeness signal for the recruiter -- never gates any
// action. Reuses the exact same fields enrichLeadById (server/src/jobs/
// enrichment.job.ts) already treats as "critical" (its own comment: "email,
// contact number, years of experience"), plus identityResolved as the
// verified-name signal, rather than inventing a second definition of
// enriched. No numeric enrichment score exists anywhere else in the app to
// reuse instead (confirmed: the one thing that looks like one, the owner
// dashboard's "profile completeness" tile, is hardcoded mock data).
function enrichmentCompleteness(l: ApiLead): number {
  const checks = [l.identityResolved, !!l.email, !!l.contactNumber, l.yearsOfExperience != null];
  return checks.filter(Boolean).length / checks.length;
}
const ENRICHMENT_COMPLETENESS_THRESHOLD = 0.75;

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

const STAGE_OPTIONS: LeadStage[] = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "NEGOTIATING",
  "INVITE_SENT",
  "ONBOARDED",
  "COLD",
];

type SortKey = "lead" | "language" | "country" | "stage" | "recruiter" | "activity";
type Scope = "global" | "mine";

function LeadsPage() {
  const queryClient = useQueryClient();
  const initialScope = Route.useSearch().scope;
  const [scope, setScope] = useState<Scope>(initialScope);
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
  const [detailsLead, setDetailsLead] = useState<ApiLead | null>(null);
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

  // Global Leads: server-scoped (already filters to enriched + own leads for this
  // recruiter per RBAC rules) via GET /api/leads. My Leads: GET /api/leads/mine.
  // Both queries run regardless of active tab so the ScopeTab counts + the
  // On-Hold banner stay accurate no matter which tab is showing.
  const globalQuery = useQuery({
    queryKey: ["leads", filters],
    queryFn: () => api.getLeads(filters),
  });
  const mineQuery = useQuery({
    queryKey: ["leads", "mine"],
    queryFn: () => api.getMyLeads(),
  });
  const recruitersQuery = useQuery({
    queryKey: ["users", "RECRUITER"],
    queryFn: () => api.getUsers("RECRUITER"),
  });
  const recruiterList: ApiUser[] = recruitersQuery.data?.users ?? [];

  const globalLeads = globalQuery.data?.leads ?? [];
  const mineLeads = mineQuery.data?.leads ?? [];

  const scoped = scope === "mine" ? mineLeads : globalLeads;
  const mineCount = mineLeads.length;
  const onHoldCount = useMemo(
    () =>
      mineLeads.filter(
        (l) => l.enrichmentStatus !== "COMPLETE" && l.enrichmentStatus !== "IN_PROGRESS",
      ).length,
    [mineLeads],
  );

  const languages = useMemo(
    () =>
      Array.from(new Set(globalLeads.map((l) => l.targetLanguage).filter((v): v is string => !!v))),
    [globalLeads],
  );
  // Sourced from the canonical list, not derived from raw Lead.services --
  // see owner.leads.tsx for why (redundant/garbled values otherwise).
  const services = STANDARD_SERVICES;
  const countries = useMemo(
    () => Array.from(new Set(globalLeads.map((l) => l.country).filter((v): v is string => !!v))),
    [globalLeads],
  );

  const filtered = useMemo(() => {
    const rows = [...scoped];
    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = sortVal(a, sortBy);
      const vb = sortVal(b, sortBy);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return rows;
  }, [scoped, sortBy, sortDir]);

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
    else {
      setSortBy(k);
      setSortDir("asc");
    }
  }
  function clearFilters() {
    setQ("");
    setLang("all");
    setCountry("all");
    setService("all");
    setRec("all");
    setStage("all");
    setDateRange("all");
    setPage(1);
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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ApiLead> }) =>
      api.updateLead(id, patch),
    onSuccess: () => invalidateLeads(),
  });

  const stageMutation = useMutation({
    mutationFn: ({
      id,
      stage,
      closureReason,
    }: {
      id: string;
      stage: string;
      closureReason?: string;
    }) => api.updateLead(id, { stage, closureReason } as Partial<ApiLead>),
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
  // count and of enrichmentStatus: applies to a lead regardless of how many
  // fields are populated, and never triggers a re-enrichment run.
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
    mutationFn: ({ id, service }: { id: string; service: string }) =>
      api.removeLeadService(id, service),
    onSuccess: () => invalidateLeads(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to remove service"),
  });

  const claimMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.claimLead(id)));
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed === 0) toast.success(`Claimed ${ok} lead(s)`);
      else toast.warning(`Claimed ${ok} lead(s), ${failed} already claimed or failed`);
      invalidateLeads();
      setSelected(new Set());
    },
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

  const deleteMutation = useMutation({
    mutationFn: (leadIds: string[]) => api.deleteLeads(leadIds),
    onSuccess: (data) => {
      invalidateLeads();
      setSelected(new Set());
      toast.success(
        `Deleted ${data.deletedCount} lead${data.deletedCount > 1 ? "s" : ""} successfully!`,
      );
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete leads");
    },
  });

  // Returns the mutation promise -- the dialog itself now awaits this and
  // only closes/toasts on success (previously this closed the dialog and
  // showed a success toast synchronously, before the PATCH had even
  // resolved). No longer strips ON_HOLD here either -- a manual field edit
  // must not auto-clear it as a side effect (On Hold is now driven only by
  // the waterfall's own conclusion state or the recruiter's explicit
  // toggle); this handler previously did that unconditionally regardless of
  // which dialog button was clicked.
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
      {/* On Hold Notification Alert Banner */}
      {scope === "mine" && onHoldCount > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-amber-100">
              <strong className="font-semibold text-amber-300">
                {onHoldCount} lead{onHoldCount > 1 ? "s" : ""} require manual enrichment.
              </strong>{" "}
              <span className="text-amber-200/90">
                Please review missing candidate details to promote {onHoldCount > 1 ? "them" : "it"}{" "}
                to Global Leads.
              </span>
            </span>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 text-black font-semibold hover:bg-amber-400 border-none shrink-0 shadow-sm"
            onClick={() => {
              const firstOnHold = scoped.find(
                (l) =>
                  l.enrichmentStatus !== "COMPLETE" &&
                  (!l.identityResolved || l.flags.includes("ON_HOLD")),
              );
              if (firstOnHold) setEnrichRaw(firstOnHold);
            }}
          >
            Review Now
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[280px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads by name or ID…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
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
          {/* Delete lives only in the Global Leads scope -- this is its recycle bin. */}
          {scope === "global" && (
            <Button asChild variant="outline" size="icon" className="h-8 w-8" title="Recycle Bin">
              <Link to="/recruiter/leads/recycle-bin">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Recycle Bin</span>
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                {scope === "global" ? "Global Leads" : "My Leads"}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                  {scope === "global" ? globalLeads.length : mineCount}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setScope("global");
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                Global Leads
                <DropdownMenuShortcut>{globalLeads.length}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setScope("mine");
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                My Leads
                <DropdownMenuShortcut>{mineCount}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <FilterSelect
          value={country}
          onChange={(v) => {
            setCountry(v);
            setPage(1);
          }}
          placeholder="Country"
          options={countries}
        />
        <FilterSelect
          value={lang}
          onChange={(v) => {
            setLang(v);
            setPage(1);
          }}
          placeholder="Language"
          options={languages}
        />
        <FilterSelect
          value={service}
          onChange={(v) => {
            setService(v);
            setPage(1);
          }}
          placeholder="Service"
          options={services}
        />
        <FilterSelect
          value={rec}
          onChange={(v) => {
            setRec(v);
            setPage(1);
          }}
          placeholder="Recruiter"
          options={recruiterList.map((r) => r.id)}
          labelFor={(v) => recruiterList.find((r) => r.id === v)?.name ?? v}
        />
        <FilterSelect
          value={stage}
          onChange={(v) => {
            setStage(v);
            setPage(1);
          }}
          placeholder="Status"
          options={STAGE_OPTIONS}
          labelFor={formatStageLabel}
        />
        <FilterSelect
          value={dateRange}
          onChange={(v) => {
            setDateRange(v as typeof dateRange);
            setPage(1);
          }}
          placeholder="Date Added"
          options={["24h", "7d", "30d"]}
          labelFor={(v) =>
            ({ "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" })[v] ?? v
          }
        />
      </div>

      {/* Bulk action bar */}
      {mode === "table" && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-medium">{selected.size} selected</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                api
                  .downloadLeadsExport(filters as unknown as Record<string, string | undefined>)
                  .catch((err) =>
                    toast.error(err instanceof Error ? err.message : "Export failed"),
                  );
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            {/* Delete lives only in the Global Leads scope, never "My Leads". */}
            {scope === "global" && (
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(Array.from(selected))}
                className="h-8 text-xs gap-1.5 font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Lead{selected.size > 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Board */}
      {mode === "board" && (
        <LeadKanbanBoard
          leads={filtered}
          recruiters={recruiterList}
          isLoading={scope === "mine" ? mineQuery.isLoading : globalQuery.isLoading}
          onStageChange={(id, stage, closureReason) =>
            stageMutation.mutate({ id, stage, closureReason })
          }
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
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={togglePage}
                      aria-label="Select page"
                    />
                  </th>
                  <SortableTh
                    label="Lead"
                    k="lead"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={sortToggle}
                  />
                  <th className="px-4 py-3 font-semibold text-foreground">ENRICHMENT STATUS</th>
                  <SortableTh
                    label="Language"
                    k="language"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={sortToggle}
                  />
                  <SortableTh
                    label="Country"
                    k="country"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={sortToggle}
                  />
                  <th className="px-4 py-3">Services</th>
                  <SortableTh
                    label="Status"
                    k="stage"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={sortToggle}
                  />
                  <th className="px-4 py-3">Source</th>
                  <SortableTh
                    label="Recruiter"
                    k="recruiter"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={sortToggle}
                  />
                  <SortableTh
                    label="Activity"
                    k="activity"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onClick={sortToggle}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(scope === "mine" ? mineQuery.isLoading : globalQuery.isLoading) &&
                  view.length === 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        Loading…
                      </td>
                    </tr>
                  )}
                {(scope === "mine" ? mineQuery.isError : globalQuery.isError) &&
                  view.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-sm text-destructive">
                        Failed to load leads.
                      </td>
                    </tr>
                  )}
                {view.map((l) => {
                  const r = recruiterList.find((x) => x.id === l.assignedRecruiterId);
                  const label = l.displayName ?? l.fullName ?? l.maskedLabel ?? "—";
                  const isSel = selected.has(l.id);
                  // On Hold is an overlay independent of completion -- reserved
                  // for the waterfall not concluding (timeout/system_error,
                  // including a stalled/orphaned run) or a recruiter's own
                  // manual toggle, never for a low field count. That rule, the
                  // retry eligibility, and how each state renders now live in
                  // EnrichmentStatusCell so both leads tables share one copy.
                  const completeness = enrichmentCompleteness(l);
                  const isWellEnriched = completeness >= ENRICHMENT_COMPLETENESS_THRESHOLD;
                  return (
                    <tr
                      key={l.id}
                      className={`transition-colors ${isSel ? "bg-primary/5" : "hover:bg-muted/40"}`}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggle(l.id)}
                          aria-label={`Select ${label}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isWellEnriched ? "bg-emerald-500" : "bg-destructive"}`}
                            title={
                              isWellEnriched
                                ? "Well-enriched profile"
                                : "Profile data still incomplete"
                            }
                          />
                          <span className="font-medium">{label}</span>
                          <LeadNotifyBell leadId={l.id} />
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
                          onRemove={(service) =>
                            removeServiceMutation.mutate({ id: l.id, service })
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        {scope === "mine" ? (
                          <StageCell lead={l} onChanged={invalidateLeads} />
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                            {formatStageLabel(l.stage)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground/80">{l.source}</td>
                      <td className="px-4 py-3 text-foreground/80">{r?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        {scope === "mine" ? (
                          <ActivityCell lead={l} recruiterName={r?.name ?? "—"} />
                        ) : (
                          <span className="text-muted-foreground">
                            {relativeTime(l.lastActivityAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {view.length === 0 &&
                  !(scope === "mine" ? mineQuery.isLoading : globalQuery.isLoading) && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        No leads match these filters.
                        <button
                          className="ml-2 text-primary hover:underline"
                          onClick={clearFilters}
                        >
                          Clear filters
                        </button>
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
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span>Rows per page</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-7 w-[68px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[12, 30, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="tabular-nums">
                  Page {page} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
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
    </div>
  );
}

function StageCell({ lead, onChanged }: { lead: ApiLead; onChanged: () => void }) {
  const mutation = useMutation({
    mutationFn: (patch: { stage: string; closureReason?: string }) =>
      api.updateLead(lead.id, patch as Partial<ApiLead>),
    onSuccess: () => onChanged(),
    onError: (err: any) => toast.error(err?.message ?? "Failed to update stage"),
  });

  function onValueChange(v: string) {
    if (v === "COLD") {
      // Server requires a closureReason in the same PATCH when stage -> COLD
      // (400 REASON_REQUIRED otherwise), so prompt for one up front.
      const reason = window.prompt("Reason for marking this lead Cold?");
      if (!reason || !reason.trim()) {
        toast.info("Stage change cancelled — a reason is required for Cold");
        return;
      }
      mutation.mutate({ stage: v, closureReason: reason.trim() });
    } else {
      mutation.mutate({ stage: v });
    }
  }

  return (
    <Select value={lead.stage} onValueChange={onValueChange}>
      <SelectTrigger className="h-7 w-[135px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGE_OPTIONS.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {formatStageLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function timelineIcon(type: LeadTimelineEvent["type"]): string {
  switch (type) {
    case "STAGE_CHANGE":
      return "🟦";
    case "FLAG":
      return "🚩";
    case "INTERACTION":
      return "💬";
    case "MANUAL_ACTIVITY":
      return "📝";
    default:
      return "•";
  }
}

function timelineTitle(e: LeadTimelineEvent): string {
  switch (e.type) {
    case "STAGE_CHANGE":
      return `Stage → ${formatStageLabel(e.data.toStage ?? "")}`;
    case "FLAG":
      return `Flag ${e.data.action === "removed" ? "removed" : "added"}: ${e.data.flag ?? ""}`;
    case "INTERACTION":
      return `${e.data.direction === "OUTBOUND" ? "Outreach sent" : "Reply received"} · ${e.data.channel ?? ""}`;
    case "MANUAL_ACTIVITY":
      return e.data.type ?? "Manual activity";
    default:
      return e.type;
  }
}

function timelineDetail(e: LeadTimelineEvent): string | undefined {
  switch (e.type) {
    case "STAGE_CHANGE":
      return e.data.reason
        ? `${e.data.fromStage ?? "—"} → ${e.data.toStage ?? "—"}. Reason: ${e.data.reason}`
        : `${e.data.fromStage ?? "—"} → ${e.data.toStage ?? "—"}`;
    case "FLAG":
      return e.data.reason;
    case "INTERACTION":
      return e.data.occurredAt ? new Date(e.data.occurredAt).toLocaleString() : undefined;
    case "MANUAL_ACTIVITY":
      return (
        [e.data.purpose, e.data.outcome, e.data.notes].filter(Boolean).join(" — ") || undefined
      );
    default:
      return undefined;
  }
}

function ActivityCell({ lead, recruiterName }: { lead: ApiLead; recruiterName: string }) {
  const [open, setOpen] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["lead", lead.id],
    queryFn: () => api.getLead(lead.id),
    enabled: open,
  });
  const label = lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? "—";
  const timeline = [...(detailQuery.data?.timeline ?? [])].reverse();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
        >
          <Clock className="h-3 w-3" />
          {relativeTime(lead.lastActivityAt)}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Activity — {label}
          </DialogTitle>
          <DialogDescription>
            Full timeline of interactions, stage changes, and enrichment events
            {recruiterName !== "—" ? ` for ${recruiterName}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {detailQuery.isLoading && (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
          )}
          {detailQuery.isError && (
            <div className="py-8 text-center text-xs text-destructive">
              Failed to load activity.
            </div>
          )}
          {!detailQuery.isLoading && !detailQuery.isError && (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {timeline.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">
                    {timelineIcon(e.type)}
                  </span>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">{timelineTitle(e)}</div>
                    <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {relativeTime(e.at)}
                    </div>
                  </div>
                  {timelineDetail(e) && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{timelineDetail(e)}</div>
                  )}
                </li>
              ))}
              {timeline.length === 0 && (
                <li className="text-xs text-muted-foreground">No activity recorded yet.</li>
              )}
            </ol>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sortVal(l: ApiLead, k: SortKey): string | number {
  switch (k) {
    case "lead":
      return l.displayName ?? l.fullName ?? l.maskedLabel ?? "";
    case "language":
      return l.targetLanguage ?? "";
    case "country":
      return l.country ?? "";
    case "stage":
      return STAGE_OPTIONS.indexOf(l.stage);
    case "recruiter":
      return l.assignedRecruiterId ?? "";
    case "activity":
      return l.lastActivityAt ?? "";
  }
}

function SortableTh({
  label,
  k,
  sortBy,
  sortDir,
  onClick,
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
        className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wide transition-colors ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  labelFor,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
  labelFor?: (v: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {placeholder.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labelFor ? labelFor(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

