import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { ApiLead } from "@/lib/api-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: ApiLead | null;
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

/** Read-only view of exactly what enrichment actually found for this lead,
 * field by field, with where each value came from -- the "click Enriched to
 * see what you actually got" feature. Previously "Enriched" was static text
 * with no way to inspect it; this is the same Dialog pattern already used by
 * ManualEnrichmentDialog for the "On Hold" click-through. */
export function EnrichmentDetailsDialog({ open, onOpenChange, lead }: Props) {
  if (!lead) return null;

  const sources = lead.fieldSources || {};
  const clay = lead.clayData || {};
  const experienceRows: string[] = Array.isArray(clay.experience)
    ? clay.experience.map(formatRole).filter(Boolean)
    : [];
  const educationRows: string[] = Array.isArray(clay.education)
    ? clay.education.map(formatEducation).filter(Boolean)
    : [];
  const rows: Array<{ label: string; value: string | null; sourceKey: string }> = [
    { label: "Email", value: lead.email, sourceKey: "Email_Address" },
    { label: "Contact Number", value: lead.contactNumber, sourceKey: "Contact_Number" },
    { label: "Headline", value: lead.headline, sourceKey: "Headline" },
    { label: "Current Title", value: lead.currentTitle, sourceKey: "Current_Title" },
    { label: "About", value: lead.aboutSnippet, sourceKey: "About_Snippet" },
    { label: "Years of Experience", value: lead.yearsOfExperience?.toString() ?? null, sourceKey: "Years_of_Exp" },
    { label: "Vendor Experience", value: lead.vendorExperience, sourceKey: "Vendor_Experience" },
    { label: "Tools / Software", value: lead.toolsSoftware?.length ? lead.toolsSoftware.join(", ") : null, sourceKey: "Tools_Software" },
    { label: "Certifications", value: lead.certifications?.length ? lead.certifications.join(", ") : null, sourceKey: "Certifications" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead.displayName ?? lead.fullName ?? "Lead"} — Enrichment Details</DialogTitle>
          <DialogDescription>Exactly what was found, and which source it came from.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {rows.map((r) => (
            <div key={r.sourceKey} className="grid grid-cols-[140px_1fr] gap-3 text-sm border-b border-border/40 pb-2">
              <div className="text-muted-foreground">{r.label}</div>
              <div>
                {r.value ? (
                  <div className="flex items-start justify-between gap-2">
                    <span className="break-words">{r.value}</span>
                    {sources[r.sourceKey] && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {SOURCE_LABEL[sources[r.sourceKey]] ?? sources[r.sourceKey]}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">— not found</span>
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

        {!lead.email && !lead.contactNumber && (
          <p className="text-xs text-amber-500">
            No email or contact number found yet — this is why the lead isn't marked fully Enriched
            despite having other profile content.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
