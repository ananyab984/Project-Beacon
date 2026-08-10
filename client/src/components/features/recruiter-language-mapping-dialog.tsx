import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useRecruiters,
  addNewRecruiter,
  deleteRecruiter,
  useRecruiterLanguageMappings,
  updateRecruiterLanguages,
} from "@/lib/g3-mock";
import { Users, Plus, X, Check, Info, UserPlus, Trash2 } from "lucide-react";
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

export function RecruiterLanguageMappingDialog({ open, onOpenChange }: RecruiterLanguageMappingDialogProps) {
  const recruiters = useRecruiters();
  const mappings = useRecruiterLanguageMappings();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLangInput, setNewLangInput] = useState("");

  // State for + Add Recruiter form
  const [showAddRecruiterForm, setShowAddRecruiterForm] = useState(false);
  const [newRecruiterName, setNewRecruiterName] = useState("");
  const [selectedInitialLangs, setSelectedInitialLangs] = useState<string[]>([]);

  const handleCreateRecruiter = () => {
    if (!newRecruiterName.trim()) {
      toast.error("Please enter recruiter name");
      return;
    }
    const created = addNewRecruiter(newRecruiterName.trim(), selectedInitialLangs);
    toast.success(`Recruiter "${created.name}" added successfully! UI updated.`);
    setNewRecruiterName("");
    setSelectedInitialLangs([]);
    setShowAddRecruiterForm(false);
  };

  const handleAddLanguage = (recruiterId: string, langToAdd: string) => {
    const trimmed = langToAdd.trim();
    if (!trimmed) return;
    const current = mappings.find((m) => m.recruiter_id === recruiterId)?.languages || [];
    if (!current.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      updateRecruiterLanguages(recruiterId, [...current, trimmed]);
      toast.success(`Added "${trimmed}" to recruiter profile`);
    }
    setNewLangInput("");
  };

  const handleRemoveLanguage = (recruiterId: string, langToRemove: string) => {
    const current = mappings.find((m) => m.recruiter_id === recruiterId)?.languages || [];
    const updated = current.filter((l) => l !== langToRemove);
    updateRecruiterLanguages(recruiterId, updated);
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
              <Button size="sm" onClick={handleCreateRecruiter} className="h-7 text-xs bg-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5 mr-1" /> Add to Team
              </Button>
            </div>
          </div>
        )}

        {/* Recruiters List */}
        <div className="mt-4 space-y-4">
          {recruiters.filter((r) => r.role !== "contractor").map((recruiter) => {
            const currentMapping = mappings.find((m) => m.recruiter_id === recruiter.id);
            const mappedLangs = currentMapping?.languages || [];

            return (
              <div key={recruiter.id} className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-full text-white font-bold text-sm"
                      style={{ background: `oklch(0.55 0.18 ${recruiter.avatar_hue}deg)` }}
                    >
                      {recruiter.name[0]}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{recruiter.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {mappedLangs.length} language{mappedLangs.length !== 1 ? "s" : ""} associated · {recruiter.kpis.overall_score}% score
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
                        if (confirm(`Are you sure you want to delete ${recruiter.name} from the recruiter roster?`)) {
                          deleteRecruiter(recruiter.id);
                          toast.success(`Removed recruiter ${recruiter.name}`);
                        }
                      }}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title={`Delete ${recruiter.name}`}
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
                          onClick={() => handleRemoveLanguage(recruiter.id, lang)}
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
                          onClick={() => handleAddLanguage(recruiter.id, lang)}
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
                            handleAddLanguage(recruiter.id, newLangInput);
                          }
                        }}
                        className="h-8 text-xs flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAddLanguage(recruiter.id, newLangInput)}
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
