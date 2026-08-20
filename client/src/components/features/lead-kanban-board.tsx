import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiLead, ApiUser, LeadPriority, LeadStage, LeadTimelineEvent } from "@/lib/api-types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Link2, Phone, MapPin, Clock } from "lucide-react";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "REPLIED", "NEGOTIATING", "INVITE_SENT", "ONBOARDED", "COLD"];

const STAGE_META: Record<LeadStage, { label: string; dot: string; text: string }> = {
  NEW: { label: "New", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  CONTACTED: { label: "Contacted", dot: "bg-primary", text: "text-primary" },
  REPLIED: { label: "Replied", dot: "bg-primary", text: "text-primary" },
  NEGOTIATING: { label: "Negotiating", dot: "bg-warning", text: "text-warning" },
  INVITE_SENT: { label: "Invite sent", dot: "bg-accent", text: "text-accent" },
  ONBOARDED: { label: "Onboarded", dot: "bg-success", text: "text-success" },
  COLD: { label: "Cold", dot: "bg-destructive", text: "text-destructive" },
};

function priorityStyle(p: LeadPriority) {
  return p === "P0"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : p === "P1"
    ? "border-warning/40 bg-warning/10 text-warning"
    : p === "P2"
    ? "border-accent/40 bg-accent/10 text-accent"
    : "border-border bg-muted/40 text-muted-foreground";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface LeadKanbanBoardProps {
  leads: ApiLead[];
  recruiters: ApiUser[];
  isLoading?: boolean;
  onStageChange: (id: string, stage: LeadStage, closureReason?: string) => void;
}

export function LeadKanbanBoard({ leads, recruiters, isLoading, onStageChange }: LeadKanbanBoardProps) {
  const [detailLead, setDetailLead] = useState<ApiLead | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const byStage = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s, [] as ApiLead[]])) as Record<LeadStage, ApiLead[]>;
    for (const lead of leads) map[lead.stage]?.push(lead);
    return map;
  }, [leads]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const newStage = over.id as LeadStage;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === newStage) return;

    if (newStage === "COLD") {
      // Server requires a closureReason in the same PATCH when stage -> COLD
      // (400 REASON_REQUIRED otherwise), so prompt for one up front.
      const reason = window.prompt("Reason for marking this lead Cold?");
      if (!reason || !reason.trim()) return;
      onStageChange(leadId, newStage, reason.trim());
    } else {
      onStageChange(leadId, newStage);
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-24 text-sm text-muted-foreground">Loading board…</div>;
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={byStage[stage]}
              recruiters={recruiters}
              onCardClick={setDetailLead}
            />
          ))}
        </div>
      </DndContext>
      <LeadDetailDialog lead={detailLead} recruiters={recruiters} onOpenChange={(o) => !o && setDetailLead(null)} />
    </>
  );
}

function KanbanColumn({
  stage, leads, recruiters, onCardClick,
}: { stage: LeadStage; leads: ApiLead[]; recruiters: ApiUser[]; onCardClick: (l: ApiLead) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = STAGE_META[stage];

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[240px] shrink-0 flex-col rounded-xl border bg-muted/20 p-2 transition-colors ${
        isOver ? "border-primary/50 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between px-1.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
        </div>
        <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div className="flex min-h-[60px] flex-col gap-2 overflow-y-auto px-0.5 py-1" style={{ maxHeight: "calc(100vh - 320px)" }}>
        {leads.map((lead) => (
          <KanbanCard key={lead.id} lead={lead} recruiter={recruiters.find((r) => r.id === lead.assignedRecruiterId)} onClick={() => onCardClick(lead)} />
        ))}
        {leads.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 px-2 py-4 text-center text-[11px] text-muted-foreground">
            No leads
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanCard({ lead, recruiter, onClick }: { lead: ApiLead; recruiter?: ApiUser; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const label = lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? "—";
  const visibleServices = lead.services.slice(0, 2);
  const extraServices = lead.services.length - visibleServices.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`cursor-grab space-y-1.5 rounded-lg border border-border bg-card p-2.5 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-xs font-medium leading-tight">{label}</span>
        {lead.priority && (
          <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold ${priorityStyle(lead.priority)}`}>
            {lead.priority}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {lead.targetLanguage && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{lead.targetLanguage}</span>
        )}
        {visibleServices.map((s) => (
          <span key={s} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{s}</span>
        ))}
        {extraServices > 0 && (
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">+{extraServices}</span>
        )}
      </div>
      <div className="flex items-center justify-between pt-0.5 text-[10px] text-muted-foreground">
        <span className="truncate">{recruiter?.name ?? "Unassigned"}</span>
        <span className="shrink-0 tabular-nums">{relativeTime(lead.lastActivityAt)}</span>
      </div>
    </div>
  );
}

function timelineIcon(type: LeadTimelineEvent["type"]): string {
  switch (type) {
    case "STAGE_CHANGE": return "🟦";
    case "FLAG": return "🚩";
    case "INTERACTION": return "💬";
    case "MANUAL_ACTIVITY": return "📝";
    default: return "•";
  }
}

function formatStageLabel(stage: string): string {
  return stage.charAt(0) + stage.slice(1).toLowerCase().replace(/_/g, " ");
}

function timelineTitle(e: LeadTimelineEvent): string {
  switch (e.type) {
    case "STAGE_CHANGE": return `Stage → ${formatStageLabel(e.data.toStage ?? "")}`;
    case "FLAG": return `Flag ${e.data.action === "removed" ? "removed" : "added"}: ${e.data.flag ?? ""}`;
    case "INTERACTION": return `${e.data.direction === "OUTBOUND" ? "Outreach sent" : "Reply received"} · ${e.data.channel ?? ""}`;
    case "MANUAL_ACTIVITY": return e.data.type ?? "Manual activity";
    default: return e.type;
  }
}

function timelineDetail(e: LeadTimelineEvent): string | undefined {
  switch (e.type) {
    case "STAGE_CHANGE":
      return e.data.reason ? `${e.data.fromStage ?? "—"} → ${e.data.toStage ?? "—"}. Reason: ${e.data.reason}` : `${e.data.fromStage ?? "—"} → ${e.data.toStage ?? "—"}`;
    case "FLAG": return e.data.reason;
    case "INTERACTION": return e.data.occurredAt ? new Date(e.data.occurredAt).toLocaleString() : undefined;
    case "MANUAL_ACTIVITY": return [e.data.purpose, e.data.outcome, e.data.notes].filter(Boolean).join(" — ") || undefined;
    default: return undefined;
  }
}

function LeadDetailDialog({
  lead, recruiters, onOpenChange,
}: { lead: ApiLead | null; recruiters: ApiUser[]; onOpenChange: (o: boolean) => void }) {
  const detailQuery = useQuery({
    queryKey: ["lead", lead?.id],
    queryFn: () => api.getLead(lead!.id),
    enabled: !!lead,
  });
  const recruiter = lead ? recruiters.find((r) => r.id === lead.assignedRecruiterId) : undefined;
  const label = lead?.displayName ?? lead?.fullName ?? lead?.maskedLabel ?? "—";
  const timeline = [...(detailQuery.data?.timeline ?? [])].reverse();

  return (
    <Dialog open={!!lead} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {label}
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${STAGE_META[lead.stage].text}`}>
                  {STAGE_META[lead.stage].label}
                </span>
                {lead.priority && (
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${priorityStyle(lead.priority)}`}>{lead.priority}</span>
                )}
              </DialogTitle>
              <DialogDescription>Card details and full activity timeline.</DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Country" value={lead.country ?? "—"} />
              <Row icon={<Link2 className="h-3.5 w-3.5" />} label="Profile" value={lead.profileLink ?? "—"} />
              <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={lead.email ?? "—"} />
              <Row icon={<Phone className="h-3.5 w-3.5" />} label="Contact" value={lead.contactNumber ?? "—"} />
              <Row label="Language" value={lead.targetLanguage ?? "—"} />
              <Row label="Services" value={lead.services.length ? lead.services.join(", ") : "—"} />
              <Row label="Recruiter" value={recruiter?.name ?? "Unassigned"} />
              <Row icon={<Clock className="h-3.5 w-3.5" />} label="Last activity" value={relativeTime(lead.lastActivityAt)} />
            </div>

            <div className="max-h-[40vh] overflow-y-auto pr-1">
              {detailQuery.isLoading && <div className="py-6 text-center text-xs text-muted-foreground">Loading timeline…</div>}
              {!detailQuery.isLoading && (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {timeline.map((e, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">
                        {timelineIcon(e.type)}
                      </span>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="text-sm font-medium text-foreground">{timelineTitle(e)}</div>
                        <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{relativeTime(e.at)}</div>
                      </div>
                      {timelineDetail(e) && <div className="mt-0.5 text-xs text-muted-foreground">{timelineDetail(e)}</div>}
                    </li>
                  ))}
                  {timeline.length === 0 && <li className="text-xs text-muted-foreground">No activity recorded yet.</li>}
                </ol>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-start gap-3 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</div>
      <div className="break-all text-foreground/90">{value}</div>
    </div>
  );
}
