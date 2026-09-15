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
  // Parallel is the only provider that ever resolves Country_of_Residence,
  // and it's skipped whenever a lead has no Profile_Link -- without this the
  // field renders as the same "Not found" a provider that actually ran and
  // came up empty would show, which reads as a data-quality problem instead
  // of a missing input.
  skipped_no_profile_link: "No profile link",
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

/** Where a field's value came from, for EVERY row -- including the two cases
 * that previously rendered no badge at all.
 *
 * A missing badge was ambiguous in both directions: a field holding a
 * hand-typed value with no `fieldSources` entry looked identical to one a
 * provider had verified, and an empty field looked identical to one nobody
 * had looked at. Seen on a real lead whose Vendor Experience read "6fdiff"
 * and Tools/Software "dubbing tool, lambda" with no provenance recorded for
 * either -- typed in and saved at some point, indistinguishable in the UI
 * from enriched data. */
const ENRICHMENT_PROVIDERS = ["brightdata", "tavily", "parallel", "llm_fallback"];

function provenanceOf(source: string | undefined, hasValue: boolean): { label: string; className: string } {
  if (source) {
    return {
      label: SOURCE_LABEL[source] ?? source,
      className: ENRICHMENT_PROVIDERS.includes(source)
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        : "border-border bg-muted/40 text-muted-foreground",
    };
  }
  if (hasValue) {
    // A value with no recorded provenance. Honest label: we know enrichment
    // didn't put it there, and we can't claim who did.
    return { label: "Unverified", className: "border-amber-500/30 bg-amber-500/10 text-amber-500" };
  }
  return { label: "Not found", className: "border-border/60 bg-transparent text-muted-foreground/60" };
}

/** A list column rendered into a text input: trimmed, de-duplicated
 * case-insensitively, blanks dropped. A raw `.join(", ")` surfaced the column
 * verbatim, including the double commas and stray spaces a hand-typed
 * "a,,b, " leaves behind, and then saved them straight back on the next
 * Save. */
function formatList(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const v = String(item ?? "").trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out.join(", ");
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
      initial[f.key] = f.kind === "list" ? formatList(raw) : raw != null ? String(raw).trim() : "";
    }
    setValues(initial);
    setOnHold((lead.flags ?? []).includes("ON_HOLD"));
  }, [lead]);

  if (!lead) return null;

  const sources = lead.fieldSources || {};
  const parallel = lead.parallelData || {};

  // Read the MERGED sections, not `parallelData`. Measured 2026-09-08 with
  // one output schema and one task instruction: Parallel returns these
  // sections for ProZ (education 1, languages 3, certifications 3) and
  // returns NOTHING for LinkedIn even on the "pro" processor, because
  // LinkedIn serves them only behind a login. Bright Data does get them --
  // 4 languages with proficiency, 10 certifications, 29 courses on one real
  // lead -- and every one of those rendered as "None found" while this block
  // read Parallel alone. See server/src/lib/profileSections.ts.
  const merged = lead.profileSections;
  const rowsOf = (
    key: keyof NonNullable<typeof merged>,
    format: (e: any) => string
  ): { text: string; source: string }[] =>
    (merged?.[key] ?? []).map((e) => ({ text: format(e), source: String(e.source) })).filter((r) => r.text);

  const experienceRows = rowsOf("experience", formatRole);
  const educationRows = rowsOf("education", formatEducation);
  const languageRows = rowsOf("languages", (e) => {
    const label = labelOf(e);
    const prof = String(e.proficiency ?? "").trim();
    return label && prof ? `${label} — ${prof}` : label;
  });
  const certificationRows = rowsOf("certifications", (e) => String(e.title ?? e.name ?? "").trim());
  const courseRows = rowsOf("courses", (e) => String(e.title ?? e.name ?? "").trim());

  // Anything Parallel returned that no section above accounts for. The stored
  // payload is deliberately lossless (see Lead.parallelData), so without this
  // the extra keys existed in the database and were visible nowhere -- a
  // recruiter had no way to see what enrichment actually came back with
  // beyond the flat fields.
  const SHOWN_PARALLEL_KEYS = new Set([
    "experience", "education", "languages", "courses", "certifications",
    // Already rendered as editable rows in FIELD_DEFS above.
    "headline", "current_title", "about_snippet", "country",
  ]);
  const extraParallelEntries = Object.entries(parallel).filter(([key, value]) => {
    if (SHOWN_PARALLEL_KEYS.has(key)) return false;
    if (value == null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === "object" && Object.keys(value as object).length === 0) return false;
    return true;
  });
  // Judged on whether any section actually has ROWS, not on whether the
  // payload has keys. `Object.keys(parallelData).length > 0` was true for a
  // payload of all-nulls and empty lists, so the block rendered five "None
  // found" rows instead of saying plainly that nothing was found.
  const allSectionRows = [experienceRows, educationRows, languageRows, certificationRows, courseRows];
  const hasAnySectionData = allSectionRows.some((rows) => rows.length > 0);
  const sectionSources = [...new Set(allSectionRows.flat().map((r) => r.source))].sort();

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
                {(() => {
                  const p = provenanceOf(sources[f.sourceKey], !!(values[f.key] ?? "").trim());
                  return (
                    <Badge
                      variant="outline"
                      className={`shrink-0 w-[104px] justify-center text-[10px] ${p.className}`}
                      title={`Provenance: ${p.label}`}
                    >
                      {p.label}
                    </Badge>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>

        {/* Everything enrichment returned that ISN'T one of the flat editable
            fields above. The two sections this replaces each rendered only
            when their own data existed, so the block below the fields changed
            shape lead to lead -- and a lead with only languages, or only
            certifications, showed nothing at all. One section now, with a
            fixed row order, and an explicit line when there's nothing. */}
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            Additional profile data found
            {/* The badge used to say "Parallel" unconditionally, which was
                wrong twice over: on LinkedIn these rows come from Bright
                Data (Parallel cannot see them behind the login wall), and a
                merged list can carry both. Provenance now lives per row. */}
            {sectionSources.map((s) => (
              <Badge
                key={s}
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]"
              >
                {SOURCE_LABEL[s] ?? s}
              </Badge>
            ))}
          </div>

          {!hasAnySectionData ? (
            <p className="text-xs text-muted-foreground/70">
              No deeper profile data for this lead yet — no source has returned experience, education,
              languages or certifications.
            </p>
          ) : (
            <div className="space-y-2">
              {([
                ["Experience", experienceRows],
                ["Education", educationRows],
                ["Languages", languageRows],
                ["Certifications", certificationRows],
                ["Courses", courseRows],
              ] as const).map(([title, rows]) => (
                <div key={title} className="grid grid-cols-[130px_1fr] gap-3 text-sm items-start">
                  <Label className="text-muted-foreground text-xs pt-0.5">{title}</Label>
                  {rows.length > 0 ? (
                    <ul className="space-y-0.5">
                      {rows.map((r, i) => (
                        <li key={i} className="text-xs leading-relaxed flex items-start gap-1.5">
                          <span className="flex-1">{r.text}</span>
                          <span
                            className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/50 pt-0.5"
                            title={`Found by ${SOURCE_LABEL[r.source] ?? r.source}`}
                          >
                            {r.source === "brightdata" ? "BD" : "P"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">None found</span>
                  )}
                </div>
              ))}

              {extraParallelEntries.length > 0 && (
                <details className="pt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    {extraParallelEntries.length} more field(s) returned by enrichment
                  </summary>
                  <div className="mt-1.5 space-y-1">
                    {extraParallelEntries.map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[130px_1fr] gap-3 items-start">
                        <Label className="text-muted-foreground text-[11px] pt-0.5">{key}</Label>
                        <span className="text-xs break-words text-foreground/80">
                          {typeof value === "object" ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

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
