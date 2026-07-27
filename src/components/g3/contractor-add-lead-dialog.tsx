// Contractor Add Lead dialog. Same SEARCH-only layout as recruiter's version.
// Duplicate check runs inline on submit — never blocks; contractor chooses
// whether to submit anyway or cancel.
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addContractorLead, checkDuplicate } from "@/lib/recruiter-mock";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { z } from "zod";

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

function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

type DupState = { checked: boolean; hit: boolean };

export function ContractorAddLeadDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dup, setDup] = useState<DupState>({ checked: false, hit: false });

  const set = (k: keyof typeof empty, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    // Any edit invalidates prior duplicate check.
    if (dup.checked) setDup({ checked: false, hit: false });
  };

  function reset() {
    setValues(empty);
    setErrors({});
    setDup({ checked: false, hit: false });
  }

  function validate() {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      for (const issue of parsed.error.issues) flat[issue.path[0] as string] = issue.message;
      setErrors(flat);
      return null;
    }
    setErrors({});
    return parsed.data;
  }

  function onCheck() {
    const data = validate();
    if (!data) return;
    const hit = !!checkDuplicate({
      full_name: data.full_name,
      profile_link: data.profile_link,
      email_address: data.email_address,
    });
    setDup({ checked: true, hit });
  }

  function submit(force: boolean) {
    const data = validate();
    if (!data) return;
    let hit = dup.hit;
    if (!dup.checked) {
      hit = !!checkDuplicate({
        full_name: data.full_name,
        profile_link: data.profile_link,
        email_address: data.email_address,
      });
      setDup({ checked: true, hit });
      if (hit && !force) return; // let contractor see the warning first
    }
    if (hit && !force) return;
    addContractorLead(
      { ...data, services: splitList(data.services), secondary_languages: splitList(data.secondary_languages) },
      { dup_flagged: hit },
    );
    setOpen(false);
    reset();
    toast.success("Lead submitted");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a Lead</DialogTitle>
          <DialogDescription>
            Capture what you have on the candidate. Our team enriches years of experience and vendor history in the background.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit(dup.hit); }} className="grid max-h-[70vh] grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
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
            <Input list="cal-langs" value={values.source_language} onChange={(e) => set("source_language", e.target.value)} placeholder="English" />
          </Field>
          <Field label="Target Language" error={errors.target_language}>
            <Input list="cal-langs" value={values.target_language} onChange={(e) => set("target_language", e.target.value)} placeholder="German" />
          </Field>
          <Field label="Secondary Languages" error={errors.secondary_languages} full>
            <Input value={values.secondary_languages} onChange={(e) => set("secondary_languages", e.target.value)} placeholder="French, Spanish (comma-separated)" />
          </Field>
          <Field label="Services" error={errors.services} full>
            <Input list="cal-services" value={values.services} onChange={(e) => set("services", e.target.value)} placeholder="Dubbing, Subtitling, SDH (comma-separated)" />
          </Field>
          <datalist id="cal-langs">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
          <datalist id="cal-services">{SERVICES.map((s) => <option key={s} value={s} />)}</datalist>

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

          <DialogFooter className="md:col-span-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="outline" onClick={onCheck}>Check for duplicates</Button>
            <Button
              type="submit"
              className={dup.hit ? "bg-warning text-warning-foreground hover:bg-warning/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}
            >
              {dup.hit ? "Submit anyway" : "Submit lead"}
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
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}