import type { Lead } from "@/lib/g3-mock";
import { recruiterById } from "@/lib/g3-mock";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const stageTone: Record<string, string> = {
  New: "bg-muted text-foreground/70",
  Contacted: "bg-accent/10 text-accent",
  Replied: "bg-primary/10 text-primary",
  Negotiating: "bg-warning/15 text-warning",
  "Invite Sent": "bg-warning/15 text-warning",
  Onboarded: "bg-[oklch(0.62_0.14_155)]/15 text-[oklch(0.42_0.14_155)]",
  Cold: "bg-muted text-muted-foreground",
};

export function LeadCard({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const rec = recruiterById(lead.recruiter_id);
  const label = lead.identity_resolved ? lead.display_name ?? lead.masked_label : lead.masked_label;
  return (
    <div className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40 hover:shadow-[0_1px_0_0_theme(colors.accent/10),0_8px_24px_-12px_theme(colors.accent/20)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{label}</span>
            {!lead.identity_resolved && (
              <Badge variant="outline" className="border-warning/40 text-warning text-[10px] px-1.5 py-0 font-medium">
                unresolved identity
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{lead.language}</span>
            <span>·</span>
            <span>{lead.source}</span>
            {rec && <><span>·</span><span>{rec.name}</span></>}
          </div>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium", stageTone[lead.stage])}>
          {lead.stage}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {lead.services.map((s) => (
          <span key={s} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-foreground/70">
            {s}
          </span>
        ))}
      </div>

      {!compact && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-[11px]">
          <div>
            <div className="text-muted-foreground">availability</div>
            <div className="mt-0.5 font-medium text-foreground/80">{lead.availability}</div>
          </div>
          <div>
            <div className="text-muted-foreground">verified email</div>
            <div className={cn("mt-0.5 font-medium", lead.verified_email ? "text-[oklch(0.5_0.14_155)]" : "text-warning")}>
              {lead.verified_email ? "yes" : "no"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">last activity</div>
            <div className="mt-0.5 font-medium text-foreground/80">{lead.last_activity}</div>
          </div>
        </div>
      )}

      {lead.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lead.flags.map((f) => (
            <Badge key={f} variant="outline" className={cn(
              "text-[10px] px-1.5 py-0 font-medium",
              f === "DNC" && "border-destructive/40 text-destructive",
              f === "High Priority" && "border-warning/40 text-warning",
              f === "Watching" && "border-accent/40 text-accent",
              f === "On Hold" && "border-muted-foreground/30 text-muted-foreground",
            )}>
              {f}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}