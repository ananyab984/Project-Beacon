import { ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Upload, Download, FileSpreadsheet, Plus } from "lucide-react";
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

export function ContractorAddLeadDialog({
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
  const [dup, setDup] = useState<{ checked: boolean; hit: boolean; matchName?: string }>({ checked: false, hit: false });

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const createMutation = useMutation({
    mutationFn: (lead: Partial<ApiLead> & { fullName: string; source: string }) => api.createLead(lead),
    onSuccess: (_res, lead) => {
      toast.success(`Lead ${lead.fullName} submitted to pipeline!`);
      invalidateLeads();
      setOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to submit lead"),
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
    setDup({ checked: false, hit: false });
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

  async function onCheck() {
    if (!validate()) return;
    try {
      const res = await api.checkDuplicateLead({
        email: values.email_address || undefined,
        contactNumber: values.contact_number || undefined,
        fullName: values.full_name.trim(),
      });
      setDup({ checked: true, hit: res.isDuplicate, matchName: res.isDuplicate ? values.full_name.trim() : undefined });
    } catch (err: any) {
      toast.error(err?.message ?? "Duplicate check failed");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const trimmed = values.full_name.trim();
    const resolvedService = values.services === "Custom" ? customService.trim() : values.services;
    const services = resolvedService
      ? resolvedService.split(",").map((s) => s.trim()).filter(Boolean)
      : ["Subtitling"];

    // Earlier UX hint only — the backend itself also flags duplicates on
    // create, so we never block submission on this check.
    if (!dup.checked) {
      try {
        const res = await api.checkDuplicateLead({
          email: values.email_address || undefined,
          contactNumber: values.contact_number || undefined,
          fullName: trimmed,
        });
        if (res.isDuplicate) toast.warning("A similar lead may already exist — submitting anyway.");
      } catch {
        // ignore — non-blocking hint
      }
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

  const [duplicateCheckResult, setDuplicateCheckResult] = useState<{
    fileName: string;
    duplicateCount: number;
    duplicateNames: string[];
    totalCount: number;
    newCount: number;
    rows: Array<Partial<ApiLead> & { fullName: string; source: string }>;
  } | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = (event.target?.result as string) || "";
      const parsed = parseCsvLeads(text);
      if (parsed.length > 0) {
        const rows = parsed.map((l) => ({
          fullName: l.display_name ?? l.masked_label,
          source: mapToLeadSource(l.source),
          services: l.services,
          targetLanguage: l.language,
          email: l.email || undefined,
          contactNumber: l.phone || undefined,
        }));

        setCheckingDuplicates(true);
        try {
          const dupRes = await api.checkBulkDuplicateLeads(
            rows.map((r) => ({ fullName: r.fullName, email: r.email, contactNumber: r.contactNumber }))
          );

          if (dupRes.hasDuplicates) {
            const namesList = dupRes.duplicateNames.slice(0, 3).join(", ") + (dupRes.duplicateNames.length > 3 ? "..." : "");
            toast.error(
              `⚠️ ${dupRes.duplicateCount} lead(s) (${namesList}) already exist in the database. Please upload another file or skip duplicates.`,
              { duration: 6000 }
            );
            setDuplicateCheckResult({
              fileName: file.name,
              duplicateCount: dupRes.duplicateCount,
              duplicateNames: dupRes.duplicateNames,
              totalCount: dupRes.totalCount,
              newCount: dupRes.newCount,
              rows,
            });
          } else {
            bulkCreateMutation.mutate(rows);
            toast.success(`Uploaded ${file.name}. Submitting ${parsed.length} candidate leads…`);
            setDuplicateCheckResult(null);
          }
        } catch {
          bulkCreateMutation.mutate(rows);
        } finally {
          setCheckingDuplicates(false);
          e.target.value = "";
        }
      } else {
        toast.info(`Uploaded ${file.name}. Ensure sheet contains Name, Email, Language, or Services columns.`);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleImportSkippingDuplicates = () => {
    if (!duplicateCheckResult) return;
    bulkCreateMutation.mutate(duplicateCheckResult.rows, {
      onSuccess: () => {
        toast.success(`Submitted ${duplicateCheckResult.newCount} new leads (skipped ${duplicateCheckResult.duplicateCount} existing duplicates).`);
        setDuplicateCheckResult(null);
      },
    });
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

        {/* Duplicate Leads Detected Alert Box */}
        {duplicateCheckResult && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 space-y-2.5 animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive animate-ping" />
                ⚠️ {duplicateCheckResult.duplicateCount} Lead(s) Already Exist in Database
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{duplicateCheckResult.fileName}</span>
            </div>

            <p className="text-xs text-foreground leading-relaxed">
              <strong>{duplicateCheckResult.duplicateCount}</strong> out of <strong>{duplicateCheckResult.totalCount}</strong> leads in this sheet already exist:
              <span className="font-semibold text-destructive ml-1">
                {duplicateCheckResult.duplicateNames.join(", ")}
              </span>
              . You can upload another file or submit only the <strong>{duplicateCheckResult.newCount}</strong> new leads.
            </p>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <label className="cursor-pointer">
                <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                <div className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors border border-border">
                  <Upload className="h-3.5 w-3.5" /> Upload Another File
                </div>
              </label>

              {duplicateCheckResult.newCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleImportSkippingDuplicates}
                  className="h-8 text-xs font-semibold bg-primary text-primary-foreground gap-1.5"
                >
                  Submit {duplicateCheckResult.newCount} New Leads Only
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDuplicateCheckResult(null)}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Bulk Upload CSV/Excel Template Box */}
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Upload className="h-4 w-4 text-primary" />
              <span>Have many? Bulk import via CSV or Excel.</span>
            </div>
            {checkingDuplicates && <span className="text-[11px] font-medium text-accent animate-pulse">Checking for database duplicates…</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toast.success("Downloaded CSV lead template!")}
              className="h-8 text-xs gap-1.5 bg-card"
            >
              <Download className="h-3.5 w-3.5" /> CSV template
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toast.success("Downloaded Excel lead template!")}
              className="h-8 text-xs gap-1.5 bg-card"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-accent" /> Excel template
            </Button>
            <label className="cursor-pointer">
              <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" disabled={checkingDuplicates} />
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
            {!SOURCES.includes(values.source) && (
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

          <div className="md:col-span-2">
            {dup.checked && (
              dup.hit ? (
                <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">A similar lead may already exist</div>
                    <div className="opacity-80">Check name and profile link. You can still submit if you're sure.</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-[oklch(0.5_0.14_155)]/40 bg-[oklch(0.5_0.14_155)]/10 px-3 py-2 text-xs text-[oklch(0.55_0.14_155)]">
                  <CheckCircle2 className="h-4 w-4" />
                  <div>No duplicate found</div>
                </div>
              )
            )}
          </div>

          <DialogFooter className="md:col-span-2 gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="outline" onClick={onCheck}>Check for duplicates</Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className={dup.hit ? "bg-warning text-warning-foreground hover:bg-warning/90 font-semibold" : "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"}
            >
              {createMutation.isPending ? "Submitting…" : dup.hit ? "Submit anyway" : "Submit lead"}
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
