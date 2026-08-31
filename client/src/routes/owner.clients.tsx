import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiRequirement, ApiUser } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus,
  Search,
  AlertCircle,
  Clock,
  CheckCircle2,
  ChevronRight,
  History,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClientLogo } from "@/components/features/client-logo";
import { LeadCard } from "@/components/features/lead-card";
import { RecruiterLanguageMappingDialog } from "@/components/features/recruiter-language-mapping-dialog";
import { openClientDemand } from "@/components/features/client-demand-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/clients")({
  head: () => ({
    meta: [
      { title: "Clients & Market Demand — Global3" },
      { name: "description", content: "Tabular client requirement management with dynamic recruiter assignments." },
    ],
  }),
  // Lets the global search (⌘K) deep-link here with a query already applied
  // -- same pattern owner.leads.tsx uses.
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: ClientsPage,
});

/** Deterministic decorative avatar hue since ApiUser has no stored color. */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function titleCase(s: string): string {
  return s.length ? s[0] + s.slice(1).toLowerCase() : s;
}

function ClientsPage() {
  const queryClient = useQueryClient();

  const [q, setQ] = useState(Route.useSearch().q ?? "");
  const [selectedClient, setSelectedClient] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const [drill, setDrill] = useState<string | null>(null);
  const [showMappingModal, setShowMappingModal] = useState(false);

  const { data: clientsData } = useQuery({ queryKey: ["clients"], queryFn: () => api.getClients() });
  const clients = clientsData?.clients ?? [];

  const { data: recruitersData } = useQuery({ queryKey: ["users", "RECRUITER"], queryFn: () => api.getUsers("RECRUITER") });
  const recruiters = recruitersData?.users ?? [];

  // Unfiltered set — used for the summary metric tiles with auto-sync.
  const { data: allReqData } = useQuery({
    queryKey: ["requirements", "all"],
    queryFn: () => api.getRequirements(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const allRequirements = allReqData?.requirements ?? [];

  const filters = useMemo(
    () => ({
      clientId: selectedClient !== "all" ? selectedClient : undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      priority: priorityFilter !== "all" ? priorityFilter : undefined,
      q: q || undefined,
    }),
    [selectedClient, statusFilter, priorityFilter, q],
  );

  const {
    data: filteredReqData,
    isLoading: reqLoading,
    error: reqError,
  } = useQuery({
    queryKey: ["requirements", filters],
    queryFn: () => api.getRequirements(filters),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const filteredRequirements = useMemo(() => {
    const list = filteredReqData?.requirements ?? [];
    return [...list].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [filteredReqData]);

  const assignMutation = useMutation({
    mutationFn: ({ id, recruiterId }: { id: string; recruiterId: string | null }) => api.assignRequirement(id, recruiterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requirements"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to update recruiter assignment"),
  });

  const updateDeadlineMutation = useMutation({
    mutationFn: ({ id, deadline }: { id: string; deadline: string }) => api.updateRequirement(id, { deadline }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requirements"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to update deadline"),
  });

  // Overall metrics
  const totalReqs = allRequirements.length;
  const unassignedReqs = allRequirements.filter((r) => !r.recruiterId).length;
  const activeReqs = allRequirements.filter((r) => r.status === "ACTIVE").length;
  const fulfilledReqs = allRequirements.filter((r) => r.status === "FULFILLED").length;

  const activeReq = allRequirements.find((r) => r.id === drill) ?? filteredRequirements.find((r) => r.id === drill);

  const { data: activeLeadsData } = useQuery({
    queryKey: ["leads", "by-language", activeReq?.language],
    queryFn: () => api.getLeads({ language: activeReq!.language, limit: 6 }),
    enabled: !!activeReq,
  });
  const activeLeads = activeLeadsData?.leads ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Metric Tiles Header */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total Requirements" value={totalReqs} tone="muted" subtext="Across all clients" />
        <MetricCard
          label="Unassigned"
          value={unassignedReqs}
          tone={unassignedReqs > 0 ? "warn" : "ok"}
          subtext="Requires owner assignment"
        />
        <MetricCard label="Active Hiring" value={activeReqs} tone="info" subtext="In recruiter pipeline" />
        <MetricCard label="Fulfilled" value={fulfilledReqs} tone="ok" subtext="Headcount met" />
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[280px]">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by client, language, service, project…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-8 text-xs bg-card"
            />
          </div>

          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-44 h-8 text-xs bg-card">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients ({clients.length})</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-card">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="FULFILLED">Fulfilled</SelectItem>
              <SelectItem value="PAUSED">Paused</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-card">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="STANDARD">Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={openClientDemand}
            className="h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add Client Demand
          </Button>
        </div>
      </div>

      {/* Main Tabular View */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Client · Project</th>
              <th className="px-5 py-3 font-medium">Language — Service</th>
              <th className="px-5 py-3 font-medium">Assigned Recruiter</th>
              <th className="px-5 py-3 font-medium">Priority</th>
              <th className="px-5 py-3 font-medium">Due Date &amp; Risk Alert</th>
              <th className="px-5 py-3 font-medium text-right">Needed</th>
              <th className="px-5 py-3 font-medium text-right">Filled</th>
              <th className="px-5 py-3 font-medium text-right">Gap</th>
              <th className="px-5 py-3 font-medium w-28">Progress</th>
              <th className="px-5 py-3 font-medium text-right w-12">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRequirements.map((req) => {
              const assignedRecruiter = recruiters.find((r) => r.id === req.recruiterId);

              const fillPct =
                req.headcountNeeded > 0
                  ? Math.min(100, (req.filled / req.headcountNeeded) * 100)
                  : 0;

              return (
                <tr
                  key={req.id}
                  className="transition-colors hover:bg-muted/30 group cursor-pointer"
                  onClick={() => setDrill(req.id)}
                >
                  {/* Client & Project */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <ClientLogo name={req.client?.name ?? "?"} size="md" />
                      <div>
                        <div className="font-semibold text-foreground">{req.client?.name ?? "Client"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {req.title} {req.projectName ? `· ${req.projectName}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Language — Service Pair */}
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/12 px-2.5 py-1 text-xs font-semibold text-accent">
                      {req.language} — {req.service}
                    </span>
                  </td>

                  {/* Assigned Recruiter Column */}
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={req.recruiterId || "unassigned"}
                      onValueChange={(val) => {
                        const nextId = val === "unassigned" ? null : val;
                        const recName = recruiters.find((r) => r.id === val)?.name;
                        assignMutation.mutate(
                          { id: req.id, recruiterId: nextId },
                          {
                            onSuccess: () => {
                              if (nextId) {
                                toast.success(`Assigned ${req.title} to ${recName}`);
                              } else {
                                toast.info(`Unassigned ${req.title}`);
                              }
                            },
                          },
                        );
                      }}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs bg-card">
                        <SelectValue placeholder="Assign recruiter">
                          {assignedRecruiter ? (
                            <span className="flex items-center gap-1.5 font-medium">
                              <span
                                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
                                style={{ background: `oklch(0.55 0.18 ${hueFromId(assignedRecruiter.id)}deg)` }}
                              >
                                {assignedRecruiter.name[0]}
                              </span>
                              <span className="truncate">{assignedRecruiter.name}</span>
                            </span>
                          ) : req.recruiter?.name ? (
                            <span className="truncate font-medium">{req.recruiter.name}</span>
                          ) : (
                            <span className="flex items-center gap-1 text-warning font-medium">
                              <AlertCircle className="h-3 w-3" /> Unassigned
                            </span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">
                          <span className="font-semibold text-warning">Unassigned</span>
                        </SelectItem>
                        {recruiters.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            <div className="flex items-center gap-2">
                              <span
                                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
                                style={{ background: `oklch(0.55 0.18 ${hueFromId(r.id)}deg)` }}
                              >
                                {r.name[0]}
                              </span>
                              <span className="font-medium">{r.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>

                  {/* Priority */}
                  <td className="px-5 py-3.5">
                    <PriorityPill priority={req.priority} />
                  </td>

                  {/* Due Date & Auto-Alert Column */}
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    {req.deadline ? (() => {
                      const today = new Date("2026-08-10T00:00:00Z");
                      const dlDate = new Date(`${req.deadline}T00:00:00Z`);
                      const daysLeft = Math.ceil((dlDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      const isAtRisk = req.gap > 0 && daysLeft <= 14;
                      const confirmedStr = req.filled === 0
                        ? `0 ${req.language} resources confirmed`
                        : `only ${req.filled} of ${req.headcountNeeded} ${req.language} confirmed`;
                      const riskReason = `${req.client?.name ?? "Client"} due in ${daysLeft} days, ${confirmedStr}`;

                      return (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="date"
                              value={req.deadline.slice(0, 10)}
                              onChange={(e) => {
                                updateDeadlineMutation.mutate(
                                  { id: req.id, deadline: e.target.value },
                                  { onSuccess: () => toast.success(`Updated target due date for ${req.title}`) },
                                );
                              }}
                              className="h-7 w-32 text-[11px] bg-card border-border/80 px-1.5"
                            />
                            {isAtRisk && (
                              <span
                                title={riskReason}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                                  daysLeft <= 3 ? "bg-destructive/15 text-destructive border border-destructive/30" : "bg-warning/15 text-warning border border-warning/30"
                                }`}
                              >
                                <Clock className="h-3 w-3" /> {daysLeft <= 0 ? "Due today" : `${daysLeft}d left`}
                              </span>
                            )}
                          </div>
                          {isAtRisk && (
                            <div className="text-[10px] text-destructive font-medium leading-tight max-w-[210px] truncate" title={riskReason}>
                              ⚠️ {riskReason}
                            </div>
                          )}
                        </div>
                      );
                    })() : (
                      <Input
                        type="date"
                        onChange={(e) => {
                          if (e.target.value) {
                            updateDeadlineMutation.mutate(
                              { id: req.id, deadline: e.target.value },
                              { onSuccess: () => toast.success(`Set target due date for ${req.title}`) },
                            );
                          }
                        }}
                        className="h-7 w-32 text-[11px] bg-card border-border/80 px-1.5 text-muted-foreground"
                      />
                    )}
                  </td>

                  {/* Headcount metrics */}
                  <td className="px-5 py-3.5 text-right tabular-nums text-foreground font-medium">
                    {req.headcountNeeded}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-foreground font-medium">
                    {req.filled}
                  </td>
                  <td
                    className={`px-5 py-3.5 text-right tabular-nums font-semibold ${
                      req.gap > 3 ? "text-warning" : req.gap > 0 ? "text-foreground" : "text-accent"
                    }`}
                  >
                    {req.gap}
                  </td>

                  {/* Fill progress bar */}
                  <td className="px-5 py-3.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${
                          fillPct === 100 ? "bg-accent" : fillPct > 50 ? "bg-primary" : "bg-warning"
                        }`}
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                  </td>

                  {/* Detail Arrow */}
                  <td className="px-5 py-3.5 text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors ml-auto" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {reqLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">Loading requirements…</p>
          </div>
        )}

        {!reqLoading && reqError && (
          <div className="flex flex-col items-center justify-center py-16 text-destructive">
            <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">{(reqError as any)?.message || "Failed to load requirements"}</p>
          </div>
        )}

        {!reqLoading && !reqError && filteredRequirements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No requirements match the current filters</p>
          </div>
        )}
      </div>

      {/* Requirement Detail Side Sheet */}
      <Sheet open={!!activeReq} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-auto">
          {activeReq && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <ClientLogo name={activeReq.client?.name ?? "?"} size="lg" />
                  <div>
                    <SheetTitle className="text-left">{activeReq.title}</SheetTitle>
                    <p className="text-xs text-muted-foreground">
                      {activeReq.client?.name ?? "Client"} · {activeReq.language} — {activeReq.service}
                    </p>
                  </div>
                </div>
              </SheetHeader>

              {/* Headcount tiles */}
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Tile label="Needed" value={activeReq.headcountNeeded} />
                <Tile label="Filled" value={activeReq.filled} tone="ok" />
                <Tile
                  label="Gap"
                  value={activeReq.gap}
                  tone={activeReq.gap > 3 ? "warn" : activeReq.gap > 0 ? "muted" : "ok"}
                />
              </div>

              {/* Meta information */}
              <dl className="mt-4 grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
                <dt className="text-muted-foreground">Language Pair</dt>
                <dd className="font-semibold text-accent">{activeReq.language} — {activeReq.service}</dd>
                <dt className="text-muted-foreground">Assigned Recruiter</dt>
                <dd className="font-medium">
                  {activeReq.recruiter?.name ?? <span className="text-warning">Unassigned</span>}
                </dd>
                <dt className="text-muted-foreground">Priority</dt>
                <dd><PriorityPill priority={activeReq.priority} /></dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd><StatusBadge status={activeReq.status} /></dd>
                {activeReq.deadline && (
                  <>
                    <dt className="text-muted-foreground">Deadline</dt>
                    <dd className="font-medium tabular-nums">
                      {new Date(activeReq.deadline).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </dd>
                  </>
                )}
              </dl>

              {/* Matching Candidate Pool */}
              <h3 className="mt-6 text-sm font-semibold">Matching Candidate Pool</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Top candidates matching {activeReq.language}.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {activeLeads.map((l) => (
                  <LeadCard key={l.id} lead={l} recruiters={recruiters} compact />
                ))}
              </div>

              {/* Current Assignment — no full history endpoint exists yet server-side,
                  so we surface only the current assignment rather than fabricate a log. */}
              {activeReq.recruiterId && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <History className="h-4 w-4 text-muted-foreground" /> Current Assignment
                  </h3>
                  <div className="mt-2 rounded-xl border border-border bg-muted/20 p-3 text-xs">
                    <div className="flex justify-between items-center text-[11px]">
                      <span>
                        <strong className="text-foreground">{activeReq.recruiter?.name ?? "Recruiter"}</strong> currently assigned
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {new Date(activeReq.createdAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Recruiter - Language Dynamic Configuration Modal */}
      <RecruiterLanguageMappingDialog
        open={showMappingModal}
        onOpenChange={setShowMappingModal}
      />
    </div>
  );
}

// ─── Small helper components ─────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  tone,
  subtext,
}: {
  label: string;
  value: number;
  tone: "muted" | "warn" | "ok" | "info";
  subtext: string;
}) {
  const color = {
    muted: "text-foreground",
    warn: "text-warning",
    ok: "text-accent",
    info: "text-primary",
  }[tone];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{subtext}</div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "text-accent" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function PriorityPill({ priority }: { priority: ApiRequirement["priority"] }) {
  const map: Record<string, string> = {
    CRITICAL: "bg-destructive/15 text-destructive",
    HIGH: "bg-warning/15 text-warning",
    STANDARD: "bg-muted text-muted-foreground",
  };
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${map[priority]}`}>{titleCase(priority)}</span>;
}

function StatusBadge({ status }: { status: ApiRequirement["status"] }) {
  const map: Record<string, string> = {
    UNASSIGNED: "bg-warning/15 text-warning",
    ACTIVE: "bg-accent/15 text-accent",
    FULFILLED: "bg-[oklch(0.62_0.14_155)]/15 text-[oklch(0.42_0.14_155)]",
    PAUSED: "bg-muted text-muted-foreground",
  };
  const icons: Record<string, typeof AlertCircle> = {
    UNASSIGNED: AlertCircle,
    ACTIVE: Clock,
    FULFILLED: CheckCircle2,
    PAUSED: Clock,
  };
  const Icon = icons[status] ?? Clock;
  return (
    <span className={`flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${map[status]}`}>
      <Icon className="h-3 w-3" /> {titleCase(status)}
    </span>
  );
}
