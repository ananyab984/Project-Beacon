import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiUser, ApiEscalation, ApiRecruiterMetricSnapshot } from "@/lib/api-types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RecruiterLanguageMappingDialog } from "@/components/features/recruiter-language-mapping-dialog";
import { ScoreRing } from "@/components/features/kpi";
import { EvaluationDashboard } from "@/components/features/evaluation-dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, UserPlus, ShieldAlert, Clock, Globe, Check, Users, Calendar } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/recruiters")({
  head: () => ({
    meta: [
      { title: "Recruiters — Global3 Owner" },
      { name: "description", content: "Recruiter performance scorecards, language profiles, SLA adherence, and activity." },
    ],
  }),
  component: RecruitersPage,
});

const baseline = { reply: 0.28, read: 0.65 };

const COMMON_LANGUAGES = [
  "English", "French", "Spanish (LatAm)", "Spanish (Spain)", "Japanese", "German",
  "Korean", "Mandarin", "Italian", "Portuguese (BR)", "Tamil", "Telugu", "Arabic", "Dutch", "Polish", "Swedish",
];

/** ApiUser has no avatar_hue field — derive a stable per-user hue deterministically
 *  from the id so avatars keep distinct colors without fabricating server data. */
function avatarHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

function RecruitersPage() {
  const queryClient = useQueryClient();

  const { data: recruiterData } = useQuery({ queryKey: ["users", "RECRUITER"], queryFn: () => api.getUsers("RECRUITER") });
  const { data: contractorData } = useQuery({ queryKey: ["users", "CONTRACTOR"], queryFn: () => api.getUsers("CONTRACTOR") });
  const { data: escalationData } = useQuery({ queryKey: ["escalations"], queryFn: () => api.getEscalations() });

  const full = recruiterData?.users ?? [];
  const contractors = contractorData?.users ?? [];
  const escalationsList = escalationData?.escalations ?? [];

  const [openId, setOpenId] = useState<string | null>(null);
  const [escalatedRecruiterId, setEscalatedRecruiterId] = useState<string | null>(null);
  const [showMappingModal, setShowMappingModal] = useState(false);

  // Add Recruiter Onboarding Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRecruiterName, setNewRecruiterName] = useState("");
  const [newRecruiterEmail, setNewRecruiterEmail] = useState("");
  const [newRecruiterWorkStatus, setNewRecruiterWorkStatus] = useState<"permanent" | "contractor">("permanent");
  const [onboardingDate, setOnboardingDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedInitialLangs, setSelectedInitialLangs] = useState<string[]>([]);

  const allUsers = [...full, ...contractors];
  const active = allUsers.find((r) => r.id === openId) ?? null;
  const escalatedRecruiter = allUsers.find((r) => r.id === escalatedRecruiterId) ?? null;

  const recruiterEscalations = escalatedRecruiter
    ? escalationsList.filter((e) => e.recruiterId === escalatedRecruiter.id)
    : [];

  const createUserMutation = useMutation({
    mutationFn: (input: { name: string; email: string; workStatus: "PERMANENT" | "CONTRACTOR"; languages: string[] }) =>
      api.createUser({ name: input.name, email: input.email, role: "RECRUITER", workStatus: input.workStatus, languages: input.languages }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] });
      toast.success(
        `Recruiter "${result.user.name}" onboarded. Temporary password: ${result.tempPassword} — share this with them securely (no automated invite email yet).`,
        { duration: 12000 },
      );
      setNewRecruiterName("");
      setNewRecruiterEmail("");
      setSelectedInitialLangs([]);
      setShowAddModal(false);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create recruiter"),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] });
      queryClient.invalidateQueries({ queryKey: ["users", "CONTRACTOR"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to deactivate recruiter"),
  });

  const updateLanguagesMutation = useMutation({
    mutationFn: ({ id, languages }: { id: string; languages: string[] }) => api.updateUserLanguages(id, languages),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] });
      queryClient.invalidateQueries({ queryKey: ["users", "CONTRACTOR"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update languages"),
  });

  const handleCreateRecruiter = () => {
    if (!newRecruiterName.trim()) {
      toast.error("Please enter recruiter full name.");
      return;
    }
    if (!newRecruiterEmail.trim()) {
      toast.error("Please enter recruiter email.");
      return;
    }
    createUserMutation.mutate({
      name: newRecruiterName.trim(),
      email: newRecruiterEmail.trim(),
      workStatus: newRecruiterWorkStatus === "contractor" ? "CONTRACTOR" : "PERMANENT",
      languages: selectedInitialLangs,
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Recruiter Roster</div>
          <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">Recruiters &amp; Language Mapping</h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowMappingModal(true)}
            className="h-9 gap-1.5 bg-card text-xs font-semibold border-border hover:border-accent/50"
          >
            <Users className="h-4 w-4 text-accent" /> Language Mapping
          </Button>

          <Button
            onClick={() => setShowAddModal(true)}
            className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-xs"
          >
            <UserPlus className="h-4 w-4" /> + Add Recruiter
          </Button>
        </div>
      </div>

      {/* Full-access recruiters section */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest text-accent">Full-access recruiters ({full.length})</h3>
          <span className="text-[11px] text-muted-foreground">Team baseline reply {Math.round(baseline.reply * 100)}%</span>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {full.map((r) => (
            <CleanRecruiterCard
              key={r.id}
              r={r}
              escalationsList={escalationsList}
              onOpen={() => setOpenId(r.id)}
              onOpenEscalated={() => setEscalatedRecruiterId(r.id)}
              onUpdateLanguages={(languages) => updateLanguagesMutation.mutate({ id: r.id, languages })}
              onDeactivate={() => deactivateMutation.mutate(r.id)}
            />
          ))}
          {full.length === 0 && (
            <div className="col-span-full p-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
              No recruiters found. Click "+ Add Recruiter" above to add a team member.
            </div>
          )}
        </div>
      </section>

      {/* Contractors section */}
      {contractors.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Contractors ({contractors.length})</h3>
            <span className="text-[11px] text-muted-foreground">Contractor SLA &amp; evaluation metrics</span>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {contractors.map((r) => (
              <CleanRecruiterCard
                key={r.id}
                r={r}
                escalationsList={escalationsList}
                onOpen={() => setOpenId(r.id)}
                onOpenEscalated={() => setEscalatedRecruiterId(r.id)}
                onUpdateLanguages={(languages) => updateLanguagesMutation.mutate({ id: r.id, languages })}
                onDeactivate={() => deactivateMutation.mutate(r.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recruiter Language Mapping Modal */}
      <RecruiterLanguageMappingDialog open={showMappingModal} onOpenChange={setShowMappingModal} />

      {/* Add Recruiter Onboarding Flow Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" /> Recruiter Onboarding Flow
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Full Name *</Label>
              <Input
                placeholder="e.g. Sharmista Roy, Divya Kumar..."
                value={newRecruiterName}
                onChange={(e) => setNewRecruiterName(e.target.value)}
                className="h-9 text-xs bg-card"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Email *</Label>
              <Input
                type="email"
                placeholder="e.g. sharmista.roy@global3.io"
                value={newRecruiterEmail}
                onChange={(e) => setNewRecruiterEmail(e.target.value)}
                className="h-9 text-xs bg-card"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-accent" /> Onboarding Date
                </Label>
                <Input
                  type="date"
                  value={onboardingDate}
                  onChange={(e) => setOnboardingDate(e.target.value)}
                  className="h-9 text-xs bg-card"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Work Status</Label>
                <Select value={newRecruiterWorkStatus} onValueChange={(v) => setNewRecruiterWorkStatus(v as any)}>
                  <SelectTrigger className="h-9 text-xs bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">Permanent</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Assigned Languages</Label>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 border border-border/70 rounded-lg bg-muted/10">
                {COMMON_LANGUAGES.map((lang) => {
                  const isSel = selectedInitialLangs.includes(lang);
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() =>
                        setSelectedInitialLangs((prev) =>
                          isSel ? prev.filter((l) => l !== lang) : [...prev, lang],
                        )
                      }
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        isSel
                          ? "border-primary bg-primary/15 text-primary font-semibold"
                          : "border-border bg-card text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {isSel ? "✓ " : "+ "}{lang}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => setShowAddModal(false)} className="h-8 text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreateRecruiter}
              disabled={createUserMutation.isPending}
              className="h-8 text-xs bg-primary text-primary-foreground gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" /> {createUserMutation.isPending ? "Creating…" : "Submit & Create Account"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Slide-out evaluation drawer */}
      <Sheet open={!!active} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-4xl overflow-auto border-l border-border bg-background p-6">
          {active && (
            <div className="space-y-6">
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold text-white shrink-0 shadow-xs"
                      style={{ background: `oklch(0.55 0.16 ${avatarHue(active.id)})` }}
                    >
                      {active.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-lg font-bold">
                        <span>{active.name}</span>
                      </div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {active.role === "CONTRACTOR" ? "Contractor Evaluation" : "Full-Access Recruiter Evaluation"}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      if (confirm(`Deactivate ${active.name}? Their history is preserved — this is a soft deactivation, not a permanent delete.`)) {
                        deactivateMutation.mutate(active.id);
                        setOpenId(null);
                        toast.success(`Deactivated ${active.name}`);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Deactivate Recruiter
                  </Button>
                </SheetTitle>
              </SheetHeader>

              <EvaluationDashboard
                subjectId={active.id}
                subjectName={active.name}
                roleLabel={active.role === "CONTRACTOR" ? "Contractor" : "Recruiter"}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Escalated Items Modal */}
      <Dialog open={!!escalatedRecruiter} onOpenChange={(o) => !o && setEscalatedRecruiterId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-2 text-warning">
              <ShieldAlert className="h-5 w-5" />
              <DialogTitle className="text-base text-foreground">
                Escalated Items — {escalatedRecruiter?.name}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="mt-2 space-y-3 max-h-96 overflow-y-auto pr-1">
            {recruiterEscalations.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
                No active escalations logged for {escalatedRecruiter?.name}.
              </div>
            ) : (
              recruiterEscalations.map((esc) => {
                const ageDays = Math.max(0, Math.floor((Date.now() - new Date(esc.createdAt).getTime()) / 86400000));
                return (
                  <div key={esc.id} className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          esc.priority === "P1"
                            ? "bg-destructive/20 text-destructive"
                            : "bg-warning/20 text-warning"
                        }`}>
                          {esc.priority}
                        </span>
                        <span className="text-xs font-semibold text-foreground">{esc.category}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {ageDays}d aging
                      </span>
                    </div>

                    <h4 className="text-xs font-semibold text-foreground">{esc.title}</h4>
                    <p className="text-[11px] text-muted-foreground">{esc.detail}</p>

                    {esc.recommendedAction && (
                      <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-primary">
                        <strong>Recommended Action:</strong> {esc.recommendedAction}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CleanRecruiterCard({
  r,
  escalationsList,
  onOpen,
  onOpenEscalated,
  onUpdateLanguages,
  onDeactivate,
}: {
  r: ApiUser;
  escalationsList: ApiEscalation[];
  onOpen: () => void;
  onOpenEscalated: () => void;
  onUpdateLanguages: (languages: string[]) => void;
  onDeactivate: () => void;
}) {
  const { data: scoreData } = useQuery({
    queryKey: ["recruiter-score", r.id],
    queryFn: () => api.getRecruiterScore(r.id),
  });
  const snapshot = scoreData?.snapshot ?? null;
  const metricSnapshots: ApiRecruiterMetricSnapshot[] = scoreData?.metricSnapshots ?? [];

  const score = snapshot?.overallScore ?? 0;
  const bandLabel = snapshot?.bandLabel ?? "No data";
  const bandTone = !snapshot
    ? "bg-muted text-muted-foreground border-border"
    : score >= 85 ? "bg-accent/15 text-accent border-accent/30"
    : score >= 70 ? "bg-primary/15 text-primary border-primary/30"
    : score >= 55 ? "bg-warning/15 text-warning border-warning/30"
    : "bg-destructive/15 text-destructive border-destructive/30";
  const bandMeaning = snapshot ? (snapshot.summary ?? "") : "No score computed yet";

  const outreachVolume = metricSnapshots.find((m) => m.metricKey === "outreach_volume");
  const proactiveSourcing = metricSnapshots.find((m) => m.metricKey === "proactive_sourcing");
  const timeToFirstTouch = metricSnapshots.find((m) => m.metricKey === "time_to_first_touch");

  const mappedLangs = r.languages ?? [];

  const toggleLang = (lang: string) => {
    const next = mappedLangs.includes(lang)
      ? mappedLangs.filter((l) => l !== lang)
      : [...mappedLangs, lang];
    onUpdateLanguages(next);
    toast.success(`Updated language mapping for ${r.name}`);
  };

  const myEscalations = escalationsList.filter((e) => e.recruiterId === r.id);

  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-4 space-y-3.5 transition-all hover:border-accent/40 hover:shadow-lg">
      <div className="space-y-3.5">
        {/* Header: Avatar + Name + Right Corner Language Popover & Trash Icon */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 cursor-pointer" onClick={onOpen}>
            <div
              className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shrink-0 shadow-xs"
              style={{ background: `oklch(0.55 0.16 ${avatarHue(r.id)})` }}
            >
              {r.name.charAt(0)}
            </div>
            <div>
              <div className="font-bold text-base text-foreground flex items-center gap-1.5">
                {r.name}
              </div>
              <div className="text-xs text-muted-foreground font-medium">
                {r.role === "CONTRACTOR" ? "Contractor" : "Full access"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Language Mapping Configuration Dropdown */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="p-1.5 rounded-lg border border-border bg-muted/20 hover:bg-muted text-muted-foreground hover:text-accent transition-colors"
                  title="Configure Mapped Languages"
                >
                  <Globe className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3 space-y-2">
                <div className="text-xs font-semibold text-foreground border-b border-border/60 pb-1.5 flex items-center justify-between">
                  <span>Languages for {r.name}</span>
                  <span className="text-[10px] text-accent font-medium">{mappedLangs.length} mapped</span>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {COMMON_LANGUAGES.map((lang) => {
                    const isSel = mappedLangs.includes(lang);
                    return (
                      <button
                        key={lang}
                        onClick={() => toggleLang(lang)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
                          isSel ? "bg-accent/15 text-accent font-semibold" : "hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        <span>{lang}</span>
                        {isSel && <Check className="h-3.5 w-3.5 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            {/* Dustbin (deactivate) icon button */}
            <button
              onClick={() => {
                if (confirm(`Deactivate recruiter ${r.name}? Their history is preserved — this is a soft deactivation, not a permanent delete.`)) {
                  onDeactivate();
                  toast.success(`Deactivated ${r.name}`);
                }
              }}
              className="p-1.5 rounded-lg border border-border bg-muted/20 hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
              title={`Deactivate ${r.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Score & Band Card Box */}
        <div
          onClick={onOpen}
          className="cursor-pointer flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-3.5"
        >
          <ScoreRing score={score} size={64} label="Score" />
          <div className="text-right">
            <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${bandTone}`}>
              {bandLabel}
            </span>
            <div className="mt-1.5 text-xs text-muted-foreground">{bandMeaning}</div>
          </div>
        </div>

        {/* 3 High-Impact Metrics Tiles */}
        <div onClick={onOpen} className="cursor-pointer grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-xl border border-border/70 bg-muted/15 p-2.5 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Outreach</div>
            <div className="text-base font-bold tabular-nums text-foreground">
              {outreachVolume?.currentValue ?? "—"}
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/15 p-2.5 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1st Touch</div>
            <div className="text-base font-bold tabular-nums text-accent">
              {timeToFirstTouch ? `${timeToFirstTouch.currentValue}d` : "—"}
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/15 p-2.5 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Proactive</div>
            <div className="text-base font-bold tabular-nums text-foreground">
              {proactiveSourcing?.currentValue ?? "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Escalated Items Banner */}
      {myEscalations.length > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenEscalated();
          }}
          className="flex w-full items-center justify-between rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning font-semibold hover:bg-warning/20 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-warning animate-pulse" />
            {myEscalations.length} escalated {myEscalations.length === 1 ? "item" : "items"} unresolved
          </span>
          <span className="text-[11px] underline">Inspect →</span>
        </button>
      )}
    </div>
  );
}
