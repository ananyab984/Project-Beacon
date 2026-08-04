import { createFileRoute } from "@tanstack/react-router";
import {
  useClients,
  useRequirements,
  useRecruiterLanguageMappings,
  useRecruiters,
  assignRequirementRecruiter,
  leads,
  type Requirement,
} from "@/lib/g3-mock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus,
  Search,
  Users,
  AlertCircle,
  Clock,
  CheckCircle2,
  ChevronRight,
  History,
  UserCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClientLogo } from "@/components/g3/client-logo";
import { LeadCard } from "@/components/g3/lead-card";
import { RecruiterLanguageMappingDialog } from "@/components/g3/recruiter-language-mapping-dialog";
import { openClientDemand } from "@/components/g3/client-demand-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/clients")({
  head: () => ({
    meta: [
      { title: "Clients & Market Demand — Global3" },
      { name: "description", content: "Tabular client requirement management with dynamic recruiter assignments." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const clients = useClients();
  const allRequirements = useRequirements();
  const recruiters = useRecruiters();

  const [q, setQ] = useState("");
  const [selectedClient, setSelectedClient] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  
  const [drill, setDrill] = useState<string | null>(null);
  const [showMappingModal, setShowMappingModal] = useState(false);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c])),
    [clients],
  );

  // Filter requirements
  const filteredRequirements = useMemo(() => {
    return allRequirements.filter((r) => {
      const clientName = clientMap[r.client_id]?.name ?? "";
      const matchQ =
        q === "" ||
        r.title.toLowerCase().includes(q.toLowerCase()) ||
        r.language.toLowerCase().includes(q.toLowerCase()) ||
        r.service.toLowerCase().includes(q.toLowerCase()) ||
        clientName.toLowerCase().includes(q.toLowerCase()) ||
        (r.project_name ?? "").toLowerCase().includes(q.toLowerCase());

      const matchClient = selectedClient === "all" || r.client_id === selectedClient;
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      const matchPriority = priorityFilter === "all" || r.priority === priorityFilter;

      return matchQ && matchClient && matchStatus && matchPriority;
    }).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [allRequirements, clientMap, q, selectedClient, statusFilter, priorityFilter]);

  // Overall metrics
  const totalReqs = allRequirements.length;
  const unassignedReqs = allRequirements.filter((r) => !r.recruiter_id).length;
  const activeReqs = allRequirements.filter((r) => r.status === "active").length;
  const fulfilledReqs = allRequirements.filter((r) => r.status === "fulfilled").length;

  const activeReq = allRequirements.find((r) => r.id === drill);
  const activeClient = activeReq ? clientMap[activeReq.client_id] : null;
  const activeLeads = activeReq
    ? leads.filter((l) => l.language.toLowerCase().includes(activeReq.language.toLowerCase())).slice(0, 6)
    : [];

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
              <SelectItem value="unassigned">Unassigned</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-card">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
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
              <th className="px-5 py-3 font-medium text-right">Needed</th>
              <th className="px-5 py-3 font-medium text-right">Filled</th>
              <th className="px-5 py-3 font-medium text-right">Gap</th>
              <th className="px-5 py-3 font-medium w-28">Progress</th>
              <th className="px-5 py-3 font-medium text-right w-12">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRequirements.map((req) => {
              const client = clientMap[req.client_id];
              const assignedRecruiter = recruiters.find((r) => r.id === req.recruiter_id);

              const fillPct =
                req.headcount_needed > 0
                  ? Math.min(100, (req.filled / req.headcount_needed) * 100)
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
                      <ClientLogo name={client?.name ?? "?"} size="md" />
                      <div>
                        <div className="font-semibold text-foreground">{client?.name ?? "Client"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {req.title} {req.project_name ? `· ${req.project_name}` : ""}
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
                      value={req.recruiter_id || "unassigned"}
                      onValueChange={(val) => {
                        const nextId = val === "unassigned" ? undefined : val;
                        assignRequirementRecruiter(req.id, nextId);
                        const recName = recruiters.find((r) => r.id === val)?.name;
                        if (nextId) {
                          toast.success(`Assigned ${req.title} to ${recName}`);
                        } else {
                          toast.info(`Unassigned ${req.title}`);
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs bg-card">
                        <SelectValue placeholder="Assign recruiter">
                          {assignedRecruiter ? (
                            <span className="flex items-center gap-1.5 font-medium">
                              <span
                                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
                                style={{ background: `oklch(0.55 0.18 ${assignedRecruiter.avatar_hue}deg)` }}
                              >
                                {assignedRecruiter.name[0]}
                              </span>
                              <span className="truncate">{assignedRecruiter.name}</span>
                            </span>
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
                        {recruiters.filter(r => r.role !== "contractor").map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            <div className="flex items-center gap-2">
                              <span
                                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
                                style={{ background: `oklch(0.55 0.18 ${r.avatar_hue}deg)` }}
                              >
                                {r.name[0]}
                              </span>
                              <span className="font-medium">{r.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto">· {r.kpis.overall_score}%</span>
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

                  {/* Headcount metrics */}
                  <td className="px-5 py-3.5 text-right tabular-nums text-foreground font-medium">
                    {req.headcount_needed}
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

        {filteredRequirements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No requirements match the current filters</p>
          </div>
        )}
      </div>

      {/* Requirement Detail Side Sheet */}
      <Sheet open={!!activeReq} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-auto">
          {activeReq && activeClient && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <ClientLogo name={activeClient.name} size="lg" />
                  <div>
                    <SheetTitle className="text-left">{activeReq.title}</SheetTitle>
                    <p className="text-xs text-muted-foreground">
                      {activeClient.name} · {activeReq.language} — {activeReq.service}
                    </p>
                  </div>
                </div>
              </SheetHeader>

              {/* Headcount tiles */}
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Tile label="Needed" value={activeReq.headcount_needed} />
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
                  {recruiters.find(r => r.id === activeReq.recruiter_id)?.name ?? <span className="text-warning">Unassigned</span>}
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
                  <LeadCard key={l.id} lead={l} compact />
                ))}
              </div>

              {/* Assignment Audit History */}
              {activeReq.assignment_history.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <History className="h-4 w-4 text-muted-foreground" /> Assignment History
                  </h3>
                  <div className="mt-2 rounded-xl border border-border bg-muted/20 p-3 space-y-2 text-xs">
                    {[...activeReq.assignment_history].reverse().map((h, i) => {
                      const recName = recruiters.find((r) => r.id === h.recruiter_id)?.name ?? "Unknown";
                      return (
                        <div key={i} className="flex justify-between items-center text-[11px]">
                          <span>
                            <strong className="text-foreground">{recName}</strong> assigned by {h.assigned_by}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {new Date(h.assigned_at).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      );
                    })}
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

function PriorityPill({ priority }: { priority: Requirement["priority"] }) {
  const map = {
    critical: "bg-destructive/15 text-destructive",
    high: "bg-warning/15 text-warning",
    standard: "bg-muted text-muted-foreground",
  }[priority];
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${map}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: Requirement["status"] }) {
  const map: Record<string, string> = {
    unassigned: "bg-warning/15 text-warning",
    active: "bg-accent/15 text-accent",
    fulfilled: "bg-[oklch(0.62_0.14_155)]/15 text-[oklch(0.42_0.14_155)]",
    paused: "bg-muted text-muted-foreground",
  };
  const icons: Record<string, typeof AlertCircle> = {
    unassigned: AlertCircle,
    active: Clock,
    fulfilled: CheckCircle2,
    paused: Clock,
  };
  const Icon = icons[status] ?? Clock;
  return (
    <span className={`flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${map[status]}`}>
      <Icon className="h-3 w-3" /> {status}
    </span>
  );
}
