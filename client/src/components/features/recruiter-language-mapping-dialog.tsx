import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { Users, Plus, X, Check, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface RecruiterLanguageMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COMMON_LANGUAGES = [
  "Tamil", "Telugu", "Malayalam", "Kannada",
  "French", "German", "Spanish (LatAm)", "Spanish (Spain)",
  "Japanese", "Korean", "Mandarin", "Arabic", "Portuguese (BR)",
  "Italian", "Polish", "Swedish", "Dutch", "Hindi", "Turkish", "English",
];

/** ApiUser has no avatar_hue field — derive a stable per-user hue deterministically from the id. */
function avatarHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

export function RecruiterLanguageMappingDialog({ open, onOpenChange }: RecruiterLanguageMappingDialogProps) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["users", "RECRUITER"], queryFn: () => api.getUsers("RECRUITER") });
  const recruiters = data?.users ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLangInput, setNewLangInput] = useState("");

  // State for + Add Recruiter form
  const [showAddRecruiterForm, setShowAddRecruiterForm] = useState(false);
  const [newRecruiterName, setNewRecruiterName] = useState("");
  const [newRecruiterEmail, setNewRecruiterEmail] = useState("");
  const [selectedInitialLangs, setSelectedInitialLangs] = useState<string[]>([]);

  const createUserMutation = useMutation({
    mutationFn: (input: { name: string; email: string; languages: string[] }) =>
      api.createUser({ name: input.name, email: input.email, role: "RECRUITER", languages: input.languages }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] });
      toast.success(
        `Recruiter "${result.user.name}" added. They can now sign up at /signup with ${result.user.email} to set their own password.`,
        { duration: 12000 },
      );
      setNewRecruiterName("");
      setNewRecruiterEmail("");
      setSelectedInitialLangs([]);
      setShowAddRecruiterForm(false);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to add recruiter"),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] }),
    onError: (err: any) => toast.error(err?.message || "Failed to deactivate recruiter"),
  });

  const updateLanguagesMutation = useMutation({
    mutationFn: ({ id, languages }: { id: string; languages: string[] }) => api.updateUserLanguages(id, languages),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] }),
    onError: (err: any) => toast.error(err?.message || "Failed to update languages"),
  });

  const handleCreateRecruiter = () => {
    if (!newRecruiterName.trim()) {
      toast.error("Please enter recruiter name");
      return;
    }
    if (!newRecruiterEmail.trim()) {
      toast.error("Please enter recruiter email");
      return;
    }
    createUserMutation.mutate({
      name: newRecruiterName.trim(),
      email: newRecruiterEmail.trim(),
      languages: selectedInitialLangs,
    });
  };

  const handleAddLanguage = (recruiterId: string, langToAdd: string, current: string[]) => {
    const trimmed = langToAdd.trim();
    if (!trimmed) return;
    if (!current.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      updateLanguagesMutation.mutate({ id: recruiterId, languages: [...current, trimmed] });
      toast.success(`Added "${trimmed}" to recruiter profile`);
    }
    setNewLangInput("");
  };

  const handleRemoveLanguage = (recruiterId: string, langToRemove: string, current: string[]) => {
    updateLanguagesMutation.mutate({ id: recruiterId, languages: current.filter((l) => l !== langToRemove) });
    toast.info(`Removed "${langToRemove}"`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">Recruiter Language Profiles</DialogTitle>
                <DialogDescription className="text-xs">
                  Configure recruiter roster and associated languages.
                </DialogDescription>
              </div>
            </div>

            {/* + Add Recruiter button */}
            <Button
              onClick={() => setShowAddRecruiterForm((s) => !s)}
              size="sm"
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs shadow-xs"
            >
              <UserPlus className="h-3.5 w-3.5" /> + Add Recruiter
            </Button>
          </div>
        </DialogHeader>

        {/* Add Recruiter Inline Form */}
        {showAddRecruiterForm && (
          <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5" /> Register New Recruiter
              </h4>
              <button
                onClick={() => setShowAddRecruiterForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Recruiter Full Name</Label>
              <Input
                placeholder="e.g. Mathumitha, Shivendra, Ananya…"
                value={newRecruiterName}
                onChange={(e) => setNewRecruiterName(e.target.value)}
                className="h-8 text-xs bg-card"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Recruiter Email</Label>
              <Input
                type="email"
                placeholder="name@global3.io"
                value={newRecruiterEmail}
                onChange={(e) => setNewRecruiterEmail(e.target.value)}
                className="h-8 text-xs bg-card"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Select Initial Associated Languages (Optional)</Label>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
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
                      className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
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

            <div className="pt-1 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAddRecruiterForm(false)} className="h-7 text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateRecruiter}
                disabled={createUserMutation.isPending}
                className="h-7 text-xs bg-primary text-primary-foreground"
              >
                <Check className="h-3.5 w-3.5 mr-1" /> {createUserMutation.isPending ? "Adding…" : "Add to Team"}
              </Button>
            </div>
          </div>
        )}

        {/* Recruiters List */}
        <div className="mt-4 space-y-4">
          {recruiters.map((recruiter) => {
            const mappedLangs = recruiter.languages ?? [];

            return (
              <div key={recruiter.id} className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-full text-white font-bold text-sm"
                      style={{ background: `oklch(0.55 0.18 ${avatarHue(recruiter.id)}deg)` }}
                    >
                      {recruiter.name[0]}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{recruiter.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {mappedLangs.length} language{mappedLangs.length !== 1 ? "s" : ""} associated
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(editingId === recruiter.id ? null : recruiter.id)}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {editingId === recruiter.id ? "Done" : "Edit"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Deactivate ${recruiter.name}? Their history is preserved — this is a soft deactivation, not a permanent delete.`)) {
                          deactivateMutation.mutate(recruiter.id);
                          toast.success(`Deactivated recruiter ${recruiter.name}`);
                        }
                      }}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title={`Deactivate ${recruiter.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Mapped language badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {mappedLangs.length > 0 ? (
                    mappedLangs.map((lang) => (
                      <span
                        key={lang}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                      >
                        {lang}
                        <button
                          type="button"
                          onClick={() => handleRemoveLanguage(recruiter.id, lang, mappedLangs)}
                          className="hover:text-destructive transition-colors"
                          title={`Remove ${lang}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No languages associated yet.</span>
                  )}
                </div>

                {/* Edit Language Panel */}
                {editingId === recruiter.id && (
                  <div className="mt-3 rounded-lg border border-border/80 bg-muted/20 p-3 space-y-2.5">
                    <Label className="text-[11px] font-semibold text-foreground uppercase tracking-wide">
                      Add Language
                    </Label>

                    <div className="flex flex-wrap gap-1">
                      {COMMON_LANGUAGES.filter((l) => !mappedLangs.includes(l)).map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => handleAddLanguage(recruiter.id, lang, mappedLangs)}
                          className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center gap-1"
                        >
                          <Plus className="h-3 w-3" /> {lang}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        placeholder="Type custom language…"
                        value={newLangInput}
                        onChange={(e) => setNewLangInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddLanguage(recruiter.id, newLangInput, mappedLangs);
                          }
                        }}
                        className="h-8 text-xs flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAddLanguage(recruiter.id, newLangInput, mappedLangs)}
                        className="h-8 text-xs gap-1"
                      >
                        <Check className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
