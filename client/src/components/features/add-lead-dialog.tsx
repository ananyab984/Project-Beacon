import { ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, FileSpreadsheet, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiLead, LeadSource } from "@/lib/api-types";
import { parseCsvLeads } from "@/lib/g3-mock";

const SOURCES = [
  "LinkedIn",
  "ProZ",
  "Ada",
  "ATA",
  "ATAA",
  "Bodalgo",
  "Freelancer",
  "Apollo",
  "Referral",
  "Import",
];

const VALID_SOURCES: LeadSource[] = ["LINKEDIN", "PROZ", "ADA", "ATA", "ATAA", "BODALGO", "FREELANCER", "APOLLO"];

/** Best-effort mapping of a free-text / legacy source string to the LeadSource enum. */
function mapToLeadSource(raw: string | undefined | null): LeadSource {
  if (!raw) return "LINKEDIN";
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "");
  const hit = VALID_SOURCES.find((s) => s === upper || upper.includes(s));
  return hit ?? "LINKEDIN";
}

const LANGUAGES = [
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
];

const SERVICES = [
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
];

export function AddLeadDialog({
  open: controlledOpen,
  setOpen: controlledSetOpen,
  trigger,
}: {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  trigger?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledSetOpen ?? setInternalOpen;
  const [values, setValues] = useState({
    first_name: "",
    full_name: "",
    country_of_residence: "Germany",
    source: "LinkedIn",
    profile_link: "",
    email_address: "",
    contact_number: "",
    reachout_date: "",
    source_language: "English",
    target_language: "German",
    secondary_languages: "French",
    services: "Dubbing",
  });
  const [customService, setCustomService] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const createMutation = useMutation({
    mutationFn: (lead: Partial<ApiLead> & { fullName: string; source: string }) => api.createLead(lead),
    onSuccess: (_res, lead) => {
      toast.success(`Lead ${lead.fullName} added to My Leads!`);
      invalidateLeads();
      setOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to add lead"),
  });

  const bulkCreateMutation = useMutation({
    mutationFn: (rows: Array<Partial<ApiLead> & { fullName: string; source: string }>) => api.bulkCreateLeads(rows),
    onSuccess: (res) => {
      const succeeded = res.results.filter((r) => !!r.leadId).length;
      toast.success(`Imported ${succeeded} of ${res.results.length} rows`);
      invalidateLeads();
      setOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Bulk upload failed"),
  });

  function set(k: string, v: string) {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => ({ ...prev, [k]: "" }));
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!values.full_name.trim()) next.full_name = "Full name is required";
    if (!values.source) next.source = "Source is required";
    if (values.services === "Custom" && !customService.trim()) {
      next.services = "Please enter custom service name";
    }
    if (values.email_address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email_address)) {
      next.email_address = "Enter a valid email address";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const trimmed = values.full_name.trim();
    const resolvedService = values.services === "Custom" ? customService.trim() : values.services;
    const services = resolvedService
      ? resolvedService.split(",").map((s) => s.trim()).filter(Boolean)
      : ["Subtitling"];

    try {
      const dup = await api.checkDuplicateLead({
        email: values.email_address || undefined,
        contactNumber: values.contact_number || undefined,
        fullName: trimmed,
      });
      if (dup.isDuplicate) {
        toast.warning("A similar lead may already exist — submitting anyway.");
      }
    } catch {
      // Non-blocking hint only — proceed even if the duplicate check itself fails.
    }

    createMutation.mutate({
      fullName: trimmed,
      firstName: values.first_name || undefined,
      source: mapToLeadSource(values.source),
      profileLink: values.profile_link || undefined,
      email: values.email_address || undefined,
      contactNumber: values.contact_number || undefined,
      reachoutDate: values.reachout_date || undefined,
      sourceLanguage: values.source_language || undefined,
      targetLanguage: values.target_language || undefined,
      secondaryLanguages: values.secondary_languages
        ? values.secondary_languages.split(",").map((l) => l.trim()).filter(Boolean)
        : [],
      services,
      country: values.country_of_residence || undefined,
    });
  }

  const handleCsvDownload = () => {
    const csvContent =
      "data:text/csv;charset=utf-8,Full Name,Country,Source,Profile Link,Email,Contact,Reachout Date,Source Language,Target Language,Secondary Languages,Services\nAlex Chen,Germany,LinkedIn,https://linkedin.com/in/alexchen,alex@example.com,+49 1234567,2026-08-01,English,German,French,Dubbing; Subtitling\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "global3_lead_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Downloaded CSV lead import template!");
  };

  const handleExcelDownload = () => {
    toast.success("Downloaded Excel (.xlsx) lead import template!");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || "";
      const parsed = parseCsvLeads(text);
      if (parsed.length > 0) {
        const rows = parsed.map((l) => ({
          fullName: l.display_name ?? l.masked_label,
          source: mapToLeadSource(l.source),
          services: l.services,
          targetLanguage: l.language,
        }));
        bulkCreateMutation.mutate(rows);
        toast.success(`Uploaded ${file.name}. Importing ${parsed.length} candidate leads…`);
      } else {
        toast.info(`Uploaded ${file.name}. Ensure sheet contains Name, Email, Language, or Services columns.`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <div onClick={() => setOpen(true)}>{trigger}</div>}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a Lead</DialogTitle>
          <DialogDescription>
            Capture what you have now. Years of experience and vendor history enrich automatically in the background.
          </DialogDescription>
        </DialogHeader>

        {/* Bulk Upload CSV/Excel Template Box */}
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Upload className="h-4 w-4 text-primary" />
              <span>Have many? Bulk import via CSV or Excel.</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCsvDownload}
              className="h-8 text-xs gap-1.5 bg-card"
            >
              <Download className="h-3.5 w-3.5" /> CSV template
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExcelDownload}
              className="h-8 text-xs gap-1.5 bg-card"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-accent" /> Excel template
            </Button>
            <label className="cursor-pointer">
              <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" />
              <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                <Upload className="h-3.5 w-3.5" /> Upload file
              </div>
            </label>
          </div>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <Field label="First Name" error={errors.first_name}>
            <Input value={values.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="Alex" />
          </Field>

          <Field label="Full Name *" error={errors.full_name}>
            <Input value={values.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Alex Chen" />
          </Field>

          <Field label="Country of Residence" error={errors.country_of_residence}>
            <Input value={values.country_of_residence} onChange={(e) => set("country_of_residence", e.target.value)} placeholder="Germany" />
          </Field>

          <Field label="Source *" error={errors.source}>
            <Select
              value={SOURCES.includes(values.source) ? values.source : values.source ? "__custom__" : ""}
              onValueChange={(v) => {
                if (v === "__custom__") {
                  set("source", "");
                } else {
                  set("source", v);
                }
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="__custom__">
                  <span className="flex items-center gap-1.5 text-primary font-medium">+ Custom</span>
                </SelectItem>
              </SelectContent>
            </Select>
            {(!SOURCES.includes(values.source) && (values.source !== "" || !SOURCES.includes(values.source))) &&
              (!SOURCES.includes(values.source)) && (
              <Input
                className="mt-2"
                value={values.source}
                onChange={(e) => set("source", e.target.value)}
                placeholder="Enter custom source…"
                autoFocus
              />
            )}
          </Field>

          <Field label="Profile Link" error={errors.profile_link} full>
            <Input value={values.profile_link} onChange={(e) => set("profile_link", e.target.value)} placeholder="https://linkedin.com/in/…" />
          </Field>

          <Field label="Email Address" error={errors.email_address}>
            <Input type="email" value={values.email_address} onChange={(e) => set("email_address", e.target.value)} placeholder="alex@example.com" />
          </Field>

          <Field label="Contact Number" error={errors.contact_number}>
            <Input value={values.contact_number} onChange={(e) => set("contact_number", e.target.value)} placeholder="+49 …" />
          </Field>

          <Field label="Reachout Date" error={errors.reachout_date}>
            <Input type="date" value={values.reachout_date} onChange={(e) => set("reachout_date", e.target.value)} />
          </Field>

          {/* Source Language Dropdown */}
          <Field label="Source Language" error={errors.source_language}>
            <Select value={values.source_language} onValueChange={(v) => set("source_language", v)}>
              <SelectTrigger className="h-9 text-xs bg-card">
                <SelectValue placeholder="Select Source Language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Target Language Dropdown */}
          <Field label="Target Language" error={errors.target_language}>
            <Select value={values.target_language} onValueChange={(v) => set("target_language", v)}>
              <SelectTrigger className="h-9 text-xs bg-card">
                <SelectValue placeholder="Select Target Language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Secondary Languages Dropdown */}
          <Field label="Secondary Languages" error={errors.secondary_languages}>
            <Select value={values.secondary_languages} onValueChange={(v) => set("secondary_languages", v)}>
              <SelectTrigger className="h-9 text-xs bg-card">
                <SelectValue placeholder="Select Secondary Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Services Dropdown with Custom Add Option */}
          <Field label="Services" error={errors.services}>
            <div className="space-y-1.5">
              <Select
                value={values.services}
                onValueChange={(v) => set("services", v)}
              >
                <SelectTrigger className="h-9 text-xs bg-card">
                  <SelectValue placeholder="Select Service" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  <SelectItem value="Custom">
                    <span className="flex items-center gap-1.5 text-primary font-semibold">
                      <Plus className="h-3.5 w-3.5" /> + Custom / Add New Service...
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {values.services === "Custom" && (
                <Input
                  value={customService}
                  onChange={(e) => setCustomService(e.target.value)}
                  placeholder="Type custom service name (e.g. Dialogue Editing)..."
                  className="h-8 text-xs bg-card border-primary/50"
                  autoFocus
                />
              )}
            </div>
          </Field>

          <DialogFooter className="md:col-span-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {createMutation.isPending ? "Adding…" : "Add Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, children, full }: { label: string; error?: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`space-y-1.5 ${full ? "md:col-span-2" : ""}`}>
      <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
