import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, UserCheck, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { GoogleSheetsSyncSection } from "@/components/features/google-sheets-sync-section";
import { api } from "@/lib/api";
import type { ApiUser } from "@/lib/api-types";

const EVENT = "g3:open-client-demand";
export const openClientDemand = () => window.dispatchEvent(new Event(EVENT));

const STANDARD_LANGUAGES = [
  // Region 1 — East and South Asia
  "Bengali", "Cantonese", "Chinese (Simplified)", "Chinese (Traditional)", "Gujarati",
  "Hindi", "Indonesian", "Japanese", "Kannada", "Korean", "Malay", "Malayalam", "Marathi",
  "Odia", "Punjabi", "Tamil", "Telugu", "Thai", "Urdu", "Vietnamese",
  // Region 2 — Finno-Ugric, Slavic & Turkic
  "Bulgarian", "Croatian", "Czech", "Finnish", "Hungarian", "Kazakh", "Polish",
  "Russian", "Slovak", "Slovenian", "Turkish", "Ukrainian",
  // Region 3 — Germanic Languages
  "Danish", "Dutch", "German", "Icelandic", "Norwegian", "Swedish",
  // Region 4 — Hellenic & Semitic
  "Arabic", "Greek", "Hebrew",
  // Region 5 — Romance Languages
  "Castilian Spanish", "Catalan", "French (Canadian)", "French (Parisian)", "French",
  "Italian", "Portuguese (Brazilian)", "Portuguese (Portugal)", "Romanian", "Spanish (Latin America)", "Spanish (LatAm)",
  // Region 6 — Other / English
  "English", "English (AUS)", "English (Canada)", "English (UK)",
  "Custom..."
];

const STANDARD_SERVICES = [
  "Subtitling",
  "Dubbing",
  "Translation",
  "Voice Over",
  "SDH (Subtitles for Deaf & Hard of Hearing)",
  "Audio Description (AD)",
  "Localization QA",
  "AI Post-editing",
  "Transcreation",
  "Quality Control",
  "Interpretation",
  "Transcription",
  "Closed Captioning",
  "Custom..."
];

type ServiceRow = {
  id: string;
  service: string;
  customService?: string;
  headcount: string;
};

type LanguageBlock = {
  id: string;
  language: string;
  customLanguage?: string;
  assignedRecruiterId?: string;
  customRecruiterName?: string;
  customRecruiterEmail?: string;
  services: ServiceRow[];
};

const uid = () => Math.random().toString(36).slice(2, 9);

const createEmptyServiceRow = (): ServiceRow => ({
  id: uid(),
  service: "Subtitling",
  headcount: "1",
});

/** Auto-suggest a recruiter for a language based on their `languages` list. */
function findMappedRecruiterId(lang: string, recruiters: ApiUser[]): string | undefined {
  if (!lang || lang === "Custom...") return undefined;
  const clean = lang.trim().toLowerCase();
  const found = recruiters.find((u) =>
    (u.languages ?? []).some((l) => {
      const target = l.trim().toLowerCase();
      return target === clean || clean.includes(target) || target.includes(clean);
    })
  );
  return found?.id;
}

export function ClientDemandDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [languageBlocks, setLanguageBlocks] = useState<LanguageBlock[]>([]);
  const [priority, setPriority] = useState("STANDARD");
  const [dueDate, setDueDate] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: recruitersData } = useQuery({ queryKey: ["users", "RECRUITER"], queryFn: () => api.getUsers("RECRUITER") });
  const recruiters = recruitersData?.users ?? [];

  const createInitialLanguageBlock = (): LanguageBlock => {
    const defaultLang = "Spanish (LatAm)";
    const mappedRec = findMappedRecruiterId(defaultLang, recruiters);
    return {
      id: uid(),
      language: defaultLang,
      assignedRecruiterId: mappedRec || "unassigned",
      services: [createEmptyServiceRow()],
    };
  };

  useEffect(() => {
    if (languageBlocks.length === 0) {
      setLanguageBlocks([createInitialLanguageBlock()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recruiters.length]);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);

  // Auto-fill recruiter for unassigned blocks whenever the recruiter list updates or dialog opens
  useEffect(() => {
    if (open) {
      setLanguageBlocks(prev =>
        prev.map(b => {
          if (b.assignedRecruiterId && b.assignedRecruiterId !== "unassigned") return b;
          const actualLang = (b.language === "Custom..." ? b.customLanguage : b.language) || "";
          const autoRec = findMappedRecruiterId(actualLang, recruiters);
          return autoRec ? { ...b, assignedRecruiterId: autoRec } : b;
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recruiters.length]);

  const reset = () => {
    setClientName("");
    setLanguageBlocks([createInitialLanguageBlock()]);
    setPriority("STANDARD");
    setDueDate("");
    setContactName("");
    setContactEmail("");
    setNotes("");
  };

  const addLanguageBlock = () => {
    const defaultLang = "Spanish (LatAm)";
    const mappedRec = findMappedRecruiterId(defaultLang, recruiters);
    setLanguageBlocks(prev => [
      ...prev,
      {
        id: uid(),
        language: defaultLang,
        assignedRecruiterId: mappedRec || "unassigned",
        services: [createEmptyServiceRow()],
      },
    ]);
  };

  const removeLanguageBlock = (blockId: string) => {
    setLanguageBlocks(prev => prev.filter(b => b.id !== blockId));
  };

  const updateLanguageBlock = (blockId: string, patch: Partial<LanguageBlock>) => {
    setLanguageBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...patch } : b));
  };

  const addServiceRow = (blockId: string) => {
    setLanguageBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      return { ...b, services: [...b.services, createEmptyServiceRow()] };
    }));
  };

  const removeServiceRow = (blockId: string, rowId: string) => {
    setLanguageBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      if (b.services.length <= 1) return b;
      return { ...b, services: b.services.filter(s => s.id !== rowId) };
    }));
  };

  const updateServiceRow = (blockId: string, rowId: string, patch: Partial<ServiceRow>) => {
    setLanguageBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        services: b.services.map(s => s.id === rowId ? { ...s, ...patch } : s),
      };
    }));
  };

  const submit = async () => {
    if (!clientName.trim()) {
      toast.error("Client name is required.");
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      toast.error("Enter a valid contact email or leave it empty.");
      return;
    }

    // Validate language blocks
    for (let i = 0; i < languageBlocks.length; i++) {
      const block = languageBlocks[i];
      const actualLang = (block.language === "Custom..." ? block.customLanguage : block.language)?.trim();
      if (!actualLang) {
        toast.error(`Please select or enter a language for block ${i + 1}.`);
        return;
      }

      const cleanedServices = block.services
        .map(r => ({
          ...r,
          resolvedService: (r.service === "Custom..." ? r.customService : r.service)?.trim(),
        }))
        .filter(r => r.resolvedService);

      if (cleanedServices.length === 0) {
        toast.error(`At least one service is required for language "${actualLang}".`);
        return;
      }

      const serviceNames = cleanedServices.map(r => r.resolvedService!.toLowerCase());
      if (new Set(serviceNames).size !== serviceNames.length) {
        toast.error(`Duplicate services found in "${actualLang}" — each service must be unique.`);
        return;
      }

      const badHeadcount = cleanedServices.find(r => !r.headcount || Number(r.headcount) < 1);
      if (badHeadcount) {
        toast.error(`Enter a headcount for "${badHeadcount.resolvedService}" in ${actualLang}.`);
        return;
      }

      if (block.assignedRecruiterId === "custom") {
        if (!block.customRecruiterName?.trim() || !block.customRecruiterEmail?.trim()) {
          toast.error(`Enter a name and email for the custom recruiter in language block ${i + 1}.`);
          return;
        }
      }
    }

    const trimmedClient = clientName.trim();

    setSubmitting(true);
    try {
      let totalRequirements = 0;
      let totalAssignments = 0;

      // The backend only accepts one language per createClientDemand call, so
      // loop through blocks sequentially (each creates/updates the same client
      // by name and adds its own ClientDemand + Requirement rows in one txn).
      for (const block of languageBlocks) {
        const actualLang = (block.language === "Custom..." ? block.customLanguage : block.language)!.trim();
        const services = block.services
          .map(r => ({
            service: (r.service === "Custom..." ? r.customService : r.service)!.trim(),
            needed: Number(r.headcount) || 1,
          }));

        // Resolve (or create) the recruiter assigned to this language block.
        let recruiterId: string | undefined;
        if (block.assignedRecruiterId === "custom") {
          const { user } = await api.createUser({
            name: block.customRecruiterName!.trim(),
            email: block.customRecruiterEmail!.trim(),
            role: "RECRUITER",
            languages: [actualLang],
          });
          recruiterId = user.id;
        } else if (block.assignedRecruiterId && block.assignedRecruiterId !== "unassigned") {
          recruiterId = block.assignedRecruiterId;
        }

        const { requirements } = await api.createClientDemand({
          clientName: trimmedClient,
          language: actualLang,
          services,
          priority,
          deadline: dueDate || undefined,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          notes: notes.trim() || undefined,
        });

        totalRequirements += requirements.length;

        if (recruiterId) {
          const recId = recruiterId;
          await Promise.all(requirements.map(r => api.assignRequirement(r.id, recId)));
          totalAssignments += 1;
        }
      }

      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["requirements"] });
      queryClient.invalidateQueries({ queryKey: ["client-demands"] });
      queryClient.invalidateQueries({ queryKey: ["users", "RECRUITER"] });

      toast.success(`Client demand created for ${trimmedClient}! Added ${totalRequirements} requirements across ${languageBlocks.length} language(s) with ${totalAssignments} recruiter assignment(s).`);

      reset();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to create client demand");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" /> Add Client Intake &amp; Language Requirements
          </DialogTitle>
          <DialogDescription className="text-xs">
            Create client demands organized by language and service. Recruiters auto-populate based on language mapping and can be customized per language.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-foreground font-sans">
          {/* Section A: Google Sheets Sync Component */}
          <GoogleSheetsSyncSection />

          {/* Section B: Client Details */}
          <div className="space-y-4 rounded-xl border border-border/80 bg-muted/10 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-accent">1. Client Overview</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Client Name *</Label>
                <Input
                  placeholder="e.g. Netflix, Ubisoft, Keywords Studios..."
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  className="h-9 text-xs bg-card"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-9 text-xs bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">
                      <span className="flex items-center gap-1.5 text-destructive font-semibold">Critical P1</span>
                    </SelectItem>
                    <SelectItem value="HIGH">
                      <span className="flex items-center gap-1.5 text-warning font-semibold">High P2</span>
                    </SelectItem>
                    <SelectItem value="STANDARD">Standard P3</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Target Client Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="h-9 text-xs bg-card"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Client Contact Person</Label>
                <Input
                  placeholder="e.g. Sarah Jenkins"
                  value={contactName}
                  onChange={e => setContactName(e.target.value)}
                  className="h-8 text-xs bg-card"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Client Contact Email</Label>
                <Input
                  type="email"
                  placeholder="sarah@client.com"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  className="h-8 text-xs bg-card"
                />
              </div>
            </div>
          </div>

          {/* Section C: Language Blocks with Per-Language Recruiter Selectors */}
          <div className="space-y-4 rounded-xl border border-border/80 bg-muted/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-accent">2. Language &amp; Service Breakdowns</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Selecting a language auto-fills the mapped recruiter. You can also manually change recruiters per language.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLanguageBlock} className="h-8 gap-1.5 text-xs font-semibold bg-card">
                <Plus className="h-3.5 w-3.5" /> + Add Language
              </Button>
            </div>

            <div className="space-y-4">
              {languageBlocks.map((block, bIdx) => {
                const currentLang = (block.language === "Custom..." ? block.customLanguage : block.language) || "";
                return (
                  <div key={block.id} className="rounded-lg border border-border bg-card p-3.5 space-y-3 shadow-sm">
                    {/* Language Block Header: Language Select + Recruiter Selector per Language */}
                    <div className="space-y-2 border-b border-border/50 pb-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex-1 flex items-center gap-2 min-w-[220px]">
                          <span className="text-xs font-semibold text-foreground shrink-0">Language #{bIdx + 1}:</span>
                          <Select
                            value={block.language}
                            onValueChange={(val) => {
                              const autoRec = findMappedRecruiterId(val, recruiters);
                              updateLanguageBlock(block.id, {
                                language: val,
                                ...(autoRec ? { assignedRecruiterId: autoRec } : {}),
                              });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs flex-1 bg-card">
                              <SelectValue placeholder="Select Language" />
                            </SelectTrigger>
                            <SelectContent>
                              {STANDARD_LANGUAGES.map(lang => (
                                <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {block.language === "Custom..." && (
                            <Input
                              value={block.customLanguage || ""}
                              onChange={e => {
                                const customVal = e.target.value;
                                const autoRec = findMappedRecruiterId(customVal, recruiters);
                                updateLanguageBlock(block.id, {
                                  customLanguage: customVal,
                                  ...(autoRec ? { assignedRecruiterId: autoRec } : {}),
                                });
                              }}
                              placeholder="Type custom language..."
                              className="h-8 text-xs flex-1"
                            />
                          )}
                        </div>

                        {/* Recruiter Selector for THIS Language (Pre-filled based on mapping, but fully editable) */}
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-muted-foreground shrink-0">Recruiter:</span>
                          <Select
                            value={block.assignedRecruiterId || "unassigned"}
                            onValueChange={(val) => updateLanguageBlock(block.id, { assignedRecruiterId: val })}
                          >
                            <SelectTrigger className="h-8 text-xs w-48 bg-card border-border">
                              <SelectValue placeholder="Assign recruiter">
                                {block.assignedRecruiterId === "custom" ? (
                                  <span className="flex items-center gap-1 font-medium text-primary">
                                    <UserPlus className="h-3 w-3 shrink-0" /> Custom Recruiter
                                  </span>
                                ) : block.assignedRecruiterId && block.assignedRecruiterId !== "unassigned" ? (
                                  <span className="flex items-center gap-1.5 font-medium truncate">
                                    <UserCheck className="h-3 w-3 text-accent shrink-0" />
                                    {recruiters.find(r => r.id === block.assignedRecruiterId)?.name}
                                  </span>
                                ) : (
                                  <span className="font-normal text-muted-foreground">Unassigned</span>
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value="unassigned">
                                <span className="font-semibold text-warning">Unassigned</span>
                              </SelectItem>
                              {recruiters.map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  <span className="flex items-center justify-between gap-2 w-full font-medium text-foreground">
                                    <span className="font-semibold text-foreground">{r.name}</span>
                                  </span>
                                </SelectItem>
                              ))}
                              <SelectItem value="custom">
                                <span className="flex items-center gap-1.5 text-primary font-semibold">
                                  <UserPlus className="h-3 w-3" /> + Custom / Add New...
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          {languageBlocks.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLanguageBlock(block.id)}
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                              title="Remove Language Block"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Custom Recruiter Input Fields if selected */}
                      {block.assignedRecruiterId === "custom" && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 pl-1">
                          <UserPlus className="h-3.5 w-3.5 text-primary shrink-0" />
                          <Input
                            placeholder={`Recruiter name for ${currentLang || "Language"}…`}
                            value={block.customRecruiterName || ""}
                            onChange={e => updateLanguageBlock(block.id, { customRecruiterName: e.target.value })}
                            className="h-7 text-xs bg-card flex-1 min-w-40 border-primary/40"
                            autoFocus
                          />
                          <Input
                            type="email"
                            placeholder="Recruiter email…"
                            value={block.customRecruiterEmail || ""}
                            onChange={e => updateLanguageBlock(block.id, { customRecruiterEmail: e.target.value })}
                            className="h-7 text-xs bg-card flex-1 min-w-40 border-primary/40"
                          />
                        </div>
                      )}
                    </div>

                    {/* Service rows inside Language Block */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                        <span>Services for {currentLang || "Language"}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => addServiceRow(block.id)} className="h-6 gap-1 text-[11px]">
                          <Plus className="h-3 w-3" /> Add Service
                        </Button>
                      </div>

                      {block.services.map((row) => (
                        <div key={row.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-2">
                          <Select
                            value={row.service}
                            onValueChange={(val) => updateServiceRow(block.id, row.id, { service: val })}
                          >
                            <SelectTrigger className="h-8 text-xs flex-1 min-w-36 bg-card">
                              <SelectValue placeholder="Select Service" />
                            </SelectTrigger>
                            <SelectContent>
                              {STANDARD_SERVICES.map(s => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {row.service === "Custom..." && (
                            <Input
                              value={row.customService || ""}
                              onChange={e => updateServiceRow(block.id, row.id, { customService: e.target.value })}
                              placeholder="Custom service..."
                              className="h-8 text-xs flex-1"
                            />
                          )}

                          <div className="flex items-center gap-1.5 w-28">
                            <Label className="text-[10px] uppercase text-muted-foreground shrink-0">Seats:</Label>
                            <Input
                              type="number"
                              min="1"
                              value={row.headcount}
                              onChange={e => updateServiceRow(block.id, row.id, { headcount: e.target.value })}
                              className="h-8 text-xs bg-card tabular-nums"
                            />
                          </div>

                          {block.services.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeServiceRow(block.id, row.id)}
                              className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section D: Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Notes / Scope Details (Optional)</Label>
            <Textarea
              placeholder="e.g. Special SLA requirements, specific domain expertise needed, or billing details..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="h-16 text-xs bg-card"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-9 text-xs" disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} className="h-9 text-xs bg-primary text-primary-foreground font-semibold shadow-xs gap-1.5" disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Submitting..." : "Submit Client Demand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
