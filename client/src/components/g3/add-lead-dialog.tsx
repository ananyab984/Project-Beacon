import { ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, FileSpreadsheet, Plus } from "lucide-react";
import { toast } from "sonner";
import { addLead, Lead } from "@/lib/g3-mock";

const SOURCES = ["LinkedIn", "ProZ", "Referral", "GitHub", "Other"];

const LANGUAGES = [
  "English",
  "Spanish (LatAm)",
  "Japanese",
  "German",
  "French",
  "Portuguese (Brazil)",
  "Italian",
  "Korean",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
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
  "Russian",
  "Norwegian",
  "Danish",
  "Finnish",
  "Greek",
  "Hebrew",
  "Thai",
  "Indonesian",
];

const SERVICES = [
  "Dubbing",
  "Subtitling",
  "SDH",
  "Transcription",
  "Voice Over",
  "Localization QA",
  "AI Post-editing",
  "Translation",
  "Transcreation",
  "Quality Control",
  "Interpretation",
  "Audio Description",
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const trimmed = values.full_name.trim();
    const id = `lead_${Date.now()}`;
    const name = values.first_name ? `${values.first_name} (${trimmed})` : trimmed;
    const resolvedService = values.services === "Custom" ? customService.trim() : values.services;
    const services = resolvedService
      ? resolvedService.split(",").map((s) => s.trim()).filter(Boolean)
      : ["Subtitling"];

    const newLead: Partial<Lead> & { id: string } = {
      id,
      display_name: name,
      masked_label: name,
      language: values.target_language || "German",
      source_language: values.source_language || "English",
      target_language: values.target_language || "German",
      secondary_languages: values.secondary_languages
        ? values.secondary_languages.split(",").map((l) => l.trim()).filter(Boolean)
        : [],
      services,
      stage: "Contacted",
      source: (values.source as any) || "LinkedIn",
      country: values.country_of_residence || "Germany",
      verified_email: true,
      confirmed_language_pair: true,
      years_experience: 5,
      recruiter_id: "r1",
      last_activity: "Just now",
      identity_resolved: true,
      flags: [],
      availability: "Available Now",
    };

    addLead(newLead as Lead);
    toast.success(`Lead ${trimmed} added to My Leads!`);
    setOpen(false);
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
    if (file) {
      toast.success(`Parsed ${file.name}! Imported 5 candidate leads.`);
      setOpen(false);
    }
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
            <Select value={values.source} onValueChange={(v) => set("source", v)}>
              <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
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
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">Add Lead</Button>
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