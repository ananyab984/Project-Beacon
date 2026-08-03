import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Sparkles, Zap, Mail, LinkedinIcon, BrainCircuit, CheckCircle2, XCircle, Loader2, Pause, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/pipelines")({
  head: () => ({
    meta: [
      { title: "AI Pipelines — Global3" },
      { name: "description", content: "Manage AI-assisted recruitment pipelines: identity match, reply classification, drafts, enrichment." },
    ],
  }),
  component: PipelinesPage,
});

type PipelineStatus = "active" | "inactive" | "running" | "failed";
type Pipeline = {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: PipelineStatus;
  enabled: boolean;
  runs_today: number;
  success_rate: number;
  last_run: string;
  category: "matching" | "outreach" | "enrichment";
};

const SEED: Pipeline[] = [
  { id: "p1", name: "LinkedIn Identity Match", description: "Answers 'who is this person?' — resolves ambiguous LinkedIn profiles, matches incoming candidates to existing records, and links multiple sources into one canonical identity to prevent duplicate leads.", icon: LinkedinIcon, status: "active", enabled: true, runs_today: 412, success_rate: 0.87, last_run: "2 min ago", category: "matching" },
  { id: "p2", name: "Reply Intent Classifier", description: "Tags inbound replies as Interested / FAQ / Not now / Decline.", icon: BrainCircuit, status: "running", enabled: true, runs_today: 156, success_rate: 0.62, last_run: "just now", category: "outreach" },
  { id: "p3", name: "Cold-Email Drafts", description: "Generates first-touch drafts scoped by language + service.", icon: Mail, status: "active", enabled: true, runs_today: 88, success_rate: 0.91, last_run: "8 min ago", category: "outreach" },
  { id: "p4", name: "Profile Enrichment", description: "Answers 'what else do we know?' — enriches an already-identified candidate with verified email, skills, language pairs, experience, resume metadata, employment history, headline, location, tech stack and profile completeness.", icon: Sparkles, status: "inactive", enabled: false, runs_today: 0, success_rate: 0.78, last_run: "yesterday", category: "enrichment" },
  { id: "p6", name: "Duplicate Detection", description: "Flags likely duplicates across sources before outreach.", icon: Zap, status: "active", enabled: true, runs_today: 27, success_rate: 0.95, last_run: "22 min ago", category: "matching" },
];

const STATUS_META: Record<PipelineStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  active:   { label: "Active",   className: "bg-success/15 text-success border-success/30",          icon: CheckCircle2 },
  running:  { label: "Running",  className: "bg-accent/15 text-accent border-accent/30",             icon: Loader2 },
  inactive: { label: "Inactive", className: "bg-muted text-muted-foreground border-border",         icon: Pause },
  failed:   { label: "Failed",   className: "bg-destructive/15 text-destructive border-destructive/40", icon: XCircle },
};

function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>(SEED);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => pipelines.filter(p =>
    (q === "" || p.name.toLowerCase().includes(q.toLowerCase())) &&
    (category === "all" || p.category === category)
  ), [pipelines, q, category]);

  const active = pipelines.find(p => p.id === selected) ?? null;

  const toggle = (id: string, next: boolean) => {
    setPipelines(prev => prev.map(p => p.id === id
      ? { ...p, enabled: next, status: next ? (p.status === "failed" ? "failed" : "active") : "inactive" }
      : p));
    const name = pipelines.find(p => p.id === id)?.name ?? "Pipeline";
    toast.success(`${name} ${next ? "enabled" : "disabled"}`);
  };

  const counts = useMemo(() => ({
    active: pipelines.filter(p => p.status === "active").length,
    running: pipelines.filter(p => p.status === "running").length,
    inactive: pipelines.filter(p => p.status === "inactive").length,
    failed: pipelines.filter(p => p.status === "failed").length,
  }), [pipelines]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-widest text-accent">AI Pipelines</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Automation control room</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Toggle, monitor and inspect the AI systems supporting recruiter workflows.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Active"   value={counts.active}   tone="success" />
        <SummaryCard label="Running"  value={counts.running}  tone="accent" />
        <SummaryCard label="Inactive" value={counts.inactive} tone="muted" />
        <SummaryCard label="Failed"   value={counts.failed}   tone="destructive" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search pipelines…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="matching">Matching</SelectItem>
            <SelectItem value="outreach">Outreach</SelectItem>
            <SelectItem value="enrichment">Enrichment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map(p => {
          const meta = STATUS_META[p.status];
          const StatusIcon = meta.icon;
          const Icon = p.icon;
          return (
            <div
              key={p.id}
              className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-widest text-muted-foreground">{p.category}</div>
                  </div>
                </div>
                <Switch checked={p.enabled} onCheckedChange={(v) => toggle(p.id, v)} aria-label={`Toggle ${p.name}`} />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">{p.description}</p>

              <div className="mt-4 flex items-center gap-2">
                <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                  <StatusIcon className={`h-3 w-3 ${p.status === "running" ? "animate-spin" : ""}`} />
                  {meta.label}
                </Badge>
                <span className="text-[11px] text-muted-foreground">Last run: {p.last_run}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
                <Stat label="Runs today" value={p.runs_today.toLocaleString()} />
                <Stat label="Success rate" value={`${Math.round(p.success_rate * 100)}%`} />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="mt-3 justify-between text-xs hover:bg-accent/10 hover:text-accent"
                onClick={() => setSelected(p.id)}
              >
                View details & logs <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-auto sm:max-w-xl">
          {active && (
            <>
              <SheetHeader>
                <SheetTitle>{active.name}</SheetTitle>
                <SheetDescription>{active.description}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div className="text-sm">Pipeline enabled</div>
                <Switch checked={active.enabled} onCheckedChange={(v) => toggle(active.id, v)} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Runs today" value={active.runs_today.toLocaleString()} boxed />
                <Stat label="Success rate" value={`${Math.round(active.success_rate * 100)}%`} boxed />
                <Stat label="Status" value={STATUS_META[active.status].label} boxed />
                <Stat label="Last run" value={active.last_run} boxed />
              </div>

              <h4 className="mt-6 text-sm font-semibold">Execution history</h4>
              <div className="mt-2 divide-y divide-border rounded-xl border border-border">
                {mockLogs(active).map((l, i) => (
                  <div key={i} className="grid grid-cols-[80px_90px_1fr] items-center gap-3 px-4 py-2 text-xs">
                    <span className="text-muted-foreground tabular-nums">{l.time}</span>
                    <span className={`rounded-md px-2 py-0.5 text-center text-[10px] font-semibold uppercase ${
                      l.status === "ok" ? "bg-success/15 text-success" :
                      l.status === "warn" ? "bg-warning/15 text-warning" :
                      "bg-destructive/15 text-destructive"
                    }`}>{l.status}</span>
                    <span className="text-foreground/80">{l.detail}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "success" | "accent" | "muted" | "destructive" }) {
  const styles = {
    success:     "text-success",
    accent:      "text-accent",
    muted:       "text-foreground",
    destructive: "text-destructive",
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${styles}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value, boxed }: { label: string; value: string; boxed?: boolean }) {
  return (
    <div className={boxed ? "rounded-lg border border-border bg-muted/30 p-3" : ""}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function mockLogs(p: Pipeline): { time: string; status: "ok" | "warn" | "err"; detail: string }[] {
  return [
    { time: "09:42", status: "ok",   detail: `Processed batch of 42 records (${p.category})` },
    { time: "09:12", status: "ok",   detail: "Enqueued 12 candidates for downstream classifier" },
    { time: "08:58", status: "warn", detail: "Low confidence on 4 items — flagged for review" },
    { time: "08:01", status: p.status === "failed" ? "err" : "ok", detail: p.status === "failed" ? "Upstream API returned 503 — retrying" : "Nightly refresh completed" },
    { time: "Yest.", status: "ok",   detail: "Model version pinned at v2.4.1" },
  ];
}