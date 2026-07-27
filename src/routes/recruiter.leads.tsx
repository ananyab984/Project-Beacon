import { createFileRoute } from "@tanstack/react-router";
import { leads, recruiters, stageOrder, setLeadStage, useLeadStage, type Stage } from "@/lib/g3-mock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, ArrowUpDown, Upload, Download, Mail, UserPlus, X, Activity, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ManualEnrichmentDialog, type LeadForEnrichment } from "@/components/g3/manual-enrichment-dialog";

export const Route = createFileRoute("/recruiter/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Global3 Recruiter" },
      { name: "description", content: "CRM-style lead management for recruiters: global vs my leads, filters, bulk actions." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    scope: (s.scope === "mine" ? "mine" : "global") as Scope,
  }),
  component: LeadsPage,
});

// Treat one global recruiter as "me" so the My Leads toggle has data.
const CURRENT_GLOBAL_RECRUITER_ID = "r1";

const languageCountry: Record<string, string> = {
  French: "France", Japanese: "Japan", German: "Germany", Korean: "South Korea",
  "Spanish (LatAm)": "Mexico", Arabic: "UAE", Mandarin: "China",
  "Portuguese (BR)": "Brazil", Italian: "Italy", Dutch: "Netherlands",
};

type SortKey = "lead" | "language" | "country" | "stage" | "recruiter" | "activity";
type Scope = "global" | "mine";

function LeadsPage() {
  const initialScope = Route.useSearch().scope;
  const [scope, setScope] = useState<Scope>(initialScope);
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
  const [version, setVersion] = useState(0); // force rerender on lead enrichment
  const pageSize = 12;

  // Global Leads shows ONLY enriched leads. My Leads shows recruiter's leads including On Hold items.
  const globalEnrichedLeads = useMemo(
    () => leads.filter((l) => l.identity_resolved && !l.flags.includes("On Hold")),
    [version]
  );
  const scoped = useMemo(
    () => (scope === "mine" ? leads.filter((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID) : globalEnrichedLeads),
    [scope, version, globalEnrichedLeads],
  );
  const mineCount = useMemo(() => leads.filter((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID).length, [version]);
  const onHoldCount = useMemo(
    () => leads.filter((l) => l.recruiter_id === CURRENT_GLOBAL_RECRUITER_ID && (!l.identity_resolved || l.flags.includes("On Hold"))).length,
    [version]
  );

  const languages = useMemo(() => Array.from(new Set(leads.map((l) => l.language))), []);
  const services = useMemo(() => Array.from(new Set(leads.flatMap((l) => l.services))), []);
  const countries = useMemo(() => Array.from(new Set(leads.map((l) => languageCountry[l.language] ?? "—"))), []);

  const filtered = useMemo(() => {
    const rows = scoped.filter((l) => {
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
  }, [scoped, q, lang, country, service, rec, stage, dateRange, sortBy, sortDir]);

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
    const targetLead = leads.find((x) => x.id === id);
    if (targetLead) {
      targetLead.identity_resolved = true;
      targetLead.display_name = updated.name || targetLead.display_name || "Enriched Lead";
      targetLead.flags = targetLead.flags.filter((f) => f !== "On Hold");
      if (updated.services?.length) targetLead.services = updated.services;
      if (updated.target_language) targetLead.language = updated.target_language;
    }
    setVersion((v) => v + 1);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* On Hold Notification Alert Banner */}
      {scope === "mine" && onHoldCount > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-amber-100">
              <strong className="font-semibold text-amber-300">{onHoldCount} lead{onHoldCount > 1 ? "s" : ""} require manual enrichment.</strong>{" "}
              <span className="text-amber-200/90">Please review missing candidate details to promote {onHoldCount > 1 ? "them" : "it"} to Global Leads.</span>
            </span>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 text-black font-semibold hover:bg-amber-400 border-none shrink-0 shadow-sm"
            onClick={() => {
              const firstOnHold = scoped.find((l) => !l.identity_resolved || l.flags.includes("On Hold"));
              if (firstOnHold) {
                setEnrichLead({
                  id: firstOnHold.id,
                  name: firstOnHold.display_name ?? firstOnHold.masked_label,
                  language: firstOnHold.language,
                  services: firstOnHold.services,
                });
              }
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
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <BulkUploadDialog />
          {/* Toggle replaces owner's Export slot */}
          <div role="tablist" aria-label="Lead scope" className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <ScopeTab active={scope === "global"} onClick={() => { setScope("global"); setPage(1); setSelected(new Set()); }} label="Global Leads" count={globalEnrichedLeads.length} />
            <ScopeTab active={scope === "mine"} onClick={() => { setScope("mine"); setPage(1); setSelected(new Set()); }} label="My Leads" count={mineCount} />
          </div>
        </div>
      </div>

      {/* Filters */}
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
            <Button variant="outline" size="sm" onClick={() => toast.success(`Claiming ${selected.size} leads…`)}>
              <UserPlus className="h-3.5 w-3.5" /> Claim
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
                <th className="px-4 py-3 font-semibold text-foreground">Lead Enrichment Status</th>
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
                          className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2.5 py-0.5 text-[11px] font-semibold text-warning border border-warning/30 hover:bg-warning/25 transition-colors cursor-pointer"
                        >
                          🟡 On Hold
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent border border-accent/30">
                          🟢 Enriched
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
                      {scope === "mine" ? (
                        <StageCell id={l.id} initial={l.stage} />
                      ) : (
                        <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                          {l.stage}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{l.availability}</td>
                    <td className="px-4 py-3 text-foreground/80">{l.source}</td>
                    <td className="px-4 py-3 text-foreground/80">{r?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {scope === "mine" ? (
                        <ActivityCell lead={l} recruiterName={r?.name ?? "—"} />
                      ) : (
                        <span className="text-muted-foreground">{l.last_activity}</span>
                      )}
                    </td>
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
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>{count}</span>
    </button>
  );
}

function StageCell({ id, initial }: { id: string; initial: Stage }) {
  const value = useLeadStage(id, initial);
  return (
    <Select value={value} onValueChange={(v) => setLeadStage(id, v as Stage)}>
      <SelectTrigger className="h-7 w-[135px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {stageOrder.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type ActivityEvent = { at: string; icon: string; title: string; detail?: string };

function buildTimeline(lead: (typeof leads)[number], recruiterName: string): ActivityEvent[] {
  const currentIdx = stageOrder.indexOf(lead.stage);
  const stageIcons: Record<string, string> = {
    New: "🟦", Contacted: "📤", Replied: "💬", Negotiating: "🤝",
    "Invite Sent": "📧", Onboarded: "✅", Cold: "❄️",
  };
  const stageDetail: Record<string, string> = {
    New: `Sourced via ${lead.source}. Assigned to ${recruiterName}.`,
    Contacted: `Outreach sent by ${recruiterName} on ${lead.source === "LinkedIn" ? "LinkedIn" : "Email"}.`,
    Replied: "Candidate replied — thread active.",
    Negotiating: "Rate & availability under discussion.",
    "Invite Sent": "Onboarding invite delivered.",
    Onboarded: "Contract signed. Added to roster.",
    Cold: "No reply after 3 nudges. Marked cold.",
  };
  const buckets = ["14d ago", "9d ago", "5d ago", "3d ago", "2d ago", "1d ago", lead.last_activity];
  const events: ActivityEvent[] = [];
  const upto = currentIdx === -1 ? stageOrder.length - 1 : currentIdx;
  for (let i = 0; i <= upto; i++) {
    const stage = stageOrder[i];
    events.push({
      at: i === upto ? lead.last_activity : buckets[i] ?? `${(upto - i) * 2}d ago`,
      icon: stageIcons[stage] ?? "•",
      title: `Stage → ${stage}`,
      detail: stageDetail[stage],
    });
  }
  if (lead.verified_email) {
    events.push({ at: lead.last_activity, icon: "✔︎", title: "Email verified", detail: "Deliverability check passed." });
  }
  if (lead.confirmed_language_pair) {
    events.push({ at: lead.last_activity, icon: "🌐", title: "Language pair confirmed", detail: `${lead.language} verified.` });
  }
  if (lead.flags?.length) {
    events.push({ at: lead.last_activity, icon: "🚩", title: "Flags applied", detail: lead.flags.join(", ") });
  }
  return events.reverse();
}

function ActivityCell({ lead, recruiterName }: { lead: (typeof leads)[number]; recruiterName: string }) {
  const [open, setOpen] = useState(false);
  const timeline = useMemo(() => buildTimeline(lead, recruiterName), [lead, recruiterName]);
  const label = lead.identity_resolved ? lead.display_name ?? lead.masked_label : lead.masked_label;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
        >
          <Clock className="h-3 w-3" />
          {lead.last_activity}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Activity — {label}
          </DialogTitle>
          <DialogDescription>
            Full timeline of interactions, stage changes, and enrichment events.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <ol className="relative space-y-4 border-l border-border pl-5">
            {timeline.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">
                  {e.icon}
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">{e.title}</div>
                  <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{e.at}</div>
                </div>
                {e.detail && <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>}
              </li>
            ))}
          </ol>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  }
}

function matchesDate(activity: string, r: string) {
  const m = activity.match(/^(\d+)([mhd])/);
  if (!m) return true;
  const n = parseInt(m[1]);
  const unit = m[2];
  const hours = unit === "m" ? n / 60 : unit === "h" ? n : n * 24;
  if (r === "24h") return hours <= 24;
  if (r === "7d") return hours <= 24 * 7;
  if (r === "30d") return hours <= 24 * 30;
  return true;
}

function SortableTh({
  label, k, sortBy, sortDir, onClick,
}: { label: string; k: SortKey; sortBy: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void }) {
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
  value, onChange, placeholder, options, labelFor,
}: { value: string; onChange: (v: string) => void; placeholder: string; options: string[]; labelFor?: (v: string) => string }) {
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

function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  function downloadTemplate() {
    const headers = [
      "Reachout Date", "First Name", "Full Name",
      "Country of Residence", "Source", "Profile_Link", "Contact Number",
      "Email Address", "Services", "Source_Language", "Target_Language", "Secondary_Languages",
    ];
    const csv = headers.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "leads_template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function submit() {
    if (!file) { toast.error("Choose a CSV or Excel file first"); return; }
    toast.success(`Uploading ${file.name}. You'll be notified when processing finishes.`);
    setOpen(false); setFile(null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-3.5 w-3.5" /> Bulk Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk upload leads</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file matching the SEARCH schema. Duplicates are auto-flagged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <button
            onClick={downloadTemplate}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className="flex items-center gap-2"><Download className="h-3.5 w-3.5" /> Download sample template</span>
            <span className="text-[11px] text-muted-foreground">.csv</span>
          </button>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">File</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            {file && <div className="mt-1 text-[11px] text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(1)} KB</div>}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={submit}>Upload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
