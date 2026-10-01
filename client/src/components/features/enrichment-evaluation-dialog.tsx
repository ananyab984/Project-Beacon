import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { EnrichmentTier, EnrichmentRunConclusion } from "@/lib/api-types";

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
];

const RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const TIERS: EnrichmentTier[] = ["TIER_1", "TIER_2", "TIER_3"];
const TIER_LABEL: Record<EnrichmentTier, string> = {
  TIER_1: "Tier 1 (primary scraper)",
  TIER_2: "Tier 2 (Parallel)",
  TIER_3: "Tier 3 (web search)",
};

const CONCLUSIONS: EnrichmentRunConclusion[] = ["SHORT_CIRCUIT_SUCCESS", "EXHAUSTED_NO_MATCH", "TIMED_OUT", "SYSTEM_ERROR"];
const CONCLUSION_LABEL: Record<EnrichmentRunConclusion, string> = {
  SHORT_CIRCUIT_SUCCESS: "Success",
  EXHAUSTED_NO_MATCH: "Exhausted, no match",
  TIMED_OUT: "Timed out",
  SYSTEM_ERROR: "System error",
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function EnrichmentEvaluationDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const [platform, setPlatform] = useState("all");
  const [range, setRange] = useState("30d");

  const { data, isLoading } = useQuery({
    queryKey: ["enrichment-evaluation", platform, range],
    queryFn: () => api.getEnrichmentEvaluation(platform, range),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enrichment Evaluation</DialogTitle>
          <DialogDescription>
            Live analytics over the automatic enrichment waterfall -- every number below is computed fresh from the current run history, not a static export.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 py-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9 text-xs w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLATFORM_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-9 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}

        {!isLoading && data && data.totalRuns === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No enrichment runs in this period{platform !== "all" ? " for this platform" : ""}.
          </div>
        )}

        {!isLoading && data && data.totalRuns > 0 && (
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground">{data.totalRuns} enrichment run{data.totalRuns === 1 ? "" : "s"} in this period</p>

            {/* Metric 1: Enrichment % */}
            <MetricSection title="Enrichment %" desc="Of every run in this period, how it concluded.">
              <table className="w-full text-sm">
                <tbody>
                  <StatRow label="Enriched" value={`${data.enrichmentPct.enriched}%`} />
                  <StatRow label="Exhausted, no match" value={`${data.enrichmentPct.exhausted}%`} />
                  <StatRow label="On Hold (timeout / system error)" value={`${data.enrichmentPct.onHold}%`} />
                </tbody>
              </table>
            </MetricSection>

            {/* Metric 2: Time taken */}
            <MetricSection
              title="Time taken"
              desc={`Reference: ${fmtMs(data.timeTaken.referenceLines.perStepDeadlineMs)} per fast-provider step, ${fmtMs(data.timeTaken.referenceLines.leadLevelCeilingMs)} cumulative lead-level ceiling.`}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="font-medium">Conclusion</th>
                    <th className="font-medium">Avg</th>
                    <th className="font-medium">Median</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border font-medium">
                    <td className="py-1.5">All runs</td>
                    <td className="py-1.5">{fmtMs(data.timeTaken.avgMs)}</td>
                    <td className="py-1.5">{fmtMs(data.timeTaken.medianMs)}</td>
                  </tr>
                  {CONCLUSIONS.map((c) => (
                    <tr key={c} className="border-t border-border text-muted-foreground">
                      <td className="py-1.5">{CONCLUSION_LABEL[c]}</td>
                      <td className="py-1.5">{fmtMs(data.timeTaken.byConclusion[c]?.avgMs ?? 0)}</td>
                      <td className="py-1.5">{fmtMs(data.timeTaken.byConclusion[c]?.medianMs ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </MetricSection>

            {/* Metric 3: Tier attribution */}
            <MetricSection title="Tier attribution" desc="Of enriched leads, the deepest tier that had to resolve them. Same 3 tiers for every platform -- Tier 2 (Parallel) and Tier 3 (web search) both run regardless of platform.">
              <table className="w-full text-sm">
                <tbody>
                  {TIERS.map((t) => <StatRow key={t} label={TIER_LABEL[t]} value={`${data.tierAttribution[t]}%`} />)}
                </tbody>
              </table>
            </MetricSection>

            {/* Metric 4: Quality by tier */}
            <MetricSection title="Quality by tier" desc="Average enriched-field count (out of 10) among leads resolved at each tier.">
              <table className="w-full text-sm">
                <tbody>
                  {TIERS.map((t) => <StatRow key={t} label={TIER_LABEL[t]} value={`${data.qualityByTier[t]} / 10`} />)}
                </tbody>
              </table>
            </MetricSection>

            {/* Metric 5: Manual override rate */}
            <MetricSection title="Manual override rate" desc="Of currently-enriched leads, the share a recruiter edited after the automated run concluded.">
              <table className="w-full text-sm">
                <tbody>
                  <StatRow label="Manually overridden" value={`${data.manualOverrideRate}%`} />
                </tbody>
              </table>
            </MetricSection>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetricSection({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className="py-1.5 text-muted-foreground">{label}</td>
      <td className="py-1.5 text-right font-medium">{value}</td>
    </tr>
  );
}
