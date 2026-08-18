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

export const STANDARD_SERVICES = [
  "Dubbing",
  "Subtitling",
  "Audio Description",
  "SDH",
  "CC",
  "Conform",
  "Prelude",
  "Scripting",
  "Translation",
  "Voice Over",
  "Localization QA",
  "AI Post-editing",
  "Quality Control",
  "Interpretation",
  "Transcription",
  "Custom..."
];

export const REGION_LANGUAGE_MAPPINGS: Record<string, { recruiter?: string; contractor?: string; region: string }> = {
  // Region 1 — East and South Asia
  "Bengali": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Cantonese": { recruiter: "Divya", contractor: "Sharmistha", region: "Region 1 – East and South Asia" },
  "Chinese (Simplified)": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Chinese (Traditional)": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Gujarati": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Hindi": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Indonesian": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Japanese": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Kannada": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Korean": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Malay": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Malayalam": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Marathi": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Odia": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Punjabi": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Tamil": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Telugu": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Thai": { recruiter: "Divya", region: "Region 1 – East and South Asia" },
  "Urdu": { recruiter: "Mathu", region: "Region 1 – East and South Asia" },
  "Vietnamese": { recruiter: "Divya", region: "Region 1 – East and South Asia" },

  // Region 2 — Finno-Ugric, Slavic & Turkic
  "Bulgarian": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Croatian": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Czech": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Finnish": { contractor: "Sharmistha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Hungarian": { contractor: "Sharmistha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Kazakh": { contractor: "Sharmistha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Polish": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Russian": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Slovak": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Slovenian": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Turkish": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },
  "Ukrainian": { contractor: "Varsha", region: "Region 2 – Finno-Ugric, Slavic & Turkic" },

  // Region 3 — Germanic Languages
  "Danish": { contractor: "Sunaina", region: "Region 3 – Germanic Languages" },
  "Dutch": { contractor: "Sunaina", region: "Region 3 – Germanic Languages" },
  "German": { contractor: "Sunaina", region: "Region 3 – Germanic Languages" },
  "Icelandic": { contractor: "Sharmistha", region: "Region 3 – Germanic Languages" },
  "Norwegian": { contractor: "Sharmistha", region: "Region 3 – Germanic Languages" },
  "Swedish": { contractor: "Sunaina", region: "Region 3 – Germanic Languages" },

  // Region 4 — Hellenic & Semitic
  "Arabic": { contractor: "Sunaina", region: "Region 4 – Hellenic & Semitic" },
  "Greek": { contractor: "Sunaina", region: "Region 4 – Hellenic & Semitic" },
  "Hebrew": { contractor: "Sharmistha", region: "Region 4 – Hellenic & Semitic" },

  // Region 5 — Romance Languages
  "Castilian Spanish": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "Catalan": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "French (Canadian)": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "French (Parisian)": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "French": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "Italian": { recruiter: "Divya", region: "Region 5 – Romance Languages" },
  "Portuguese (Brazilian)": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "Portuguese (Portugal)": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "Romanian": { contractor: "Sunaina", region: "Region 5 – Romance Languages" },
  "Spanish (Latin America)": { contractor: "Sharmistha", region: "Region 5 – Romance Languages" },
  "Spanish (LatAm)": { contractor: "Sharmistha", region: "Region 5 – Romance Languages" },
  "English": { recruiter: "Divya", region: "Region 6 – Other / English" },
  "English (AUS)": { recruiter: "Divya", region: "Region 6 – Other / English" },
  "English (Canada)": { recruiter: "Mathu", region: "Region 6 – Other / English" },
  "English (UK)": { recruiter: "Mathu", region: "Region 6 – Other / English" },
};

type ServiceRow = {
  id: string;
  service: string;
  customService?: string;
  headcount: string;
};

type LanguageBlock = {
  id: string;
  sourceLanguage: string;
  language: string;
  customLanguage?: string;
  assignedRecruiterId?: string;
  customRecruiterName?: string;
  customRecruiterEmail?: string;
  episodeLength?: string;
  numberOfEpisodes?: string;
  notes?: string;
  services: ServiceRow[];
};

const uid = () => Math.random().toString(36).slice(2, 9);

const createEmptyServiceRow = (): ServiceRow => ({
  id: uid(),
  service: "Dubbing",
  headcount: "1",
});

function findMappedRecruiterId(lang: string, allUsers: ApiUser[]): string | undefined {
  if (!lang || lang === "Custom...") return undefined;
  const clean = lang.trim();
  const mapping = REGION_LANGUAGE_MAPPINGS[clean];
  if (mapping) {
    const targetName = (mapping.recruiter || mapping.contractor || "").toLowerCase();
    if (targetName) {
      const match = allUsers.find((u) => u.name.toLowerCase().includes(targetName));
      if (match) return match.id;
    }
  }
  const cleanLower = clean.toLowerCase();
  const found = allUsers.find((u) =>
    (u.languages ?? []).some((l) => {
      const target = l.trim().toLowerCase();
      return target === cleanLower || cleanLower.includes(target) || target.includes(cleanLower);
    })
  );
  return found?.id;
}

export function ClientDemandDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [requestedByPm, setRequestedByPm] = useState("");
  const [pmEmail, setPmEmail] = useState("");
  const [dateOfRequest, setDateOfRequest] = useState(new Date().toISOString().split("T")[0]);
  const [contentType, setContentType] = useState("Series");
  const [customContentType, setCustomContentType] = useState("");
  const [priority, setPriority] = useState("STANDARD");
  const [targetOnboardingDate, setTargetOnboardingDate] = useState("");
  const [projectGoLiveDate, setProjectGoLiveDate] = useState("");
  const [languageBlocks, setLanguageBlocks] = useState<LanguageBlock[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: usersData } = useQuery({ queryKey: ["users", "all"], queryFn: () => api.getUsers() });
  const allUsers = usersData?.users ?? [];
  const recruiters = allUsers.filter((u) => u.role === "RECRUITER" || u.role === "CONTRACTOR");

  const createInitialLanguageBlock = (): LanguageBlock => {
    const defaultLang = "Hindi";
    const mappedRec = findMappedRecruiterId(defaultLang, allUsers);
    return {
      id: uid(),
      sourceLanguage: "English",
      language: defaultLang,
      assignedRecruiterId: mappedRec || "unassigned",
      episodeLength: "45",
      numberOfEpisodes: "10",
      notes: "",
      services: [createEmptyServiceRow()],
    };
  };

  useEffect(() => {
    if (languageBlocks.length === 0) {
      setLanguageBlocks([createInitialLanguageBlock()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers.length]);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);

  useEffect(() => {
    if (open) {
      setLanguageBlocks(prev =>
        prev.map(b => {
          if (b.assignedRecruiterId && b.assignedRecruiterId !== "unassigned") return b;
          const actualLang = (b.language === "Custom..." ? b.customLanguage : b.language) || "";
          const autoRec = findMappedRecruiterId(actualLang, allUsers);
          return autoRec ? { ...b, assignedRecruiterId: autoRec } : b;
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allUsers.length]);

  const reset = () => {
    setClientName("");
    setProjectName("");
    setRequestedByPm("");
    setPmEmail("");
    setDateOfRequest(new Date().toISOString().split("T")[0]);
    setContentType("Series");
    setCustomContentType("");
    setPriority("STANDARD");
    setTargetOnboardingDate("");
    setProjectGoLiveDate("");
    setLanguageBlocks([createInitialLanguageBlock()]);
  };

  const addLanguageBlock = () => {
    const defaultLang = "Spanish (LatAm)";
    const mappedRec = findMappedRecruiterId(defaultLang, recruiters);
    setLanguageBlocks(prev => [
      ...prev,
      {
        id: uid(),
        sourceLanguage: "English",
        language: defaultLang,
        assignedRecruiterId: mappedRec || "unassigned",
        episodeLength: "45",
        numberOfEpisodes: "10",
        notes: "",
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
    if (pmEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pmEmail)) {
      toast.error("Enter a valid PM email address or leave it empty.");
      return;
    }

    for (let i = 0; i < languageBlocks.length; i++) {
      const block = languageBlocks[i];
      const actualLang = (block.language === "Custom..." ? block.customLanguage : block.language)?.trim();
      if (!actualLang) {
        toast.error(`Please select or enter a target language for block ${i + 1}.`);
        return;
      }
      const cleanedServices = block.services.map(r => ({ ...r, resolvedService: (r.service === "Custom..." ? r.customService : r.service)?.trim() })).filter(r => r.resolvedService);
      if (cleanedServices.length === 0) {
        toast.error(`At least one service is required for language "${actualLang}".`);
        return;
      }
      if (block.assignedRecruiterId === "custom") {
        if (!block.customRecruiterName?.trim() || !block.customRecruiterEmail?.trim()) {
          toast.error(`Enter name and email for custom recruiter in block ${i + 1}.`);
          return;
        }
      }
    }

    const trimmedClient = clientName.trim();
    const resolvedContentType = contentType === "Other..." ? (customContentType.trim() || "General") : contentType;

    setSubmitting(true);
    try {
      let totalRequirements = 0;
      let totalAssignments = 0;

      for (const block of languageBlocks) {
        const actualLang = (block.language === "Custom..." ? block.customLanguage : block.language)!.trim();
        const services = block.services.map(r => ({
          service: (r.service === "Custom..." ? r.customService : r.service)!.trim(),
          needed: Number(r.headcount) || 1,
        }));

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

        const noteParts: string[] = [];
        if (resolvedContentType) noteParts.push(`Content Type: ${resolvedContentType}`);
        if (dateOfRequest) noteParts.push(`Request Date: ${dateOfRequest}`);
        if (projectGoLiveDate) noteParts.push(`Go-Live Date: ${projectGoLiveDate}`);
        if (block.sourceLanguage) noteParts.push(`Source Language: ${block.sourceLanguage}`);
        if (block.episodeLength) noteParts.push(`File Length: ${block.episodeLength} min`);
        if (block.numberOfEpisodes) noteParts.push(`Episodes/Files: ${block.numberOfEpisodes}`);
        if (block.notes?.trim()) noteParts.push(`Notes: ${block.notes.trim()}`);

        const { requirements } = await api.createClientDemand({
          clientName: trimmedClient,
          projectName: projectName.trim() || undefined,
          language: actualLang,
          services,
          priority,
          deadline: targetOnboardingDate || undefined,
          contactName: requestedByPm.trim() || undefined,
          contactEmail: pmEmail.trim() || undefined,
          notes: noteParts.join(" | ") || undefined,
        });

        totalRequirements += requirements.length;
        if (recruiterId) {
          await Promise.all(requirements.map(r => api.assignRequirement(r.id, recruiterId!)));
          totalAssignments += 1;
        }
      }

      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["requirements"] });
      queryClient.invalidateQueries({ queryKey: ["client-demands"] });
      queryClient.invalidateQueries({ queryKey: ["users", "all"] });

      toast.success(`Client demand created for ${trimmedClient}! Added ${totalRequirements} requirements.`);
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
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary" /> Resource Intake Form — Project &amp; Client Details
          </DialogTitle>
          <DialogDescription className="text-xs">
            Submit resource intake demands aligned with the G3 Resource Intake Form template. Auto-maps recruiters by region and synchronizes with live market pipelines.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-foreground font-sans">
          <GoogleSheetsSyncSection />
          <div className="space-y-4 rounded-xl border border-border/80 bg-muted/10 p-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <div className="text-xs font-bold uppercase tracking-wider text-accent">Section 1: Project &amp; Client Details</div>
              <span className="text-[11px] text-muted-foreground font-medium">Core Requirements</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">a) Client Name *</Label>
                <Input placeholder="e.g. Sample Broadcast Co." value={clientName} onChange={e => setClientName(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">b) Project Name</Label>
                <Input placeholder="e.g. Sample News Series" value={projectName} onChange={e => setProjectName(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">c) Requested By (PM)</Label>
                <Input placeholder="e.g. Ashok PM" value={requestedByPm} onChange={e => setRequestedByPm(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">PM Email Address</Label>
                <Input type="email" placeholder="sample.pm@example.com" value={pmEmail} onChange={e => setPmEmail(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">d) Date of Request</Label>
                <Input type="date" value={dateOfRequest} onChange={e => setDateOfRequest(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">c) Content Type</Label>
                <Select value={contentType} onValueChange={setContentType}>
                  <SelectTrigger className="h-8 text-xs bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTENT_TYPES.map(ct => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}</SelectContent>
                </Select>
                {contentType === "Other..." && <Input placeholder="Specify content type..." value={customContentType} onChange={e => setCustomContentType(e.target.value)} className="h-7 text-[11px] mt-1 bg-card" />}
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">d) Priority Level</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-8 text-xs bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL"><span className="text-destructive font-semibold">Urgent (&lt;15 days)</span></SelectItem>
                    <SelectItem value="HIGH"><span className="text-warning font-semibold">High (15–30 days)</span></SelectItem>
                    <SelectItem value="STANDARD">Standard (&gt;30 days)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">e) Target Onboarding Date</Label>
                <Input type="date" value={targetOnboardingDate} onChange={e => setTargetOnboardingDate(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">f) Project Go-Live Date</Label>
                <Input type="date" value={projectGoLiveDate} onChange={e => setProjectGoLiveDate(e.target.value)} className="h-8 text-xs bg-card" />
              </div>
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-border/80 bg-muted/10 p-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-accent">Section 2: Language &amp; Service Breakdowns</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Specify target languages, services needed, episode volume, and auto-assigned recruiter.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLanguageBlock} className="h-8 gap-1.5 text-xs font-semibold bg-card">
                <Plus className="h-3.5 w-3.5" /> + Add Language Block
              </Button>
            </div>
            <div className="space-y-4">
              {languageBlocks.map((block, bIdx) => {
                return (
                  <div key={block.id} className="rounded-lg border border-border bg-card p-4 space-y-3.5 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-border/50 pb-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] font-medium text-muted-foreground">a) Source Language</Label>
                        <Input value={block.sourceLanguage} onChange={e => updateLanguageBlock(block.id, { sourceLanguage: e.target.value })} placeholder="e.g. English" className="h-8 text-xs bg-background" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-foreground">b) Target Language #{bIdx + 1} *</Label>
                        <Select value={block.language} onValueChange={(val) => { const autoRec = findMappedRecruiterId(val, recruiters); updateLanguageBlock(block.id, { language: val, ...(autoRec ? { assignedRecruiterId: autoRec } : {}) }); }}>
                          <SelectTrigger className="h-8 text-xs bg-background"><SelectValue placeholder="Select Target Language" /></SelectTrigger>
                          <SelectContent>{STANDARD_LANGUAGES.map(lang => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}</SelectContent>
                        </Select>
                        {block.language === "Custom..." && <Input value={block.customLanguage || ""} onChange={e => { const customVal = e.target.value; const autoRec = findMappedRecruiterId(customVal, recruiters); updateLanguageBlock(block.id, { customLanguage: customVal, ...(autoRec ? { assignedRecruiterId: autoRec } : {}) }); }} placeholder="Type custom target language..." className="h-7 text-xs mt-1 bg-background" />}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-medium text-muted-foreground">Assigned Recruiter</Label>
                          {languageBlocks.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => removeLanguageBlock(block.id)} className="h-5 px-1 text-[10px] text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /> Remove Block</Button>}
                        </div>
                        <Select value={block.assignedRecruiterId || "unassigned"} onValueChange={(val) => updateLanguageBlock(block.id, { assignedRecruiterId: val })}>
                          <SelectTrigger className="h-8 text-xs bg-background border-border">
                            <SelectValue placeholder="Assign recruiter">
                              {block.assignedRecruiterId === "custom" ? <span className="flex items-center gap-1 font-medium text-primary"><UserPlus className="h-3 w-3 shrink-0" /> Custom Recruiter</span> : block.assignedRecruiterId && block.assignedRecruiterId !== "unassigned" ? <span className="flex items-center gap-1.5 font-medium truncate"><UserCheck className="h-3 w-3 text-accent shrink-0" /> {recruiters.find(r => r.id === block.assignedRecruiterId)?.name}</span> : <span className="font-normal text-muted-foreground">Unassigned</span>}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="unassigned"><span className="font-semibold text-warning">Unassigned</span></SelectItem>
                            {recruiters.map((r) => <SelectItem key={r.id} value={r.id}><span className="font-semibold text-foreground">{r.name}</span></SelectItem>)}
                            <SelectItem value="custom"><span className="flex items-center gap-1.5 text-primary font-semibold"><UserPlus className="h-3 w-3" /> + Custom / Add New...</span></SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">c) Service Type &amp; d) Resources Needed</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={() => addServiceRow(block.id)} className="h-6 gap-1 text-[11px] font-semibold text-accent hover:text-accent/80 hover:bg-accent/10"><Plus className="h-3 w-3" /> + Add Service</Button>
                      </div>
                      <div className="space-y-2">
                        {block.services.map((row) => (
                          <div key={row.id} className="flex items-center gap-2 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                              <Select value={row.service} onValueChange={(val) => updateServiceRow(block.id, row.id, { service: val })}>
                                <SelectTrigger className="h-8 text-xs bg-background"><SelectValue /></SelectTrigger>
                                <SelectContent>{STANDARD_SERVICES.map(srv => <SelectItem key={srv} value={srv}>{srv}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            {row.service === "Custom..." && <Input placeholder="Custom Service..." value={row.customService || ""} onChange={(e) => updateServiceRow(block.id, row.id, { customService: e.target.value })} className="h-8 text-xs flex-1 bg-background" />}
                            <div className="flex items-center gap-1.5 w-36">
                              <Input type="number" min="1" placeholder="Headcount" value={row.headcount} onChange={(e) => updateServiceRow(block.id, row.id, { headcount: e.target.value })} className="h-8 text-xs text-center bg-background" />
                              <span className="text-[11px] text-muted-foreground">resources</span>
                            </div>
                            {block.services.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => removeServiceRow(block.id, row.id)} className="h-8 px-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 border-t border-border/40">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">e) Episode/File Length (min)</Label>
                        <Input placeholder="e.g. 45" value={block.episodeLength || ""} onChange={e => updateLanguageBlock(block.id, { episodeLength: e.target.value })} className="h-7 text-xs bg-background" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">f) Number of Episodes/Files</Label>
                        <Input placeholder="e.g. 10" value={block.numberOfEpisodes || ""} onChange={e => updateLanguageBlock(block.id, { numberOfEpisodes: e.target.value })} className="h-7 text-xs bg-background" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">g) Any additional information</Label>
                        <Input placeholder="Special dialect, voice tags, notes..." value={block.notes || ""} onChange={e => updateLanguageBlock(block.id, { notes: e.target.value })} className="h-7 text-xs bg-background" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-9 text-xs" disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={submit} className="h-9 text-xs bg-primary text-primary-foreground font-semibold shadow-xs gap-1.5" disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Submitting..." : "Submit Client Demand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
