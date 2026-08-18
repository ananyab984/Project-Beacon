import type { ApiLead, ApiUser } from "@/lib/api-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const stageTone: Record<string, string> = {
  NEW: "bg-muted text-foreground/70",
  CONTACTED: "bg-accent/10 text-accent",
  REPLIED: "bg-primary/10 text-primary",
  NEGOTIATING: "bg-warning/15 text-warning",
  INVITE_SENT: "bg-warning/15 text-warning",
  ONBOARDED: "bg-[oklch(0.62_0.14_155)]/15 text-[oklch(0.42_0.14_155)]",
  COLD: "bg-muted text-muted-foreground",
};

export function LeadCard({
  lead,
  recruiters = [],
  compact = false,
}: {
  lead: ApiLead;
  recruiters?: ApiUser[];
  compact?: boolean;
}) {
  const rec = recruiters.find((r) => r.id === lead.assignedRecruiterId);
  const label = lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? "—";
  const language = lead.targetLanguage ?? lead.sourceLanguage ?? "—";
  return (
    <div className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40 hover:shadow-[0_1px_0_0_theme(colors.accent/10),0_8px_24px_-12px_theme(colors.accent/20)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{label}</span>
            {!lead.identityResolved && (
              <Badge variant="outline" className="border-warning/40 text-warning text-[10px] px-1.5 py-0 font-medium">
                unresolved identity
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{language}</span>
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
            <div className={cn("mt-0.5 font-medium", lead.emailVerified ? "text-[oklch(0.5_0.14_155)]" : "text-warning")}>
              {lead.emailVerified ? "yes" : "no"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">last activity</div>
            <div className="mt-0.5 font-medium text-foreground/80">
              {lead.lastActivityAt ? new Date(lead.lastActivityAt).toLocaleDateString() : "—"}
            </div>
          </div>
        </div>
      )}

      {lead.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lead.flags.map((f) => (
            <Badge key={f} variant="outline" className={cn(
              "text-[10px] px-1.5 py-0 font-medium",
              f === "DNC" && "border-destructive/40 text-destructive",
              f === "HIGH_PRIORITY" && "border-warning/40 text-warning",
              f === "WATCHING" && "border-accent/40 text-accent",
              f === "ON_HOLD" && "border-muted-foreground/30 text-muted-foreground",
            )}>
              {f}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
