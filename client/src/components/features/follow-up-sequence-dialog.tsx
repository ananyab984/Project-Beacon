import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, GripVertical, Trash2, Mail, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { ApiFollowUpSequence, ApiFollowUpStep, FollowUpTriggerType, FollowUpChannel } from "@/lib/api-types";

interface FollowUpSequenceDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  sequence?: ApiFollowUpSequence | null;
  onSuccess?: () => void;
}

const TRIGGER_TYPES: { value: FollowUpTriggerType; label: string; description: string }[] = [
  { value: "TIME_BASED", label: "Time-based", description: "Send after N days from enrollment" },
  { value: "STAGE_CHANGE", label: "Stage change", description: "Trigger when lead stage changes to specific value" },
  { value: "REPLY_RECEIVED", label: "Reply received", description: "Trigger when candidate replies (with optional category filter)" },
  { value: "MANUAL", label: "Manual only", description: "Only sent when manually triggered" },
];

const CHANNELS: { value: FollowUpChannel; label: string; icon: React.ReactNode }[] = [
  { value: "EMAIL", label: "Email", icon: <Mail className="h-3.5 w-3.5" /> },
  { value: "LINKEDIN", label: "LinkedIn DM", icon: <Send className="h-3.5 w-3.5" /> },
];

function renderTriggerConfigUI(triggerType: FollowUpTriggerType, config: Record<string, any>, onChange: (config: Record<string, any>) => void) {
  switch (triggerType) {
    case "TIME_BASED": {
      const daysAfter = config.daysAfter ?? 3;
      return (
        <div className="space-y-2">
          <Label>Days after enrollment</Label>
          <Input
            type="number"
            min="0"
            max="30"
            value={daysAfter}
            onChange={(e) => onChange({ ...config, daysAfter: parseInt(e.target.value) || 0 })}
            className="w-24"
          />
          <p className="text-xs text-muted-foreground">0 = send immediately on enrollment</p>
        </div>
      );
    }
    case "STAGE_CHANGE": {
      const stage = config.stage || "REPLIED";
      const stages = ["NEW", "CONTACTED", "REPLIED", "NEGOTIATING", "INVITE_SENT", "ONBOARDED", "COLD"] as const;
      return (
        <div className="space-y-2">
          <Label>Trigger on stage change to</Label>
          <Select value={stage} onValueChange={(v) => onChange({ ...config, stage: v })} className="w-48">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "REPLY_RECEIVED": {
      const replyCategory = config.replyCategory || "";
      return (
        <div className="space-y-2">
          <Label>Reply category filter (optional)</Label>
          <Input
            placeholder="e.g. INTERESTED, FAQ, RATE_QUESTION"
            value={replyCategory}
            onChange={(e) => onChange({ ...config, replyCategory: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Leave empty to trigger on any reply</p>
        </div>
      );
    }
    case "MANUAL":
      return <p className="text-sm text-muted-foreground">This step will only send when manually triggered from the executions view.</p>;
    default:
      return null;
  }
}

export function FollowUpSequenceDialog({ open, setOpen, sequence, onSuccess }: FollowUpSequenceDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!sequence;

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    isGlobal: false,
    steps: [] as Array<{
      id?: string;
      stepOrder: number;
      triggerType: FollowUpTriggerType;
      triggerConfig: Record<string, any>;
      channel: FollowUpChannel;
      subjectTemplate: string;
      bodyTemplate: string;
      useAiDraft: boolean;
      isActive: boolean;
    }>,
  });

  useEffect(() => {
    if (sequence) {
      setFormData({
        name: sequence.name,
        description: sequence.description || "",
        isGlobal: sequence.isGlobal,
        steps: sequence.steps.map((s) => ({
          id: s.id,
          stepOrder: s.stepOrder,
          triggerType: s.triggerType,
          triggerConfig: s.triggerConfig,
          channel: s.channel,
          subjectTemplate: s.subjectTemplate || "",
          bodyTemplate: s.bodyTemplate,
          useAiDraft: s.useAiDraft,
          isActive: s.isActive,
        })),
      });
    } else {
      setFormData({
        name: "",
        description: "",
        isGlobal: false,
        steps: [{
          stepOrder: 1,
          triggerType: "TIME_BASED",
          triggerConfig: { daysAfter: 0 },
          channel: "EMAIL",
          subjectTemplate: "",
          bodyTemplate: "",
          useAiDraft: true,
          isActive: true,
        }],
      });
    }
  }, [sequence, open]);

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => api.createFollowUpSequence(data),
    onSuccess: () => {
      toast.success(isEditing ? "Sequence updated" : "Sequence created");
      queryClient.invalidateQueries({ queryKey: ["follow-up-sequences"] });
      setOpen(false);
      onSuccess?.();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save sequence"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof formData }) => api.updateFollowUpSequence(id, data),
    onSuccess: () => {
      toast.success("Sequence updated");
      queryClient.invalidateQueries({ queryKey: ["follow-up-sequences"] });
      setOpen(false);
      onSuccess?.();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update sequence"),
  });

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error("Sequence name is required");
      return;
    }
    if (formData.steps.some((s) => !s.bodyTemplate.trim())) {
      toast.error("All steps must have a body template");
      return;
    }
    if (formData.steps.some((s) => s.channel === "EMAIL" && !s.subjectTemplate.trim())) {
      toast.error("Email steps must have a subject template");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      isGlobal: formData.isGlobal,
      steps: formData.steps.map((s, i) => ({
        stepOrder: i + 1,
        triggerType: s.triggerType,
        triggerConfig: s.triggerConfig,
        channel: s.channel,
        subjectTemplate: s.channel === "EMAIL" ? s.subjectTemplate.trim() : null,
        bodyTemplate: s.bodyTemplate.trim(),
        useAiDraft: s.useAiDraft,
        isActive: s.isActive,
      })),
    };

    if (isEditing && sequence) {
      updateMutation.mutate({ id: sequence.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const addStep = () => {
    const nextOrder = formData.steps.length + 1;
    setFormData((prev) => ({
      ...prev,
      steps: [...prev.steps, {
        stepOrder: nextOrder,
        triggerType: "TIME_BASED",
        triggerConfig: { daysAfter: nextOrder === 1 ? 0 : 3 },
        channel: "EMAIL",
        subjectTemplate: "",
        bodyTemplate: "",
        useAiDraft: true,
        isActive: true,
      }],
    }));
  };

  const removeStep = (index: number) => {
    if (formData.steps.length <= 1) {
      toast.error("A sequence must have at least one step");
      return;
    }
    setFormData((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 })),
    }));
  };

  const updateStep = (index: number, updates: Partial<typeof formData.steps[0]>) => {
    setFormData((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === index ? { ...s, ...updates } : s),
    }));
  };

  const updateTriggerConfig = (index: number, config: Record<string, any>) => {
    updateStep(index, { triggerConfig: config });
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Sequence" : "Create Follow-up Sequence"}</DialogTitle>
          <DialogDescription>
            Define a multi-step outreach campaign. Steps execute automatically based on their trigger type.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Sequence Details */}
          <Card>
            <CardHeader>
              <CardTitle>Sequence Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Initial Outreach Sequence"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="What this sequence is for..."
                  rows={2}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.isGlobal}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isGlobal: checked }))}
                />
                <Label className="text-sm font-normal">Global sequence (visible to all recruiters)</Label>
              </div>
            </CardContent>
          </Card>

          {/* Steps */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Steps ({formData.steps.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={addStep} disabled={formData.steps.length >= 10}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Step
              </Button>
            </CardHeader>
            <CardContent>
              {formData.steps.map((step, index) => (
                <div key={step.id || index} className="border border-border rounded-xl p-4 space-y-4" style={{ background: "var(--muted)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">Step {index + 1}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeStep(index)}
                        disabled={formData.steps.length <= 1}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <GripVertical className="text-muted-foreground cursor-grab" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Channel</Label>
                      <div className="flex gap-2">
                        {CHANNELS.map((c) => (
                          <Button
                            key={c.value}
                            variant={step.channel === c.value ? "default" : "outline"}
                            onClick={() => updateStep(index, { channel: c.value })}
                            className="flex-1 gap-2"
                          >
                            {c.icon} {c.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Trigger Type</Label>
                      <Select value={step.triggerType} onValueChange={(v) => updateStep(index, { triggerType: v, triggerConfig: {} })} className="w-full">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TRIGGER_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              <div className="space-y-0.5">
                                <span>{t.label}</span>
                                <span className="text-xs text-muted-foreground">{t.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Trigger Config */}
                  <div className="space-y-2">
                    <Label>Trigger Configuration</Label>
                    {renderTriggerConfigUI(step.triggerType, step.triggerConfig, (config) => updateTriggerConfig(index, config))}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>Use AI Drafting</Label>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={step.useAiDraft}
                        onCheckedChange={(checked) => updateStep(index, { useAiDraft: checked })}
                      />
                      <span className="text-sm">Personalize template per lead using AI (falls back to template if AI fails)</span>
                    </div>
                  </div>

                  {step.channel === "EMAIL" && (
                    <div className="space-y-2">
                      <Label>Subject Template</Label>
                      <Input
                        value={step.subjectTemplate}
                        onChange={(e) => updateStep(index, { subjectTemplate: e.target.value })}
                        placeholder="e.g. Following up on {{lead.targetLanguage}} opportunity"
                      />
                      <p className="text-xs text-muted-foreground">
                        Variables: {{lead.fullName}}, {{lead.displayName}}, {{lead.firstName}}, {{lead.email}}, {{lead.targetLanguage}}, {{lead.services}}, {{recruiter.name}}, {{applyUrl}}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Body Template</Label>
                    <Textarea
                      value={step.bodyTemplate}
                      onChange={(e) => updateStep(index, { bodyTemplate: e.target.value })}
                      placeholder={step.channel === "EMAIL"
                        ? "Hi {{lead.firstName}},\n\nFollowing up on my previous message about {{lead.targetLanguage}} {{lead.services}} opportunities..."
                        : "Hi {{lead.firstName}}, following up on my previous LinkedIn message..."}
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      Variables: {{lead.fullName}}, {{lead.displayName}}, {{lead.firstName}}, {{lead.email}}, {{lead.targetLanguage}}, {{lead.services}}, {{recruiter.name}}, {{applyUrl}}
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={step.isActive}
                      onCheckedChange={(checked) => updateStep(index, { isActive: checked })}
                    />
                    <Label className="text-sm font-normal">Step is active</Label>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isEditing ? "Save Changes" : "Create Sequence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}