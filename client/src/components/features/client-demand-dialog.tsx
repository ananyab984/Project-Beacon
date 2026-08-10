import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { GoogleSheetsSyncSection } from "@/components/features/google-sheets-sync-section";
import {
  addClientDemand,
  addRequirement,
  addClient,
  useClients,
  useRecruiters,
  addNewRecruiter,
  useRecruiterLanguageMappings,
} from "@/lib/g3-mock";

const EVENT = "g3:open-client-demand";
export const openClientDemand = () => window.dispatchEvent(new Event(EVENT));

const STANDARD_LANGUAGES = [
  "Spanish (LatAm)",
  "Japanese",
  "German",
  "French",
  "Portuguese (Brazil)",
  "Italian",
  "Korean",
  "Chinese (Simplified)",
  "Arabic",
  "Dutch",
  "Polish",
  "Swedish",
  "Turkish",
  "Spanish (Spain)",
  "Vietnamese",
  "Hindi",
  "Tamil",
  "Telugu",
  "Malayalam",
  "Custom..."
];

const STANDARD_SERVICES = [
  "Subtitling",
  "Dubbing",
  "Localization QA",
  "AI Post-editing",
  "Translation",
  "Voice Over",
  "Transcreation",
  "Quality Control",
  "Interpretation",
  "Transcription",
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
  services: ServiceRow[];
};

const uid = () => Math.random().toString(36).slice(2, 9);

const createEmptyServiceRow = (): ServiceRow => ({
  id: uid(),
  service: "Subtitling",
  headcount: "1",
});

function findMappedRecruiterId(
  lang: string,
  mappings: { recruiter_id: string; languages: string[] }[]
): string | undefined {
  if (!lang || lang === "Custom...") return undefined;
  const clean = lang.trim().toLowerCase();
  const found = mappings.find(m =>
    m.languages.some(l => l.trim().toLowerCase() === clean)
  );
  return found?.recruiter_id;
}

export function ClientDemandDialog() {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [languageBlocks, setLanguageBlocks] = useState<LanguageBlock[]>([]);
  const [priority, setPriority] = useState("standard");
  const [dueDate, setDueDate] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");

  const recruiters = useRecruiters();
  const clients = useClients();
  const mappings = useRecruiterLanguageMappings();

  const createInitialLanguageBlock = (): LanguageBlock => {
    const defaultLang = "Spanish (LatAm)";
    const mappedRec = findMappedRecruiterId(defaultLang, mappings);
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
  }, [mappings]);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);

  // Auto-fill recruiter for unassigned blocks whenever mappings update or dialog opens
  useEffect(() => {
    if (open) {
      setLanguageBlocks(prev =>
        prev.map(b => {
          if (b.assignedRecruiterId && b.assignedRecruiterId !== "unassigned") return b;
          const actualLang = (b.language === "Custom..." ? b.customLanguage : b.language) || "";
          const autoRec = findMappedRecruiterId(actualLang, mappings);
          return autoRec ? { ...b, assignedRecruiterId: autoRec } : b;
        })
      );
    }
  }, [open, mappings]);

  const reset = () => {
    setClientName("");
    setLanguageBlocks([createInitialLanguageBlock()]);
    setPriority("standard");
    setDueDate("");
    setContactName("");
    setContactEmail("");
    setNotes("");
  };

  const addLanguageBlock = () => {
    const defaultLang = "Spanish (LatAm)";
    const mappedRec = findMappedRecruiterId(defaultLang, mappings);
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

  const submit = () => {
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
    }

    // 1. Resolve or create Client
    const trimmedClient = clientName.trim();
    let clientObj = clients.find((c) => c.name.toLowerCase() === trimmedClient.toLowerCase());
    let clientId = clientObj?.id;
    if (!clientId) {
      clientId = `cl${Date.now()}`;
      addClient({
        name: trimmedClient,
        contact_name: contactName.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    }

    // 2. Process submission into individual Requirements per language-service pair
    const allLanguages: string[] = [];
    const allServices: string[] = [];
    const fullServiceBreakdown: { language: string; service: string; needed: number; filled: number; gap: number }[] = [];
    let totalHeadcount = 0;
    let firstAssignedRecruiterId: string | undefined = undefined;

    languageBlocks.forEach((block) => {
      const actualLang = (block.language === "Custom..." ? block.customLanguage : block.language)!.trim();
      if (!allLanguages.includes(actualLang)) {
        allLanguages.push(actualLang);
      }

      // Resolve recruiter assigned to this specific language block
      let langRecId = block.assignedRecruiterId;
      if (langRecId === "custom" && block.customRecruiterName?.trim()) {
        const newRec = addNewRecruiter(block.customRecruiterName.trim(), [actualLang]);
        langRecId = newRec.id;
      }
      const assignedRecId = langRecId && langRecId !== "unassigned" ? langRecId : undefined;
      if (assignedRecId && !firstAssignedRecruiterId) {
        firstAssignedRecruiterId = assignedRecId;
      }

      block.services.forEach((r) => {
        const sName = (r.service === "Custom..." ? r.customService : r.service)!.trim();
        const seats = Number(r.headcount) || 1;
        if (!allServices.includes(sName)) {
          allServices.push(sName);
        }
        totalHeadcount += seats;

        // Add Requirement directly to _requirements so it updates the main tabular view!
        addRequirement({
          client_id: clientId!,
          title: `${trimmedClient} — ${actualLang} ${sName}`,
          language: actualLang,
          service: sName,
          headcount_needed: seats,
          filled: 0,
          gap: seats,
          priority: (priority as "standard" | "high" | "critical") || "standard",
          status: assignedRecId ? "active" : "unassigned",
          recruiter_id: assignedRecId,
          deadline: dueDate || undefined,
        });

        fullServiceBreakdown.push({
          language: actualLang,
          service: sName,
          needed: seats,
          filled: 0,
          gap: seats,
        });
      });
    });

    // 3. Add Client Demand high-level record
    addClientDemand({
      client: trimmedClient,
      language: allLanguages.join(", "),
      services: allServices,
      headcount_needed: totalHeadcount,
      filled: 0,
      gap: totalHeadcount,
      priority: (priority as "standard" | "high" | "critical") || "standard",
      status: "active",
      recruiter_id: firstAssignedRecruiterId || "r1",
      deadline: dueDate || undefined,
      service_breakdown: fullServiceBreakdown,
    });

    const assignedCount = languageBlocks.filter(b => b.assignedRecruiterId && b.assignedRecruiterId !== "unassigned").length;
    toast.success(`Client demand created for ${trimmedClient}! Added ${fullServiceBreakdown.length} requirements across ${allLanguages.length} language(s) with ${assignedCount} recruiter assignment(s).`);

    reset();
    setOpen(false);
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
                    <SelectItem value="critical">
                      <span className="flex items-center gap-1.5 text-destructive font-semibold">Critical P1</span>
                    </SelectItem>
                    <SelectItem value="urgent">
                      <span className="flex items-center gap-1.5 text-warning font-semibold">Urgent P2</span>
                    </SelectItem>
                    <SelectItem value="standard">Standard P3</SelectItem>
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
                              const autoRec = findMappedRecruiterId(val, mappings);
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
                                const autoRec = findMappedRecruiterId(customVal, mappings);
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
                              {recruiters.filter(r => r.role !== "contractor").map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  <span className="flex items-center justify-between gap-2 w-full font-medium text-foreground">
                                    <span className="font-semibold text-foreground">{r.name}</span>
                                    <span className="text-[10px] text-muted-foreground font-normal">· {r.kpis.overall_score}%</span>
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

                      {/* Custom Recruiter Input Field if selected */}
                      {block.assignedRecruiterId === "custom" && (
                        <div className="flex items-center gap-2 pt-1 pl-1">
                          <UserPlus className="h-3.5 w-3.5 text-primary shrink-0" />
                          <Input
                            placeholder={`Enter recruiter name for ${currentLang || "Language"}…`}
                            value={block.customRecruiterName || ""}
                            onChange={e => updateLanguageBlock(block.id, { customRecruiterName: e.target.value })}
                            className="h-7 text-xs bg-card flex-1 border-primary/40"
                            autoFocus
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
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-9 text-xs">
            Cancel
          </Button>
          <Button type="button" onClick={submit} className="h-9 text-xs bg-primary text-primary-foreground font-semibold shadow-xs">
            Submit Client Demand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
