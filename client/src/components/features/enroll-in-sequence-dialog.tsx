import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Mail, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { ApiFollowUpSequence, ApiFollowUpStep } from "@/lib/api-types";

interface EnrollInSequenceDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  leadId: string;
  leadName?: string;
  onSuccess?: () => void;
}

export function EnrollInSequenceDialog({ open, setOpen, leadId, leadName, onSuccess }: EnrollInSequenceDialogProps) {
  const queryClient = useQueryClient();

  const { data: sequencesData, isLoading } = useQuery({
    queryKey: ["follow-up-sequences"],
    queryFn: () => api.getFollowUpSequences(),
    enabled: open,
  });

  const sequences = sequencesData?.sequences ?? [];
  const activeSequences = sequences.filter((s) => s.status === "ACTIVE");

  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);

  const enrollMutation = useMutation({
    mutationFn: (sequenceId: string) => api.enrollLeadInSequence(sequenceId, leadId),
    onSuccess: (result) => {
      const seq = activeSequences.find((s) => s.id === selectedSequenceId);
      toast.success(`Enrolled in "${seq?.name}" - ${result.executions.length} step(s) scheduled`);
      queryClient.invalidateQueries({ queryKey: ["follow-up-sequences"] });
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      setOpen(false);
      onSuccess?.();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to enroll lead"),
  });

  const selectedSequence = activeSequences.find((s) => s.id === selectedSequenceId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enroll in Follow-up Sequence</DialogTitle>
          <DialogDescription>
            Select a sequence to enroll <strong>{leadName || "this lead"}</strong>. Steps will be scheduled automatically.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading sequences…</div>
        ) : activeSequences.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No active sequences found. Create one first in the Follow-up Sequences page.
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {activeSequences.map((seq) => (
                  <Card
                    key={seq.id}
                    className={`cursor-pointer transition-colors ${
                      selectedSequenceId === seq.id ? "border-primary bg-primary/5" : "hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedSequenceId(seq.id)}
                  >
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm font-semibold">{seq.name}</CardTitle>
                          {seq.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{seq.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {seq.steps.map((step: ApiFollowUpStep) => (
                              <span
                                key={step.id}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${
                                  step.channel === "EMAIL"
                                    ? "bg-primary/10 text-primary"
                                    : "bg-accent/10 text-accent"
                                }`}
                              >
                                {step.channel === "EMAIL" ? <Mail className="h-2.5 w-2.5" /> : <Send className="h-2.5 w-2.5" />}
                                Step {step.stepOrder} ({step.triggerType.replace("_", " ")})
                              </span>
                            ))}
                          </div>
                        </div>
                        {selectedSequenceId === seq.id && (
                          <CheckCircle2 className="h-5 w-5 text-primary shrink-0 ml-2" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>

            {selectedSequence && (
              <Card className="border-primary bg-primary/5 mt-4">
                <CardContent className="pt-4 pb-4">
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-primary">Ready to enroll</p>
                    <p className="text-muted-foreground">
                      {selectedSequence.steps.length} step{selectedSequence.steps.length > 1 ? "s" : ""} will be scheduled.
                      {selectedSequence.steps[0]?.triggerType === "TIME_BASED" &&
                        selectedSequence.steps[0]?.triggerConfig?.daysAfter === 0 && (
                          <span className="text-accent"> First step sends immediately.</span>
                        )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={enrollMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => selectedSequenceId && enrollMutation.mutate(selectedSequenceId)}
            disabled={enrollMutation.isPending || !selectedSequenceId}
          >
            {enrollMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Enrolling…
              </>
            ) : (
              "Enroll Lead"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}