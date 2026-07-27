import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useContractorProfile, updateContractorProfile, type ContractorProfile } from "@/lib/recruiter-mock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Camera, CheckCircle2, FileText, Globe, KeyRound, Languages, Linkedin, Mail,
  MapPin, Phone, Save, ShieldCheck, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/contractor/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Contractor · Global3" },
      { name: "description", content: "Manage your contractor profile, availability, notifications, and security." },
    ],
  }),
  component: ContractorSettingsPage,
});

const SERVICES = [
  "Subtitling", "SDH", "Dubbing", "Voiceover", "Translation", "Transcreation",
  "QC / Proofing", "Timing / Spotting", "Audio Description", "LQA",
];
const LANGUAGES = [
  "English", "Spanish", "French", "German", "Portuguese", "Italian",
  "Japanese", "Korean", "Chinese (Simplified)", "Chinese (Traditional)",
  "Arabic", "Hindi", "Tamil", "Turkish", "Russian",
];

function ContractorSettingsPage() {
  const saved = useContractorProfile();
  const [draft, setDraft] = useState<ContractorProfile>(saved);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  function set<K extends keyof ContractorProfile>(k: K, v: ContractorProfile[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function toggleInArray(key: "services" | "target_languages" | "secondary_languages", value: string) {
    setDraft((d) => {
      const cur = d[key];
      return { ...d, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] };
    });
  }

  function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error("Avatar must be under 2 MB.");
    const reader = new FileReader();
    reader.onload = () => set("avatar_data_url", reader.result as string);
    reader.readAsDataURL(file);
  }

  function onResumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast.error("Resume must be under 8 MB.");
    setDraft((d) => ({ ...d, resume_filename: file.name, resume_size_kb: Math.round(file.size / 1024) }));
    toast.success("Resume attached — remember to save.");
  }

  function save() {
    updateContractorProfile(draft);
    toast.success("Profile updated");
  }

  function reset() {
    setDraft(saved);
  }

  const completeness = useMemo(() => {
    const checks = [
      draft.full_name, draft.headline, draft.country_of_residence, draft.bio,
      draft.avatar_data_url, draft.email, draft.phone,
      draft.services.length > 0, draft.source_language, draft.target_languages.length > 0,
      draft.years_of_exp > 0, draft.rate_amount > 0, draft.resume_filename,
      draft.linkedin_url || draft.portfolio_url || draft.proz_url,
    ];
    const done = checks.filter(Boolean).length;
    return Math.round((done / checks.length) * 100);
  }, [draft]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-24">
      {/* Header + completeness */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-accent/5 to-transparent p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-widest text-accent">Contractor settings</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Your profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep your details current so Global3 recruiters can match you to the right work.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Profile completeness</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-accent">{completeness}%</div>
            <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-accent" style={{ width: `${completeness}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* Personal info */}
      <Section title="Personal information" icon={<Sparkles className="h-3.5 w-3.5" />}>
        <div className="flex items-start gap-6">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border border-border bg-muted text-2xl font-semibold text-muted-foreground">
                {draft.avatar_data_url
                  ? <img src={draft.avatar_data_url} alt="Avatar" className="h-full w-full object-cover" />
                  : draft.full_name.slice(0, 1)}
              </div>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm hover:border-accent/40"
                aria-label="Change avatar"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
            </div>
            {draft.avatar_data_url && (
              <button className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => set("avatar_data_url", null)}>
                Remove
              </button>
            )}
          </div>
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Full name">
              <Input value={draft.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </Field>
            <Field label="Professional headline" hint="Shown to recruiters on your card.">
              <Input value={draft.headline} onChange={(e) => set("headline", e.target.value)} />
            </Field>
            <Field label="Country of residence" icon={<MapPin className="h-3 w-3" />}>
              <Input value={draft.country_of_residence} onChange={(e) => set("country_of_residence", e.target.value)} />
            </Field>
            <Field label="Timezone">
              <Input value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Short bio" hint="1–2 sentences. Recruiters see this when reviewing your profile.">
                <Textarea rows={3} value={draft.bio} onChange={(e) => set("bio", e.target.value)} maxLength={280} />
              </Field>
            </div>
          </div>
        </div>
      </Section>

      {/* Contact */}
      <Section title="Contact details" icon={<Mail className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Email" icon={<Mail className="h-3 w-3" />}>
            <div className="flex items-center gap-2">
              <Input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
              {draft.email_verified && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </span>
              )}
            </div>
          </Field>
          <Field label="Phone" icon={<Phone className="h-3 w-3" />}>
            <Input value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="WhatsApp">
            <Input value={draft.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
          </Field>
          <Field label="Preferred contact">
            <Select value={draft.preferred_contact} onValueChange={(v) => set("preferred_contact", v as ContractorProfile["preferred_contact"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="Phone">Phone</SelectItem>
                <SelectItem value="WhatsApp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      {/* Professional */}
      <Section title="Professional profile" icon={<Languages className="h-3.5 w-3.5" />}>
        <div className="space-y-5">
          <Field label="Services offered" hint="Recruiter matching uses these tags.">
            <ChipPicker options={SERVICES} selected={draft.services} onToggle={(v) => toggleInArray("services", v)} />
          </Field>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Source language">
              <Select value={draft.source_language} onValueChange={(v) => set("source_language", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Years of experience">
              <Input type="number" min={0} max={60}
                value={draft.years_of_exp}
                onChange={(e) => set("years_of_exp", Number(e.target.value) || 0)} />
            </Field>
            <Field label="Vendor experience" hint="Previous vendors / platforms.">
              <Input value={draft.vendor_experience} onChange={(e) => set("vendor_experience", e.target.value)} />
            </Field>
          </div>

          <Field label="Target languages">
            <ChipPicker options={LANGUAGES} selected={draft.target_languages} onToggle={(v) => toggleInArray("target_languages", v)} />
          </Field>
          <Field label="Secondary languages (optional)">
            <ChipPicker options={LANGUAGES} selected={draft.secondary_languages} onToggle={(v) => toggleInArray("secondary_languages", v)} />
          </Field>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Rate">
              <Input type="number" min={0} step={0.5}
                value={draft.rate_amount}
                onChange={(e) => set("rate_amount", Number(e.target.value) || 0)} />
            </Field>
            <Field label="Per">
              <Select value={draft.rate_unit} onValueChange={(v) => set("rate_unit", v as ContractorProfile["rate_unit"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">per hour</SelectItem>
                  <SelectItem value="minute">per minute of media</SelectItem>
                  <SelectItem value="project">per project</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={draft.currency} onValueChange={(v) => set("currency", v as ContractorProfile["currency"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="INR">INR</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      </Section>

      {/* Resume + links */}
      <Section title="Resume & links" icon={<FileText className="h-3.5 w-3.5" />}>
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Resume / CV</div>
                {draft.resume_filename ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {draft.resume_filename} · {draft.resume_size_kb} KB
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-muted-foreground">PDF, DOC or DOCX up to 8 MB.</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Upload
                </Button>
                {draft.resume_filename && (
                  <Button variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, resume_filename: null, resume_size_kb: null }))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={onResumeChange} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="LinkedIn" icon={<Linkedin className="h-3 w-3" />}>
              <Input placeholder="https://linkedin.com/in/…" value={draft.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} />
            </Field>
            <Field label="ProZ profile">
              <Input placeholder="https://proz.com/profile/…" value={draft.proz_url} onChange={(e) => set("proz_url", e.target.value)} />
            </Field>
            <Field label="Portfolio">
              <Input placeholder="https://…" value={draft.portfolio_url} onChange={(e) => set("portfolio_url", e.target.value)} />
            </Field>
            <Field label="Personal website" icon={<Globe className="h-3 w-3" />}>
              <Input placeholder="https://…" value={draft.website_url} onChange={(e) => set("website_url", e.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      {/* Availability */}
      <Section title="Availability" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Status">
            <Select value={draft.availability_status} onValueChange={(v) => set("availability_status", v as ContractorProfile["availability_status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Available Now">Available Now</SelectItem>
                <SelectItem value="Available from date">Available from date</SelectItem>
                <SelectItem value="Unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {draft.availability_status === "Available from date" && (
            <Field label="Available from">
              <Input type="date" value={draft.available_from ?? ""} onChange={(e) => set("available_from", e.target.value || null)} />
            </Field>
          )}
          <Field label="Weekly capacity (hrs)">
            <Input type="number" min={0} max={80}
              value={draft.weekly_capacity_hours}
              onChange={(e) => set("weekly_capacity_hours", Number(e.target.value) || 0)} />
          </Field>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Notification preferences" icon={<Mail className="h-3.5 w-3.5" />}>
        <div className="divide-y divide-border">
          <ToggleRow
            title="A recruiter accepts one of my leads"
            desc="Email me when a lead I submitted moves forward."
            checked={draft.notify_new_lead}
            onCheckedChange={(v) => set("notify_new_lead", v)}
          />
          <ToggleRow
            title="Duplicate flagged on submission"
            desc="Notify me when my submission matches an existing lead."
            checked={draft.notify_duplicate}
            onCheckedChange={(v) => set("notify_duplicate", v)}
          />
          <ToggleRow
            title="Direct messages from Global3"
            desc="Recruiter follow-ups and requests for information."
            checked={draft.notify_message}
            onCheckedChange={(v) => set("notify_message", v)}
          />
          <ToggleRow
            title="Weekly performance digest"
            desc="Monday summary of leads submitted, accepted, and flagged."
            checked={draft.notify_weekly_digest}
            onCheckedChange={(v) => set("notify_weekly_digest", v)}
          />
        </div>
      </Section>

      {/* Security */}
      <Section title="Security" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
        <div className="space-y-4">
          <ToggleRow
            title="Two-factor authentication"
            desc="Add an authenticator-app code at sign-in."
            checked={draft.two_fa_enabled}
            onCheckedChange={(v) => set("two_fa_enabled", v)}
          />
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5" /> Password
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">Last changed 42 days ago.</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => toast.info("Password reset email sent")}>
                Change password
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-destructive/30 bg-destructive/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-destructive">Delete account</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Permanently remove your contractor profile and submitted leads history.</div>
              </div>
              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                Request deletion
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* Sticky save bar */}
      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto flex max-w-5xl items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="text-xs text-muted-foreground">You have unsaved changes.</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}><X className="h-3.5 w-3.5" /> Discard</Button>
            <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={save}>
              <Save className="h-3.5 w-3.5" /> Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-accent">
        {icon} {title}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, icon, children }: { label: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground/90">
        {icon} {label}
      </Label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ChipPicker({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              on
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-accent/40"
            }`}
          >
            {o}
          </button>
        );
      })}
      {selected.length > 0 && (
        <Badge variant="outline" className="rounded-full text-[10px]">{selected.length} selected</Badge>
      )}
    </div>
  );
}

function ToggleRow({ title, desc, checked, onCheckedChange }: { title: string; desc: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground max-w-lg">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}