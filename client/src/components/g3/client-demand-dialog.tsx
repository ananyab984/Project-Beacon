import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Upload, RefreshCw, LinkIcon, CheckCircle2, Loader2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  syncFromGoogleSheet,
  getSheetSyncState,
  setSheetUrl,
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

const createEmptyLanguageBlock = (): LanguageBlock => ({
  id: uid(),
  language: "Spanish (LatAm)",
  assignedRecruiterId: "unassigned",
  services: [createEmptyServiceRow()],
});

export function ClientDemandDialog() {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [languageBlocks, setLanguageBlocks] = useState<LanguageBlock[]>([createEmptyLanguageBlock()]);
  const [priority, setPriority] = useState("standard");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");

  const recruiters = useRecruiters();
  const clients = useClients();
  const mappings = useRecruiterLanguageMappings();

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);

  const reset = () => {
    setClientName("");
    setLanguageBlocks([createEmptyLanguageBlock()]);
    setPriority("standard");
    setContactName("");
    setContactEmail("");
    setNotes("");
  };

  const addLanguageBlock = () => {
    setLanguageBlocks(prev => [...prev, createEmptyLanguageBlock()]);
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
          title: `${actualLang} ${sName}`,
          language: actualLang,
          service: sName,
          project_name: notes.trim() ? notes.trim().slice(0, 30) : undefined,
          headcount_needed: seats,
          filled: 0,
          gap: seats,
          priority: priority as "standard" | "high" | "critical",
          status: assignedRecId ? "active" : "unassigned",
          recruiter_id: assignedRecId,
          notes: notes.trim() || undefined,
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

    addClientDemand({
      client: trimmedClient,
      language: allLanguages.join(", "),
      services: allServices,
      headcount_needed: totalHeadcount,
      filled: 0,
      gap: totalHeadcount,
      recruiter_id: firstAssignedRecruiterId || "unassigned",
      service_breakdown: fullServiceBreakdown,
      priority: priority as "standard" | "high" | "critical",
      status: "active",
      contact_name: contactName.trim() || undefined,
      contact_email: contactEmail.trim() || undefined,
      notes: notes.trim() || undefined,
    });

    toast.success(
      `Registered demand for ${trimmedClient}: ${fullServiceBreakdown.length} requirement row${fullServiceBreakdown.length > 1 ? "s" : ""} added to table!`
    );
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); setOpen(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Client Demand</DialogTitle>
          <DialogDescription>
            Register client requirements, specify language &amp; recruiter assignments, and service headcount.
          </DialogDescription>
        </DialogHeader>

        <BulkImportStrip />
        <GoogleSheetSyncStrip />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client name" required>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Netflix" maxLength={100} />
          </Field>
          <Field label="Primary contact">
            <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="e.g. Ava Chen" maxLength={100} />
          </Field>

          <Field label="Contact Email">
            <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="e.g. ava@netflix.com" />
          </Field>
          <Field label="Priority">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* Dynamic Language & Services Section with Recruiter per Language */}
          <div className="sm:col-span-2 space-y-4 rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
                  Language &amp; Recruiter Assignments <span className="text-primary">*</span>
                </Label>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLanguageBlock} className="h-7 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add Language Block
              </Button>
            </div>

            {languageBlocks.map((block, bIdx) => {
              const currentLang = block.language === "Custom..." ? (block.customLanguage || "") : block.language;

              return (
                <div key={block.id} className="rounded-lg border border-border bg-card p-3 space-y-3 shadow-sm">
                  {/* Language Block Header: Language Select + Recruiter Selector per Language */}
                  <div className="space-y-2 border-b border-border/50 pb-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex-1 flex items-center gap-2 min-w-[200px]">
                        <span className="text-xs font-semibold text-foreground shrink-0">Language #{bIdx + 1}:</span>
                        <Select
                          value={block.language}
                          onValueChange={(val) => updateLanguageBlock(block.id, { language: val })}
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
                            onChange={e => updateLanguageBlock(block.id, { customLanguage: e.target.value })}
                            placeholder="Custom language"
                            className="h-8 text-xs flex-1"
                          />
                        )}
                      </div>

                      {/* Recruiter Selector for THIS Language */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground shrink-0">Recruiter:</span>
                        <Select
                          value={block.assignedRecruiterId || "unassigned"}
                          onValueChange={(val) => updateLanguageBlock(block.id, { assignedRecruiterId: val })}
                        >
                          <SelectTrigger className="h-8 text-xs w-44 bg-card">
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
                            placeholder="Custom service name"
                            className="h-8 text-xs flex-1 min-w-28"
                          />
                        )}

                        <Input
                          type="number"
                          min={1}
                          max={9999}
                          value={row.headcount}
                          onChange={e => updateServiceRow(block.id, row.id, { headcount: e.target.value })}
                          placeholder="Seats"
                          className="h-8 w-24 text-xs bg-card"
                        />

                        {block.services.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeServiceRow(block.id, row.id)}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            title="Remove Service Row"
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

          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Contract terms, exclusivity, timelines…" rows={3} maxLength={1000} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add Client Demand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}{required && <span className="text-primary"> *</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function BulkImportStrip() {
  const inputRef = useRef<HTMLInputElement>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = text.split(/\r?\n/).filter(Boolean);
      const dataRows = Math.max(0, rows.length - 1);
      toast.success(`Parsed ${dataRows} client${dataRows === 1 ? "" : "s"} from ${f.name}`);
    };
    reader.onerror = () => toast.error("Could not read the file.");
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-border bg-card/60 p-3 text-xs">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-accent" />
        <div>
          <div className="font-semibold text-foreground">Bulk CSV / Excel Import</div>
          <div className="text-[11px] text-muted-foreground">Upload CSV file with client demands.</div>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="h-7 text-xs">
        Choose File
      </Button>
    </div>
  );
}

function GoogleSheetSyncStrip() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const state = getSheetSyncState();

  const handleSync = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setSheetUrl(url.trim());
    const res = await syncFromGoogleSheet();
    setLoading(false);
    if (res && (res.added > 0 || res.updated > 0)) {
      toast.success(`Synced ${res.added + res.updated} client demands from Google Sheet!`);
    } else {
      toast.info("Google Sheet synced — no new rows.");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold flex items-center gap-1.5 text-foreground">
          <LinkIcon className="h-3.5 w-3.5 text-accent" /> Live Google Sheet Sync
        </span>
        {state.lastSynced && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-accent" /> Synced {new Date(state.lastSynced).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Paste Google Sheet public link..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-8 text-xs bg-card flex-1"
        />
        <Button size="sm" disabled={loading} onClick={handleSync} className="h-8 text-xs gap-1">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync Now
        </Button>
      </div>
    </div>
  );
}