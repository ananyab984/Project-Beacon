import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ApiLead } from "@/lib/api-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: ApiLead | null;
  onSave: (id: string, patch: Partial<ApiLead>) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  brightdata: "Bright Data",
  tavily: "Tavily",
  llm_fallback: "AI extraction",
  clay: "Clay",
  existing: "Manually entered",
};

/** Same defensive key handling as drafting_service's core/leads.py
 * `_format_role` -- Clay's real payloads mix snake_case and camelCase
 * depending on which action produced them. */
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
 * which Clay action produced it -- same defensive extraction as
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
export function EnrichmentDetailsDialog({ open, onOpenChange, lead, onSave }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!lead) return;
    const initial: Record<string, string> = {};
    for (const f of FIELD_DEFS) {
      const raw = (lead as any)[f.key];
      initial[f.key] = f.kind === "list" ? (Array.isArray(raw) && raw.length ? raw.join(", ") : "") : raw != null ? String(raw) : "";
    }
    setValues(initial);
  }, [lead]);

  if (!lead) return null;

  const sources = lead.fieldSources || {};
  const clay = lead.clayData || {};
  const experienceRows: string[] = Array.isArray(clay.experience) ? clay.experience.map(formatRole).filter(Boolean) : [];
  const educationRows: string[] = Array.isArray(clay.education) ? clay.education.map(formatEducation).filter(Boolean) : [];
  const languageRows: string[] = Array.isArray(clay.languages) ? clay.languages.map(labelOf).filter(Boolean) : [];
  const courseRows: string[] = Array.isArray(clay.courses) ? clay.courses.map(labelOf).filter(Boolean) : [];

  const hasContact = !!(values.email?.trim() || values.contactNumber?.trim());

  function handleChange(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function handleSave() {
    if (!lead) return;
    const patch: Partial<ApiLead> = {};
    for (const f of FIELD_DEFS) {
      const raw = (values[f.key] ?? "").trim();
      if (f.kind === "number") {
        (patch as any)[f.key] = raw === "" ? undefined : Number(raw);
      } else if (f.kind === "list") {
        (patch as any)[f.key] = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        (patch as any)[f.key] = raw || undefined;
      }
    }
    onSave(lead.id, patch);
    onOpenChange(false);
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
              <Badge variant="secondary" className="text-[10px]">Clay</Badge>
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
              <Badge variant="secondary" className="text-[10px]">Clay</Badge>
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
          <Button size="sm" onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
