import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  recruiters,
  useRecruiterLanguageMappings,
  useRequirements,
  assignRequirementRecruiter,
  type Requirement,
} from "@/lib/g3-mock";
import { Search, UserCheck, X, Info, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

interface AssignRecruiterDialogProps {
  requirement: Requirement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignRecruiterDialog({ requirement, open, onOpenChange }: AssignRecruiterDialogProps) {
  const [search, setSearch] = useState("");
  const mappings = useRecruiterLanguageMappings();
  const allRequirements = useRequirements();

  const fullRecruiters = useMemo(() => {
    return recruiters
      .filter((r) => r.role !== "contractor")
      .map((r) => {
        const langs = mappings.find((m) => m.recruiter_id === r.id)?.languages ?? [];
        const activeReqs = allRequirements.filter(
          (req) => req.recruiter_id === r.id && req.status === "active",
        ).length;
        const matchesLang = langs.some((l) =>
          requirement?.language?.toLowerCase().includes(l.toLowerCase()) ||
          l.toLowerCase().includes(requirement?.language?.toLowerCase() ?? ""),
        );
        return { ...r, languages: langs, activeReqs, matchesLang };
      });
  }, [mappings, allRequirements, requirement]);

  const filtered = useMemo(() => {
    if (!search.trim()) return fullRecruiters;
    const q = search.toLowerCase();
    return fullRecruiters.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.languages.some((l) => l.toLowerCase().includes(q)),
    );
  }, [fullRecruiters, search]);

  const isLanguageSearch =
    search.trim().length > 0 &&
    !fullRecruiters.some((r) => r.name.toLowerCase().includes(search.toLowerCase())) &&
    fullRecruiters.some((r) =>
      r.languages.some((l) => l.toLowerCase().includes(search.toLowerCase())),
    );

  const handleSelect = (recruiterId: string) => {
    if (!requirement) return;
    const recruiter = recruiters.find((r) => r.id === recruiterId);
    assignRequirementRecruiter(requirement.id, recruiterId);
    toast.success(`${requirement.title} assigned to ${recruiter?.name}`);
    onOpenChange(false);
    setSearch("");
  };

  const handleUnassign = () => {
    if (!requirement) return;
    assignRequirementRecruiter(requirement.id, undefined);
    toast.info(`${requirement.title} unassigned`);
    onOpenChange(false);
    setSearch("");
  };

  if (!requirement) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSearch(""); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Assign Recruiter</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-medium text-foreground">{requirement.title}</span>
            {" · "}
            <span className="text-accent font-medium">{requirement.language} — {requirement.service}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search by name or language…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Language search hint */}
        {isLanguageSearch && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-primary">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Showing recruiters associated with "<strong>{search}</strong>" — language associations are a search aid only. You can select any recruiter.
            </span>
          </div>
        )}

        {/* Recruiter cards */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No recruiters match your search.</p>
          )}
          {filtered.map((r) => {
            const isCurrentlyAssigned = requirement.recruiter_id === r.id;
            return (
              <div
                key={r.id}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                  isCurrentlyAssigned
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:border-primary/30 hover:bg-muted/40"
                }`}
              >
                {/* Avatar */}
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: `oklch(0.55 0.18 ${r.avatar_hue}deg)` }}
                >
                  {r.name[0]}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-foreground">{r.name}</span>
                    {isCurrentlyAssigned && (
                      <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        Currently Assigned
                      </span>
                    )}
                    {r.matchesLang && !search && (
                      <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        Language match
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {r.languages.slice(0, 4).map((l) => (
                      <span
                        key={l}
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          requirement.language.toLowerCase().includes(l.toLowerCase()) ||
                          l.toLowerCase().includes(requirement.language.toLowerCase())
                            ? "bg-accent/20 text-accent"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {l}
                      </span>
                    ))}
                    {r.languages.length > 4 && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        +{r.languages.length - 4} more
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{r.activeReqs} active requirement{r.activeReqs !== 1 ? "s" : ""}</span>
                    <span className="text-border">·</span>
                    <CheckCircle2 className="h-3 w-3" />
                    <span>{r.kpis.overall_score}% score</span>
                  </div>
                </div>

                {/* Action */}
                <Button
                  size="sm"
                  variant={isCurrentlyAssigned ? "outline" : "default"}
                  className={`shrink-0 text-xs ${isCurrentlyAssigned ? "" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                  onClick={() => isCurrentlyAssigned ? undefined : handleSelect(r.id)}
                  disabled={isCurrentlyAssigned}
                >
                  {isCurrentlyAssigned ? <UserCheck className="h-3.5 w-3.5" /> : "Select"}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          {requirement.recruiter_id ? (
            <button
              onClick={handleUnassign}
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
            >
              <X className="h-3 w-3" /> Remove assignment
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">No recruiter currently assigned</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); onOpenChange(false); }}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
