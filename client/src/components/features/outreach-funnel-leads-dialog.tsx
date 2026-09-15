import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { OutreachFunnelCategory } from "@/lib/api-types";

const CATEGORY_LABEL: Record<OutreachFunnelCategory, string> = {
  contacted: "Contacted",
  awaiting_reply: "Awaiting Reply",
  replied: "Replied",
  in_negotiation: "In Negotiation",
  dnc: "DNC",
  onboarded: "Onboarded",
};

interface Props {
  category: OutreachFunnelCategory | null;
  range: string;
  onOpenChange: (open: boolean) => void;
}

/** The drill-down behind a Live Outreach tile: exactly the leads that make up
 *  that tile's count, for the same category+range (server computes both from
 *  one shared id set, so this list can never disagree with the number the
 *  recruiter/owner clicked on). */
export function OutreachFunnelLeadsDialog({ category, range, onOpenChange }: Props) {
  const query = useQuery({
    queryKey: ["outreach-funnel-leads", category, range],
    queryFn: () => api.getOutreachFunnelLeads(category!, range),
    enabled: !!category,
  });

  const leads = query.data?.leads ?? [];

  return (
    <Dialog open={!!category} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? CATEGORY_LABEL[category] : ""}</DialogTitle>
          <DialogDescription>
            {query.isLoading ? "Loading…" : `${leads.length} lead${leads.length === 1 ? "" : "s"}`}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads in this category for the selected range.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.displayName ?? l.fullName ?? l.maskedLabel ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[l.targetLanguage, l.country].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <div>{l.assignedTo?.name ?? "Unassigned"}</div>
                  <div className="mt-0.5">{l.source}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
