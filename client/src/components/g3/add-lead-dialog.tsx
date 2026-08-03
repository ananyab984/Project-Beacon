// PLACEMENT: pending usability testing — this dialog is triggered via a
// props.trigger element so the button can be moved (center / top-right / etc.)
// without changing dialog internals.
import { useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addLead, checkDuplicate } from "@/lib/recruiter-mock";
import { toast } from "sonner";
import { z } from "zod";
import { Upload, Download } from "lucide-react";

const schema = z
  .object({
    first_name: z.string().trim().max(80).optional().default(""),
    full_name: z.string().trim().min(1, "Full name is required").max(120),
    country_of_residence: z.string().trim().max(80).optional().default(""),
    source: z.string().min(1, "Select a source"),
    profile_link: z.string().trim().url("Enter a valid URL").or(z.literal("")).optional().default(""),
    email_address: z.string().trim().email("Enter a valid email").or(z.literal("")).optional().default(""),
    contact_number: z.string().trim().max(40).optional().default(""),
    reachout_date: z.string().optional().default(""),
    services: z.string().optional().default(""),
    source_language: z.string().trim().max(60).optional().default(""),
    target_language: z.string().trim().max(60).optional().default(""),
    secondary_languages: z.string().optional().default(""),
  })
  .refine((v) => v.profile_link || v.email_address, {
    message: "Provide at least Profile Link or Email Address",
    path: ["profile_link"],
  });

const SOURCES = ["LinkedIn", "ProZ", "Referral", "GitHub", "Other"];
const LANGUAGES = ["English", "German", "French", "Spanish", "Italian", "Portuguese", "Japanese", "Korean", "Mandarin", "Hindi", "Arabic"];
const SERVICES = ["Dubbing", "Subtitling", "SDH", "CC", "AD"];
const empty = { first_name: "", full_name: "", country_of_residence: "", source: "", profile_link: "", email_address: "", contact_number: "", reachout_date: "", services: "", source_language: "", target_language: "", secondary_languages: "" };

const TEMPLATE_HEADERS = [
  "Reachout Date", "First Name", "Full Name", "Country of Residence", "Source",
  "Profile_Link", "Contact Number", "Email Address", "Services",
  "Source_Language", "Target_Language", "Secondary_Languages",
];

function downloadTemplate(kind: "csv" | "xlsx") {
  const filename = `leads_template.${kind}`;
  const content = TEMPLATE_HEADERS.join(",") + "\n";
  const mime = kind === "csv"
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function AddLeadDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = (k: keyof typeof empty, v: string) => setValues((s) => ({ ...s, [k]: v }));

  function reset() {
    setValues(empty);
    setErrors({});
  }

  function handleBulkFile(f: File) {
    toast.success(`Bulk import queued: ${f.name}`, {
      description: "You'll be notified once rows are validated and merged.",
    });
    setOpen(false);
    reset();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      for (const issue of parsed.error.issues) flat[issue.path[0] as string] = issue.message;
      setErrors(flat);
      return;
    }
    const dup = checkDuplicate({
      full_name: parsed.data.full_name,
      profile_link: parsed.data.profile_link,
      email_address: parsed.data.email_address,
    });
    if (dup) {
      setErrors({ [dup.field]: `Duplicate — matches existing lead "${dup.lead.full_name}" on ${dup.field.replace("_", " ")}` });
      return;
    }
    addLead({
      ...parsed.data,
      services: splitList(parsed.data.services),
      secondary_languages: splitList(parsed.data.secondary_languages),
    });
    setOpen(false);
    reset();
    toast.success("Lead added", { description: "Enrichment in progress — fields populate shortly." });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a Lead</DialogTitle>
          <DialogDescription>
            Capture what you have now. Years of experience and vendor history enrich automatically in the background.
          </DialogDescription>
        </DialogHeader>

        {/* Bulk import strip — inline shortcut for many leads at once */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Have many? Bulk import via CSV or Excel.</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => downloadTemplate("csv")}>
              <Download className="h-3 w-3" /> CSV template
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => downloadTemplate("xlsx")}>
              <Download className="h-3 w-3" /> Excel template
            </Button>
            <Button type="button" size="sm" className="h-7 text-[11px] bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3 w-3" /> Upload file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkFile(f); e.target.value = ""; }}
            />
          </div>
        </div>

        <form onSubmit={onSubmit} className="grid max-h-[70vh] grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
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
          <Field label="Source Language" error={errors.source_language}>
            <Input list="al-langs" value={values.source_language} onChange={(e) => set("source_language", e.target.value)} placeholder="English" />
          </Field>
          <Field label="Target Language" error={errors.target_language}>
            <Input list="al-langs" value={values.target_language} onChange={(e) => set("target_language", e.target.value)} placeholder="German" />
          </Field>
          <Field label="Secondary Languages" error={errors.secondary_languages} full>
            <Input value={values.secondary_languages} onChange={(e) => set("secondary_languages", e.target.value)} placeholder="French, Spanish (comma-separated)" />
          </Field>
          <Field label="Services" error={errors.services} full>
            <Input list="al-services" value={values.services} onChange={(e) => set("services", e.target.value)} placeholder="Dubbing, Subtitling, SDH (comma-separated)" />
          </Field>
          <datalist id="al-langs">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
          <datalist id="al-services">{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90">Add Lead</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, children, full }: { label: string; error?: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`space-y-1.5 ${full ? "md:col-span-2" : ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}