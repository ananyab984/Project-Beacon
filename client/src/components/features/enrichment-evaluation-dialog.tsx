import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/features/kpi";
import { api } from "@/lib/api";
import type {
  ApiEnrichmentEvaluation,
  EnrichmentRunConclusion,
  EnrichmentRunOutcome,
  EnrichmentTier,
} from "@/lib/api-types";

const PLATFORM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All platforms" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "PROZ", label: "ProZ" },
  { value: "ADA", label: "Ada" },
  { value: "ATA", label: "ATA" },
  { value: "ATAA", label: "ATAA" },
  { value: "BODALGO", label: "Bodalgo" },
  { value: "FREELANCER", label: "Freelancer" },
  { value: "APOLLO", label: "Apollo" },
  // Leads whose profile link is not a host we recognize (lib/detectLeadSource.ts).
  // Without this they are enriched but unreachable from this dashboard.
  { value: "OTHER", label: "Other / unknown" },
];

const RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const RANGE_PHRASE: Record<string, string> = {
  "7d": "In the last 7 days",
  "30d": "In the last 30 days",
  "90d": "In the last 90 days",
  all: "Across all time",
};

const TIERS: EnrichmentTier[] = ["TIER_1", "TIER_2", "TIER_3"];
const TIER_INFO: Record<EnrichmentTier, { label: string; desc: string }> = {
  TIER_1: {
    label: "Tier 1 — profile scraper",
    desc: "Read straight from the lead's own profile page.",
  },
  TIER_2: { label: "Tier 2 — Parallel", desc: "Needed a structured research lookup." },
  TIER_3: { label: "Tier 3 — web search", desc: "Only found by searching the open web." },
};

/** Order, wording and colour for each outcome. "Enriched" is G3's rule:
 *  5+ of the 10 fields, or an email or a phone found (server runOutcome). */
const OUTCOMES: Array<{ key: EnrichmentRunOutcome; label: string; desc: string; bar: string }> = [
  {
    key: "ENRICHED",
    label: "Enriched",
    desc: "Filled 5 or more of the 10 fields, or found an email or a phone.",
    bar: "bg-accent",
  },
  {
    key: "PARTIALLY_ENRICHED",
    label: "Partially enriched",
    desc: "Found 1-4 fields, but no email or phone.",
    bar: "bg-success",
  },
  {
    key: "NOTHING_FOUND",
    label: "Nothing new found",
    desc: "Every source was tried; none added a field.",
    bar: "bg-muted-foreground/40",
  },
  {
    key: "TIMED_OUT",
    label: "Timed out",
    desc: "Stopped at the time limit before finishing.",
    bar: "bg-warning",
  },
  {
    key: "SYSTEM_ERROR",
    label: "System error",
    desc: "The enrichment service failed or couldn't be reached.",
    bar: "bg-destructive",
  },
];
const CONCLUSION_LABEL: Record<EnrichmentRunConclusion, string> = {
  SHORT_CIRCUIT_SUCCESS: "Found every critical field",
  EXHAUSTED_NO_MATCH: "Tried every source",
  TIMED_OUT: "Timed out",
  SYSTEM_ERROR: "System error",
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function EnrichmentEvaluationDialog({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [platform, setPlatform] = useState("all");
  const [range, setRange] = useState("30d");

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["enrichment-evaluation", platform, range],
    queryFn: () => api.getEnrichmentEvaluation(platform, range),
    enabled: open,
    // Fetched once on open and never again, so a run finishing while this
    // was open never showed up. Live while it's on screen.
    refetchInterval: open ? 30_000 : false,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enrichment Evaluation</DialogTitle>
          <DialogDescription>
            How well automatic enrichment is filling in your leads, computed live from every
            enrichment run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9 w-48 text-xs" aria-label="Platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORM_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-9 w-40 text-xs" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data && (
            <span className="ml-auto text-[11px] text-muted-foreground" aria-live="polite">
              {isFetching
                ? "Refreshing…"
                : `Updated ${new Date(data.computedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}{" "}
              · last run {fmtAgo(data.lastRunAt)}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {isError && (
          <div className="py-10 text-center text-sm text-destructive">
            Couldn't load enrichment analytics
            {(error as Error)?.message ? `: ${(error as Error).message}` : "."}
          </div>
        )}

        {data && data.totalRuns === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No enrichment runs {RANGE_PHRASE[range].toLowerCase()}
            {platform !== "all" ? " for this platform" : ""}.
            {data.lastRunAt && (
              <> The most recent run was {fmtAgo(data.lastRunAt)} — try a longer range.</>
            )}
          </div>
        )}

        {data && data.totalRuns > 0 && (
          <>
            <Summary data={data} range={range} />
            <Tabs defaultValue="overview" className="mt-1">
              <TabsList className="grid h-auto w-full grid-cols-5">
                <TabsTrigger value="overview" className="text-xs">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="outcomes" className="text-xs">
                  Outcomes
                </TabsTrigger>
                <TabsTrigger value="speed" className="text-xs">
                  Speed
                </TabsTrigger>
                <TabsTrigger value="sources" className="text-xs">
                  Sources
                </TabsTrigger>
                <TabsTrigger value="quality" className="text-xs">
                  Quality
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 pt-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <KpiTile
                    label="Runs"
                    value={data.totalRuns}
                    unit="score"
                    context={`${data.coverage.leadsWithRunInPeriod} lead${data.coverage.leadsWithRunInPeriod === 1 ? "" : "s"}`}
                  />
                  <KpiTile
                    label="Enriched"
                    value={data.enrichedPct}
                    tone={data.enrichedPct >= 60 ? "positive" : "warning"}
                    context="5+ fields, or an email/phone"
                  />
                  <KpiTile
                    label="Fields filled"
                    value={`${data.fieldCoverage.avgFields} / ${data.fieldCoverage.total}`}
                    context="average per run"
                  />
                  <KpiTile
                    label="Recruiter corrections"
                    value={data.manualOverrideRate}
                    context={`${data.leadsOverridden} of ${data.leadsEvaluated} leads`}
                  />
                </div>
                <Panel title="Coverage">
                  <p className="text-sm">
                    These numbers speak for <b>{data.coverage.leadsWithRunInPeriod}</b> of the{" "}
                    <b>{data.coverage.leadsInPool}</b> leads in your pool
                    {platform !== "all" ? " on this platform" : ""}.
                  </p>
                  {data.coverage.leadsInPool > data.coverage.leadsWithRunInPeriod && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {data.coverage.leadsInPool - data.coverage.leadsWithRunInPeriod === 1
                        ? "1 lead has"
                        : `${data.coverage.leadsInPool - data.coverage.leadsWithRunInPeriod} leads have`}{" "}
                      no enrichment run in this period. They were enriched earlier, before run
                      history was recorded, or not at all yet.
                    </p>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="outcomes" className="space-y-4 pt-3">
                <Panel title="How each run ended" desc="Every run lands in exactly one of these.">
                  <div
                    className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label="Share of runs by outcome"
                  >
                    {OUTCOMES.map(
                      (o) =>
                        data.outcomes[o.key].pct > 0 && (
                          <div
                            key={o.key}
                            className={o.bar}
                            style={{ width: `${data.outcomes[o.key].pct}%` }}
                            title={`${o.label}: ${data.outcomes[o.key].pct}%`}
                          />
                        ),
                    )}
                  </div>
                  <ul className="mt-4 space-y-3">
                    {OUTCOMES.map((o) => (
                      <li key={o.key} className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${o.bar}`}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="font-medium">{o.label}</span>
                            <span className="tabular-nums">
                              {data.outcomes[o.key].pct}%{" "}
                              <span className="text-xs text-muted-foreground">
                                ({data.outcomes[o.key].count})
                              </span>
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{o.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </TabsContent>

              <TabsContent value="speed" className="space-y-4 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <KpiTile label="Typical run (median)" value={fmtMs(data.timeTaken.medianMs)} />
                  <KpiTile
                    label="Average run"
                    value={fmtMs(data.timeTaken.avgMs)}
                    hint="Pulled up by a few slow runs when higher than the median."
                  />
                </div>
                <Panel
                  title="Time by how the run ended"
                  desc={`Each source gets up to ${fmtMs(data.timeTaken.referenceLines.perStepDeadlineMs)}; a whole lead is cut off at ${fmtMs(data.timeTaken.referenceLines.leadLevelCeilingMs)}.`}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-1 font-medium">Ended by</th>
                        <th className="pb-1 text-right font-medium">Median</th>
                        <th className="pb-1 text-right font-medium">Average</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(CONCLUSION_LABEL) as EnrichmentRunConclusion[])
                        .filter((c) => (data.timeTaken.byConclusion[c]?.avgMs ?? 0) > 0)
                        .map((c) => (
                          <tr key={c} className="border-t border-border">
                            <td className="py-1.5">{CONCLUSION_LABEL[c]}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {fmtMs(data.timeTaken.byConclusion[c].medianMs)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {fmtMs(data.timeTaken.byConclusion[c].avgMs)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </Panel>
              </TabsContent>

              <TabsContent value="sources" className="space-y-4 pt-3">
                <Panel
                  title="Which source did the work"
                  desc="For runs that found something: the deepest source that had to be used, and how many fields those runs filled."
                >
                  {TIERS.every((t) => data.tierAttribution[t] === 0) ? (
                    <p className="text-sm text-muted-foreground">
                      No run in this period found data from any source.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {TIERS.map((t) => (
                        <li key={t}>
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="font-medium">{TIER_INFO[t].label}</span>
                            <span className="tabular-nums">
                              {data.tierAttribution[t]}%{" "}
                              <span className="text-xs text-muted-foreground">
                                · {data.qualityByTier[t]} / {data.fieldCoverage.total} fields
                              </span>
                            </span>
                          </div>
                          <Bar
                            pct={data.tierAttribution[t]}
                            className="bg-primary"
                            label={`${TIER_INFO[t].label}: ${data.tierAttribution[t]}%`}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">{TIER_INFO[t].desc}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="quality" className="space-y-4 pt-3">
                <Panel
                  title="How much of each lead got filled"
                  desc={`Fields enrichment actually found, out of the ${data.fieldCoverage.total} shown on a lead. Data the lead already came with doesn't count.`}
                >
                  <ul className="space-y-3">
                    {data.fieldCoverage.buckets.map((b) => (
                      <li key={b.label}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span>{b.label}</span>
                          <span className="tabular-nums">
                            {b.pct}%{" "}
                            <span className="text-xs text-muted-foreground">({b.count})</span>
                          </span>
                        </div>
                        <Bar pct={b.pct} className="bg-accent" label={`${b.label}: ${b.pct}%`} />
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel
                  title="Recruiter corrections"
                  desc="Leads a recruiter edited after enrichment finished. High means recruiters are fixing or completing what enrichment produced."
                >
                  <p className="text-sm">
                    <b>{data.manualOverrideRate}%</b> — {data.leadsOverridden} of{" "}
                    {data.leadsEvaluated} leads
                  </p>
                </Panel>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One plain-language sentence a busy owner can read instead of the tabs. */
function Summary({ data, range }: { data: ApiEnrichmentEvaluation; range: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed">
      {RANGE_PHRASE[range]}, enrichment ran <b>{data.totalRuns}</b> time
      {data.totalRuns === 1 ? "" : "s"} across <b>{data.coverage.leadsWithRunInPeriod}</b> lead
      {data.coverage.leadsWithRunInPeriod === 1 ? "" : "s"}. <b>{data.enrichedPct}%</b> of runs
      enriched the lead ({data.enrichedRule.minFields}+ fields, or an email or phone), and{" "}
      <b>{data.foundDataPct}%</b> found at least some new data. On average a run filled{" "}
      <b>{data.fieldCoverage.avgFields}</b> of {data.fieldCoverage.total} fields.
    </div>
  );
}

function Panel({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bar({ pct, className, label }: { pct: number; className: string; label: string }) {
  return (
    <div
      className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={label}
    >
      <div
        className={`h-full rounded-full ${className}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}
