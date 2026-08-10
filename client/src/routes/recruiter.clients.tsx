import { createFileRoute } from "@tanstack/react-router";
import {
  useClients,
  useRequirements,
  useRecruiters,
  updateRequirementDeadline,
  leads,
  type Requirement,
} from "@/lib/g3-mock";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  UserCheck,
  AlertCircle,
  Clock,
  CheckCircle2,
  Globe,
  Building2,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LeadCard } from "@/components/features/lead-card";
import { ClientLogo } from "@/components/features/client-logo";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/recruiter/clients")({
  head: () => ({
    meta: [
      { title: "Clients & Market Demand — Global3 Recruiter" },
      { name: "description", content: "Tabular client requirement market demand." },
    ],
  }),
  component: RecruiterClientsPage,
});

function RecruiterClientsPage() {
  const { user } = useAuth();
  const allRequirements = useRequirements();
  const clients = useClients();
  const recruiters = useRecruiters();

  const [viewTab, setViewTab] = useState<"assigned" | "global">("assigned");
  const [q, setQ] = useState("");
  const [selectedClientFilter, setSelectedClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drill, setDrill] = useState<string | null>(null);

  // Find logged-in recruiter profile
  const myRecruiter = recruiters.find(
    (r) => r.name.toLowerCase() === (user?.name ?? "").toLowerCase(),
  ) ?? recruiters[0];

  const myRequirements = useMemo(
    () => allRequirements.filter((r) => r.recruiter_id === myRecruiter?.id),
    [allRequirements, myRecruiter],
  );

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c])),
    [clients],
  );

  const filteredRequirements = useMemo(() => {
    const base = viewTab === "assigned" ? myRequirements : allRequirements;
    return base.filter((r) => {
      const clientName = clientMap[r.client_id]?.name ?? "";
      const matchQ =
        q === "" ||
        r.title.toLowerCase().includes(q.toLowerCase()) ||
        r.language.toLowerCase().includes(q.toLowerCase()) ||
        r.service.toLowerCase().includes(q.toLowerCase()) ||
        clientName.toLowerCase().includes(q.toLowerCase());

      const matchClient = selectedClientFilter === "all" || r.client_id === selectedClientFilter;
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      return matchQ && matchClient && matchStatus;
    }).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [viewTab, myRequirements, allRequirements, q, selectedClientFilter, statusFilter, clientMap]);

  const activeReq = allRequirements.find((r) => r.id === drill);
  const activeClient = activeReq ? clientMap[activeReq.client_id] : null;
  const activeRecruiter = activeReq
    ? recruiters.find((r) => r.id === activeReq.recruiter_id)
    : null;
  const coveringLeads = activeReq
    ? leads.filter((l) => l.language.toLowerCase().includes(activeReq.language.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header & View Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Clients & Market Demand</h2>
          <p className="text-xs text-muted-foreground">
            Explore company-wide client requirements and view your assigned workflow.
          </p>
        </div>

        <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
          <button
            onClick={() => setViewTab("assigned")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              viewTab === "assigned"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UserCheck className="h-3.5 w-3.5 text-primary" />
            My Projects ({myRequirements.length})
          </button>
          <button
            onClick={() => setViewTab("global")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              viewTab === "global"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="h-3.5 w-3.5 text-accent" />
            All Market Demand ({allRequirements.length})
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by client, language, service…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9 h-8 text-xs bg-card"
          />
        </div>
        <Select value={selectedClientFilter} onValueChange={setSelectedClientFilter}>
          <SelectTrigger className="w-44 h-8 text-xs bg-card">
            <SelectValue placeholder="All clients" />
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
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabular View */}
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRequirements.map((req) => {
              const client = clientMap[req.client_id];
              const assigned = recruiters.find((r) => r.id === req.recruiter_id);
              const isMine = req.recruiter_id === myRecruiter?.id;

              const pct =
                req.headcount_needed > 0
                  ? Math.min(100, (req.filled / req.headcount_needed) * 100)
                  : 0;

              return (
                <tr
                  key={req.id}
                  onClick={() => setDrill(req.id)}
                  className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                    isMine ? "bg-primary/3" : ""
                  }`}
                >
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

                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/12 px-2.5 py-1 text-xs font-semibold text-accent">
                      {req.language} — {req.service}
                    </span>
                  </td>

                  {/* Assigned Recruiter */}
                  <td className="px-5 py-3.5">
                    {assigned ? (
                      <div className="flex items-center gap-1.5">
                        <div
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
                          style={{ background: `oklch(0.55 0.18 ${assigned.avatar_hue}deg)` }}
                        >
                          {assigned.name[0]}
                        </div>
                        <span className="text-xs font-medium text-foreground">
                          {assigned.name}
                          {isMine && <span className="ml-1 text-[10px] text-primary font-semibold">(You)</span>}
                        </span>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-warning">
                        <AlertCircle className="h-3 w-3" /> Unassigned
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3.5"><PriorityPill priority={req.priority} /></td>

                  {/* Due Date & Auto-Alert Column */}
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    {req.deadline ? (() => {
                      const today = new Date("2026-08-10T00:00:00Z");
                      const dlDate = new Date(`${req.deadline}T00:00:00Z`);
                      const daysLeft = Math.ceil((dlDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      const isAtRisk = req.gap > 0 && daysLeft <= 14;
                      const confirmedStr = req.filled === 0
                        ? `0 ${req.language} resources confirmed`
                        : `only ${req.filled} of ${req.headcount_needed} ${req.language} confirmed`;
                      const riskReason = `${client?.name ?? "Client"} due in ${daysLeft} days, ${confirmedStr}`;

                      return (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium text-foreground tabular-nums">
                              {new Date(req.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </span>
                            {isAtRisk && (
                              <span
                                title={riskReason}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                                  daysLeft <= 3 ? "bg-destructive/15 text-destructive border border-destructive/30" : "bg-warning/15 text-warning border border-warning/30"
                                }`}
                              >
                                {daysLeft <= 0 ? "Due today" : `${daysLeft}d left`}
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
                      <span className="text-xs text-muted-foreground italic">No due date</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-foreground font-medium">{req.headcount_needed}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-foreground font-medium">{req.filled}</td>
                  <td
                    className={`px-5 py-3.5 text-right tabular-nums font-semibold ${
                      req.gap > 3 ? "text-warning" : req.gap > 0 ? "text-foreground" : "text-accent"
                    }`}
                  >
                    {req.gap}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${pct === 100 ? "bg-accent" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredRequirements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Building2 className="h-8 w-8 mb-2 opacity-30" />
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

              <div className="mt-4 grid grid-cols-3 gap-3">
                <Tile label="Needed" value={activeReq.headcount_needed} />
                <Tile label="Filled" value={activeReq.filled} tone="ok" />
                <Tile
                  label="Gap"
                  value={activeReq.gap}
                  tone={activeReq.gap > 3 ? "warn" : activeReq.gap > 0 ? "muted" : "ok"}
                />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
                <dt className="text-muted-foreground">Assigned Recruiter</dt>
                <dd className="font-medium">
                  {activeRecruiter ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: `oklch(0.55 0.18 ${activeRecruiter.avatar_hue}deg)` }}
                      >
                        {activeRecruiter.name[0]}
                      </span>
                      {activeRecruiter.name}
                      {activeReq.recruiter_id === myRecruiter?.id && (
                        <span className="text-[10px] text-primary font-semibold">(You)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-warning">Unassigned</span>
                  )}
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

              <h3 className="mt-6 text-sm font-semibold">Matching Candidate Pool</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {coveringLeads.map((l) => (
                  <LeadCard key={l.id} lead={l} compact />
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
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
