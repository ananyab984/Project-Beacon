import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiRequirement } from "@/lib/api-types";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserCheck, AlertCircle, Clock, CheckCircle2, Globe, Building2, Lock } from "lucide-react";
import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LeadCard } from "@/components/features/lead-card";
import { ClientLogo } from "@/components/features/client-logo";
import { useAuth } from "@/lib/auth";

// The contractor's counterpart to recruiter.clients.tsx -- same Clients &
// Market Demand shape, scoped two ways:
//
//  1. Client identity is theirs only. GET /api/requirements strips `client`
//     AND `clientId` from every requirement NOT assigned to this contractor
//     (redactClientUnlessAssigned), so "My Clients" carries real client names
//     while "All Market Demand" stays anonymised demand. That's enforced
//     server-side -- this page renders what it's given and never assumes a
//     client is present.
//  2. The candidate-pool drill-down reads the contractor's own leads
//     (GET /api/leads/mine), never the Global Leads pool.
//
// Deliberately a separate file rather than a shared extraction of
// recruiter.clients.tsx, which also owns Client CRUD and the global client
// roster -- a contractor must never reach either.
export const Route = createFileRoute("/contractor/clients")({
  head: () => ({
    meta: [
      { title: "Clients & Market Demand — Global3 Contractor" },
      { name: "description", content: "Your assigned clients and company-wide market demand." },
    ],
  }),
  component: ContractorClientsPage,
});

function titleCase(s: string): string {
  return s.length ? s[0] + s.slice(1).toLowerCase() : s;
}

function ContractorClientsPage() {
  const { user } = useAuth();

  const { data: allReqData } = useQuery({
    queryKey: ["requirements", "all"],
    queryFn: () => api.getRequirements(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const allRequirements = allReqData?.requirements ?? [];

  const { data: myLeadsData } = useQuery({ queryKey: ["leads", "mine"], queryFn: () => api.getMyLeads() });
  const myLeads = myLeadsData?.leads ?? [];

  const [viewTab, setViewTab] = useState<"assigned" | "all">("assigned");
  const [q, setQ] = useState("");
  const [selectedClientFilter, setSelectedClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drill, setDrill] = useState<string | null>(null);

  const myRequirements = useMemo(
    () => allRequirements.filter((r) => r.recruiterId === user?.id),
    [allRequirements, user],
  );

  // There is no contractor-visible client roster (GET /api/clients is
  // owner/recruiter only, by design), so the filter is built from the clients
  // that actually came back on their own requirements -- which is exactly
  // "their clients".
  const myClients = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of myRequirements) {
      if (r.clientId && r.client?.name) byId.set(r.clientId, r.client.name);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [myRequirements]);

  const filteredRequirements = useMemo(() => {
    const base = viewTab === "assigned" ? myRequirements : allRequirements;
    return base
      .filter((r) => {
        const clientName = r.client?.name ?? "";
        const matchQ =
          q === "" ||
          r.title.toLowerCase().includes(q.toLowerCase()) ||
          r.language.toLowerCase().includes(q.toLowerCase()) ||
          r.service.toLowerCase().includes(q.toLowerCase()) ||
          clientName.toLowerCase().includes(q.toLowerCase());

        // Only meaningful on the assigned tab -- a redacted row has no
        // clientId at all, so it can never match a specific client.
        const matchClient = selectedClientFilter === "all" || r.clientId === selectedClientFilter;
        const matchStatus = statusFilter === "all" || r.status === statusFilter;
        return matchQ && matchClient && matchStatus;
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [viewTab, myRequirements, allRequirements, q, selectedClientFilter, statusFilter]);

  const activeReq = allRequirements.find((r) => r.id === drill);
  const coveringLeads = useMemo(
    () => (activeReq ? myLeads.filter((l) => l.targetLanguage === activeReq.language).slice(0, 6) : []),
    [activeReq, myLeads],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header & View Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Clients & Market Demand</h2>
          <p className="text-xs text-muted-foreground">
            The clients you're assigned to, plus company-wide open demand by language and service.
          </p>
        </div>

        <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
          <button
            onClick={() => setViewTab("assigned")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              viewTab === "assigned" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UserCheck className="h-3.5 w-3.5 text-primary" />
            My Clients ({myRequirements.length})
          </button>
          <button
            onClick={() => {
              setViewTab("all");
              // A client filter can't apply to anonymised demand -- leaving it
              // set would silently render an empty table.
              setSelectedClientFilter("all");
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              viewTab === "all" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
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
            placeholder="Filter by client, title, language, service…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9 h-8 text-xs bg-card"
          />
        </div>
        {viewTab === "assigned" && (
          <Select value={selectedClientFilter} onValueChange={setSelectedClientFilter}>
            <SelectTrigger className="w-44 h-8 text-xs bg-card">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">My Clients ({myClients.length})</SelectItem>
              {myClients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs bg-card">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="FULFILLED">Fulfilled</SelectItem>
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
              <th className="px-5 py-3 font-medium">Assigned To</th>
              <th className="px-5 py-3 font-medium">Priority</th>
              <th className="px-5 py-3 font-medium">Due Date</th>
              <th className="px-5 py-3 font-medium text-right">Needed</th>
              <th className="px-5 py-3 font-medium text-right">Filled</th>
              <th className="px-5 py-3 font-medium text-right">Gap</th>
              <th className="px-5 py-3 font-medium w-28">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRequirements.map((req) => {
              const isMine = req.recruiterId === user?.id;
              const pct = req.headcountNeeded > 0 ? Math.min(100, (req.filled / req.headcountNeeded) * 100) : 0;

              return (
                <tr
                  key={req.id}
                  onClick={() => setDrill(req.id)}
                  className={`cursor-pointer transition-colors hover:bg-muted/40 ${isMine ? "bg-primary/3" : ""}`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      {req.client?.name ? (
                        <ClientLogo name={req.client.name} size="md" />
                      ) : (
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                          title="Client identity is only shown on requirements assigned to you"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-foreground">
                          {req.client?.name ?? <span className="text-muted-foreground italic">Confidential</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {req.title}
                          {req.projectName ? ` · ${req.projectName}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/12 px-2.5 py-1 text-xs font-semibold text-accent">
                      {req.language} — {req.service}
                    </span>
                  </td>

                  <td className="px-5 py-3.5">
                    {req.recruiter?.name ? (
                      <span className="text-xs font-medium text-foreground">
                        {req.recruiter.name}
                        {isMine && <span className="ml-1 text-[10px] text-primary font-semibold">(You)</span>}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-warning">
                        <AlertCircle className="h-3 w-3" /> Unassigned
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3.5">
                    <PriorityPill priority={req.priority} />
                  </td>

                  <td className="px-5 py-3.5">
                    {req.deadline ? (
                      <span className="text-xs font-medium text-foreground tabular-nums">
                        {new Date(req.deadline).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No due date</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-foreground font-medium">{req.headcountNeeded}</td>
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
            <p className="text-sm">
              {viewTab === "assigned"
                ? "You're not assigned to any client requirements yet"
                : "No requirements match the current filters"}
            </p>
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
                  {activeReq.client?.name && <ClientLogo name={activeReq.client.name} size="lg" />}
                  <div>
                    <SheetTitle className="text-left">{activeReq.title}</SheetTitle>
                    <p className="text-xs text-muted-foreground">
                      {activeReq.client?.name ? `${activeReq.client.name} · ` : ""}
                      {activeReq.language} — {activeReq.service}
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <Tile label="Needed" value={activeReq.headcountNeeded} />
                <Tile label="Filled" value={activeReq.filled} tone="ok" />
                <Tile
                  label="Gap"
                  value={activeReq.gap}
                  tone={activeReq.gap > 3 ? "warn" : activeReq.gap > 0 ? "muted" : "ok"}
                />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-medium">
                  {activeReq.client?.name ?? (
                    <span className="flex items-center gap-1 text-muted-foreground italic">
                      <Lock className="h-3 w-3" /> Shown once you're assigned
                    </span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Assigned To</dt>
                <dd className="font-medium">
                  {activeReq.recruiter?.name ? (
                    <span className="flex items-center gap-1.5">
                      {activeReq.recruiter.name}
                      {activeReq.recruiterId === user?.id && (
                        <span className="text-[10px] text-primary font-semibold">(You)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-warning">Unassigned</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Priority</dt>
                <dd>
                  <PriorityPill priority={activeReq.priority} />
                </dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge status={activeReq.status} />
                </dd>
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

              <h3 className="mt-6 text-sm font-semibold">Matching Leads (yours)</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {coveringLeads.map((l) => (
                  <LeadCard key={l.id} lead={l} compact />
                ))}
                {coveringLeads.length === 0 && (
                  <p className="text-xs text-muted-foreground">None of your submitted leads match this language yet.</p>
                )}
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
