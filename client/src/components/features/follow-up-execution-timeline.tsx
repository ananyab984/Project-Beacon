import { useQuery } from "@tanstack/react-query";
import { Loader2, Mail, Send, AlertCircle, CheckCircle2, Clock, RotateCcw, SkipForward, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { format } from "date-fns";
import type { ApiFollowUpExecution, FollowUpStepStatus } from "@/lib/api-types";

interface FollowUpExecutionTimelineProps {
  leadId: string;
  sequenceId?: string;
}

const STATUS_CONFIG: Record<FollowUpStepStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: { label: "Pending", color: "bg-muted text-muted-foreground", icon: <Clock className="h-3 w-3" /> },
  SCHEDULED: { label: "Scheduled", color: "bg-primary/10 text-primary", icon: <Clock className="h-3 w-3" /> },
  SENT: { label: "Sent", color: "bg-accent/10 text-accent", icon: <CheckCircle2 className="h-3 w-3" /> },
  FAILED: { label: "Failed", color: "bg-destructive/10 text-destructive", icon: <AlertCircle className="h-3 w-3" /> },
  SKIPPED: { label: "Skipped", color: "bg-muted text-muted-foreground", icon: <SkipForward className="h-3 w-3" /> },
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FollowUpExecutionTimeline({ leadId, sequenceId }: FollowUpExecutionTimelineProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["follow-up-executions", leadId, sequenceId],
    queryFn: () => api.getFollowUpExecutions(sequenceId || "", { leadId }),
    enabled: !!leadId,
  });

  const executions = data?.executions ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
          Loading execution history…
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-sm text-destructive">Failed to load execution history</CardContent>
      </Card>
    );
  }

  if (executions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No follow-up executions for this lead{sequenceId ? " in this sequence" : ""}.
        </CardContent>
      </Card>
    );
  }

  // Group by sequence if not filtered
  const grouped = sequenceId
    ? { [sequenceId]: executions }
    : executions.reduce((acc, e) => {
        const seqName = e.step?.sequence?.name || `Sequence ${e.step?.sequenceId?.slice(0, 8)}`;
        if (!acc[seqName]) acc[seqName] = [];
        acc[seqName].push(e);
        return acc;
      }, {} as Record<string, typeof executions>);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Follow-up Executions
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-96">
          {Object.entries(grouped).map(([seqName, seqExecutions]) => (
            <div key={seqName} className="space-y-3">
              <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">{seqName}</div>
              {seqExecutions
                .sort((a, b) => (a.step?.stepOrder || 0) - (b.step?.stepOrder || 0))
                .map((execution) => {
                  const step = execution.step;
                  const statusConfig = STATUS_CONFIG[execution.status];
                  const isPending = execution.status === "PENDING" || execution.status === "SCHEDULED";
                  const isTerminal = execution.status === "SENT" || execution.status === "FAILED" || execution.status === "SKIPPED";

                  return (
                    <Collapsible key={execution.id} open={!isTerminal}>
                      <CollapsibleTrigger className="w-full p-3 bg-card border border-border rounded-lg hover:bg-muted/50 transition-colors text-left">
                        <div className="flex items-center gap-3">
                          <div className={`flex items-center justify-center h-8 w-8 rounded-full ${statusConfig.color}`}>
                            {statusConfig.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">Step {step?.stepOrder || "?"}: {step?.channel}</span>
                              <Badge variant="outline" className={statusConfig.color.replace("bg-", "bg-").replace("text-", "text-")}>
                                {statusConfig.label}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {step?.triggerType ? `Trigger: ${step.triggerType.replace("_", " ")}` : ""}
                              {execution.scheduledAt && ` · Scheduled: ${format(new Date(execution.scheduledAt), "MMM d, h:mm a")}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            {execution.sentAt && (
                              <>
                                <span>Sent {formatRelative(execution.sentAt)}</span>
                              </>
                            )}
                            {!isTerminal && execution.status !== "SCHEDULED" && <Clock className="h-3.5 w-3.5 animate-pulse" />}
                            <ChevronDown className="h-4 w-4" />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 pb-4">
                        <div className="space-y-3 text-sm">
                          {execution.subject && (
                            <div>
                              <span className="font-medium text-muted-foreground">Subject:</span>
                              <p className="mt-1">{execution.subject}</p>
                            </div>
                          )}
                          <div>
                            <span className="font-medium text-muted-foreground">Body:</span>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{execution.body || "—"}</p>
                          </div>
                          {execution.error && (
                            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs">
                              <strong>Error:</strong> {execution.error}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                            <span className="text-xs text-muted-foreground">Created: {formatRelative(execution.createdAt)}</span>
                            {execution.sentAt && <span className="text-xs text-muted-foreground">Sent: {formatRelative(execution.sentAt)}</span>}
                            {execution.scheduledAt && <span className="text-xs text-muted-foreground">Scheduled: {formatRelative(execution.scheduledAt)}</span>}
                          </div>
                          {execution.status === "FAILED" && (
                            <Button variant="outline" size="sm" onClick={() => api.retryFollowUpExecution(execution.id).then(() => refetch())} className="gap-1.5">
                              <RotateCcw className="h-3.5 w-3.5" /> Retry
                            </Button>
                          )}
                          {(execution.status === "PENDING" || execution.status === "SCHEDULED") && (
                            <Button variant="outline" size="sm" onClick={() => api.skipFollowUpExecution(execution.id).then(() => refetch())} className="gap-1.5">
                              <SkipForward className="h-3.5 w-3.5" /> Skip
                            </Button>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}