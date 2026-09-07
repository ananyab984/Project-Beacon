import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ApiLead } from "@/lib/api-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: ApiLead | null;
  onSave: (id: string, patch: Partial<ApiLead>) => Promise<unknown>;
  /** Adds/removes the ON_HOLD flag. The status toggle below is the only
   *  place this is done now -- the leads table used to carry its own
   *  "· Hold"/"· Resume" links, which put the control on a row that has no
   *  room to explain what it means. */
  onToggleHold: (id: string, hold: boolean) => Promise<unknown>;
}

const SOURCE_LABEL: Record<string, string> = {
  brightdata: "Bright Data",
  tavily: "Tavily",
  llm_fallback: "AI extraction",
  parallel: "Parallel",
  // "existing" means the value arrived already populated on the input row --
  // orchestrator.py tags every pre-populated field that way before any
  // provider runs. It is NOT a manual entry, and it's exactly what
  // `enrichedFieldCount` excludes, so the badge has to say so plainly.
  existing: "From input",
  manual: "Manual entry",
};

/** Same defensive key handling as drafting_service's core/leads.py
 * `_format_role` -- real captured enrichment payloads mix snake_case and
 * camelCase depending on which source produced them. */
function formatRole(entry: any): string {
  if (!entry || typeof entry !== "object") return "";
  const title = entry.title ?? entry.Title;
  const company = entry.company ?? entry.Company ?? entry.org;
  const start = entry.startDate ?? entry.start_date;
  const end = entry.endDate ?? entry.end_date;
  const label = [title, company ? `at ${company}` : null].filter(Boolean).join(" ");
  if (!label) return "";
  return start ? `${label} (${start}–${end ?? "present"})` : label;
}

function formatEducation(entry: any): string {
  if (!entry || typeof entry !== "object") return "";
  const degree = entry.degree;
  const institution = entry.institution ?? entry.school;
  return [degree, institution].filter((x) => x && String(x).toLowerCase() !== "not specified").join(", ");
}

/** A language/course entry may be a plain string or an object depending on
 * which source produced it -- same defensive extraction as
 * drafting_service's core/leads.py `_label_of`. */
function labelOf(entry: any): string {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object") {
    const val = entry.language ?? entry.name ?? entry.title ?? "";
    return String(val).trim();
  }
  return "";
}

type FieldKind = "text" | "number" | "list";

const FIELD_DEFS: Array<{ label: string; key: string; sourceKey: string; kind: FieldKind; placeholder?: string }> = [
  { label: "Email", key: "email", sourceKey: "Email_Address", kind: "text", placeholder: "name@example.com" },
  { label: "Contact Number", key: "contactNumber", sourceKey: "Contact_Number", kind: "text", placeholder: "+1 234 567 8900" },
  { label: "Country", key: "country", sourceKey: "Country_of_Residence", kind: "text" },
  { label: "Profile Link", key: "profileLink", sourceKey: "Profile_Link", kind: "text", placeholder: "https://www.linkedin.com/in/..." },
  { label: "Source Language", key: "sourceLanguage", sourceKey: "Source_Language", kind: "text" },
  { label: "Target Language", key: "targetLanguage", sourceKey: "Target_Language", kind: "text" },
  { label: "Services", key: "services", sourceKey: "Services", kind: "list", placeholder: "comma-separated" },
  { label: "Headline", key: "headline", sourceKey: "Headline", kind: "text" },
  { label: "Current Title", key: "currentTitle", sourceKey: "Current_Title", kind: "text" },
  { label: "About", key: "aboutSnippet", sourceKey: "About_Snippet", kind: "text" },
  { label: "Years of Experience", key: "yearsOfExperience", sourceKey: "Years_of_Exp", kind: "number" },
  { label: "Vendor Experience", key: "vendorExperience", sourceKey: "Vendor_Experience", kind: "text" },
  { label: "Tools / Software", key: "toolsSoftware", sourceKey: "Tools_Software", kind: "list", placeholder: "comma-separated" },
  { label: "Certifications", key: "certifications", sourceKey: "Certifications", kind: "list", placeholder: "comma-separated" },
];

/** Editable view of exactly what enrichment actually found for this lead,
 * field by field, with where each value came from. Fields enrichment found
 * are pre-filled; anything still missing is an empty, directly-editable
 * input -- the recruiter can add a contact (or fix anything else) and save
 * straight from here instead of the "On Hold" manual-enrichment flow. */
export function EnrichmentDetailsDialog({ open, onOpenChange, lead, onSave, onToggleHold }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Held locally so the toggle flips immediately: the parent passes the same
  // `lead` object until its query refetches, so reading the flag straight off
  // the prop would leave the control showing the pre-click state.
  const [onHold, setOnHold] = useState(false);
  const [togglingHold, setTogglingHold] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const initial: Record<string, string> = {};
    for (const f of FIELD_DEFS) {
      const raw = (lead as any)[f.key];
      initial[f.key] = f.kind === "list" ? (Array.isArray(raw) && raw.length ? raw.join(", ") : "") : raw != null ? String(raw) : "";
    }
    setValues(initial);
    setOnHold((lead.flags ?? []).includes("ON_HOLD"));
  }, [lead]);

  if (!lead) return null;

  const sources = lead.fieldSources || {};
  const parallel = lead.parallelData || {};
  const experienceRows: string[] = Array.isArray(parallel.experience) ? parallel.experience.map(formatRole).filter(Boolean) : [];
  const educationRows: string[] = Array.isArray(parallel.education) ? parallel.education.map(formatEducation).filter(Boolean) : [];
  const languageRows: string[] = Array.isArray(parallel.languages) ? parallel.languages.map(labelOf).filter(Boolean) : [];
  // Parallel has no course/certification-course equivalent -- always empty
  // (kept rather than removed so the render below doesn't need to special-case it).
  const courseRows: string[] = Array.isArray(parallel.courses) ? parallel.courses.map(labelOf).filter(Boolean) : [];

  const hasContact = !!(values.email?.trim() || values.contactNumber?.trim());

  function handleChange(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function handleToggleHold(hold: boolean) {
    if (!lead || hold === onHold) return;
    setOnHold(hold); // optimistic -- reverted below if the request fails
    setTogglingHold(true);
    try {
      await onToggleHold(lead.id, hold);
    } catch (err: any) {
      setOnHold(!hold);
      toast.error(err?.message ?? "Failed to change enrichment status");
    } finally {
      setTogglingHold(false);
    }
  }

  async function handleSave() {
    if (!lead) return;
    const patch: Partial<ApiLead> = {};
    for (const f of FIELD_DEFS) {
      const raw = (values[f.key] ?? "").trim();
      if (f.kind === "number") {
        // `null` for a cleared field, not `undefined` -- JSON.stringify drops
        // `undefined` keys entirely, which was the actual "can't clear a
        // wrong value" bug: the key never reached the server, so the old
        // value silently survived.
        (patch as any)[f.key] = raw === "" ? null : Number(raw);
      } else if (f.kind === "list") {
        (patch as any)[f.key] = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        (patch as any)[f.key] = raw || null;
      }
    }
    setSaving(true);
    try {
      await onSave(lead.id, patch);
      onOpenChange(false);
    } catch (err: any) {
      // Keep the dialog open on failure -- previously this closed
      // unconditionally, giving a false impression the save succeeded.
      toast.error(err?.message ?? "Failed to save changes -- your edits are still here, try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{lead.displayName ?? lead.fullName ?? "Lead"} — Enrichment Details</span>
            {!hasContact && (
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive text-[10px] shrink-0">
                No contact yet
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Fields enrichment found are pre-filled below; anything still missing is empty — fill it in (especially
            email/contact) and save.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[130px_1fr] gap-3 items-start">
          <Label className="text-muted-foreground text-xs pt-2">Enrichment Status</Label>
          <div>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {([false, true] as const).map((hold) => (
                <button
                  key={String(hold)}
                  type="button"
                  onClick={() => handleToggleHold(hold)}
                  disabled={togglingHold}
                  aria-pressed={onHold === hold}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    onHold === hold
                      ? hold
                        ? "bg-warning/15 text-warning"
                        : "bg-emerald-500/15 text-emerald-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${hold ? "bg-warning" : "bg-emerald-500"}`} />
                  {hold ? "On Hold" : "Enriched"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Mark as on hold if enrichment is incomplete or needs follow-up.
            </p>
          </div>
        </div>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {FIELD_DEFS.map((f) => (
            <div key={f.key} className="grid grid-cols-[130px_1fr] gap-3 text-sm items-center">
              <Label className="text-muted-foreground text-xs">{f.label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type={f.kind === "number" ? "number" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  placeholder={sources[f.sourceKey] ? undefined : f.placeholder ?? "Not found — add manually"}
                  className="h-8 text-xs"
                />
                {sources[f.sourceKey] && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {SOURCE_LABEL[sources[f.sourceKey]] ?? sources[f.sourceKey]}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>

        {(experienceRows.length > 0 || educationRows.length > 0) && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              Experience &amp; Education
              <Badge variant="secondary" className="text-[10px]">Parallel</Badge>
            </div>
            {experienceRows.length > 0 && (
              <ul className="text-sm space-y-1 mb-2 list-disc list-inside">
                {experienceRows.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {educationRows.length > 0 && (
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                {educationRows.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        )}

        {(languageRows.length > 0 || courseRows.length > 0) && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              Languages &amp; Courses
              <Badge variant="secondary" className="text-[10px]">Parallel</Badge>
            </div>
            {languageRows.length > 0 && <p className="text-sm mb-1">{languageRows.join(", ")}</p>}
            {courseRows.length > 0 && <p className="text-sm text-muted-foreground">{courseRows.join(", ")}</p>}
          </div>
        )}

        {!hasContact && (
          <p className="text-xs text-amber-500">
            Automated enrichment has finished for this lead (this is the maximum profile data obtainable), but no
            email or contact number was found — add one above if you have it, or it needs manual follow-up.
          </p>
        )}

        <DialogFooter>
          <Button size="sm" onClick={handleSave} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
