/** Normalized Lead type and record parser.
 * Direct port of drafting_service/core/leads.py — keep in sync by eye.
 * `load_leads`/`load_leads_from_file` (CLI/XLSX batch mode) were dropped
 * during the port: confirmed dev-only, nothing in server/client/deploy docs
 * invokes them. */

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const lower = s.toLowerCase();
  if (!s || ["null", "none", "n/a", "na", "-", "[missing input]", "missing"].includes(lower)) {
    return null;
  }
  return s;
}

function splitList(value: unknown): string[] {
  const s = clean(value);
  if (!s) return [];
  return s
    .replace(/;/g, ",")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Clay's list-shaped fields (experience/education/languages/courses) arrive
 * already parsed as a JSON array -- just guard against a missing or
 * malformed value rather than assuming the shape. */
function asList(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function toInt(value: unknown): number | null {
  const s = clean(value);
  if (s === null) return null;
  const f = Number(s);
  if (Number.isNaN(f)) return null;
  return Math.trunc(f);
}

/** A language/course entry may be a plain string or a dict (Clay's real
 * payloads use both depending on the field) -- extract a readable label
 * either way, or "" if there's nothing usable. */
function labelOf(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const e = entry as Record<string, unknown>;
    const val = e.language || e.name || e.title || "";
    return String(val).trim();
  }
  return "";
}

// Must match promptBuilder's BRAND.company (lowercased) -- kept as a plain
// constant here rather than imported, since promptBuilder imports Lead from
// this module and importing back would create a circular import.
const OWN_COMPANY_NAMES = new Set(["global3"]);

/** Extract a short, specific excerpt from a role's free-text summary --
 * confirmed against real Clay data (Avik Chakraborty's "Enrich person"
 * payload) that these summaries carry genuinely specific, quotable detail
 * (named shows, companies, technologies -- e.g. "lent my voice for
 * Paramount Pictures' Kung Fu Panda") that generic title/company/dates
 * completely misses. Strips bullet markers/newlines, then truncates at a
 * sentence or word boundary (never mid-word) so the excerpt reads cleanly
 * -- the drafting prompt is responsible for picking the single best detail
 * out of this, not for using the whole thing. */
function roleHighlight(entry: Record<string, any>, maxChars = 220): string {
  const raw = entry.summary || entry.Summary || entry.description;
  if (!raw || typeof raw !== "string") return "";
  // Bullet markers (•) and newlines collapse to a single space so multi-line
  // bullet lists read as one flowing excerpt instead of fragmenting
  // mid-sentence at the truncation point.
  let text = raw.replace(/[•\n\r]+/g, " ").trim();
  text = text.replace(/\s{2,}/g, " ");
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  // Prefer cutting at the last sentence boundary; fall back to word boundary.
  for (const boundary of [". ", ", "]) {
    const idx = truncated.lastIndexOf(boundary);
    if (idx > maxChars * 0.4) {
      return truncated.slice(0, idx + 1).replace(/\s+$/, "");
    }
  }
  const idx = truncated.lastIndexOf(" ");
  const base = idx > 0 ? truncated.slice(0, idx) : truncated;
  return base.replace(/\s+$/, "") + "…";
}

/** One Clay experience/role entry -> 'Title at Company (start–end): highlight'.
 * Defensive about key naming (confirmed both snake_case and camelCase appear
 * in real captured Clay payloads depending on which action produced them) --
 * omits whatever piece is missing rather than guessing. */
function formatRole(entry: Record<string, any>): string {
  const title = entry.title || entry.Title;
  const company = entry.company || entry.Company || entry.org;
  const start = entry.startDate || entry.start_date;
  const end = entry.endDate || entry.end_date;
  const labelParts: string[] = title ? [String(title)] : [];
  if (company) labelParts.push(`at ${company}`);
  let label = labelParts.join(" ");
  if (!label) return "";
  if (start) {
    label = `${label} (${start}–${end || "present"})`;
  }
  const highlight = roleHighlight(entry);
  if (highlight) return `${label}: ${highlight}`;
  return label;
}

export interface LeadFields {
  firstName: string;
  caseId?: string | null;
  fullName?: string | null;
  country?: string | null;
  source?: string | null;
  profileLink?: string | null;
  email?: string | null;
  services?: string[];
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  secondaryLanguages?: string[];
  yearsOfExp?: number | null;
  vendorExperience?: string | null;
  enrichmentStatus?: string | null;
  headline?: string | null;
  aboutSnippet?: string | null;
  currentTitle?: string | null;
  toolsSoftware?: string[];
  certifications?: string[];
  experience?: Record<string, any>[];
  education?: Record<string, any>[];
  languages?: unknown[];
  courses?: unknown[];
  clayFullData?: Record<string, any> | null;
  rawScrapeData?: any;
}

/** A normalized, enriched lead — the sole read-only input to draft generation. */
export class Lead {
  readonly firstName: string;
  readonly caseId: string | null;
  readonly fullName: string | null;
  readonly country: string | null;
  readonly source: string | null;
  readonly profileLink: string | null;
  readonly email: string | null;
  readonly services: string[];
  readonly sourceLanguage: string | null;
  readonly targetLanguage: string | null;
  readonly secondaryLanguages: string[];
  readonly yearsOfExp: number | null;
  readonly vendorExperience: string | null;
  readonly enrichmentStatus: string | null;
  readonly headline: string | null;
  readonly aboutSnippet: string | null;
  readonly currentTitle: string | null;
  readonly toolsSoftware: string[];
  readonly certifications: string[];
  // Clay's full-fidelity enrichment -- specific past roles/companies/dates,
  // not the lossy thin summary above. Each entry is whatever dict shape
  // Clay's "Enrich person" action returned (title/company/start_date/
  // end_date, etc.), rendered into a concise, specific grounding fact in
  // groundingFacts() below.
  readonly experience: Record<string, any>[];
  readonly education: Record<string, any>[];
  readonly languages: unknown[];
  readonly courses: unknown[];
  // The COMPLETE raw Clay payload, verbatim, on top of the curated fields
  // above -- deliberately included so the model can mine anything not
  // explicitly modeled by this class (connections, volunteering,
  // structured_location, etc.), rather than a code-level decision in
  // advance about what's "relevant". Rendered as a labeled supplementary
  // block in the prompt (see promptBuilder.fullRawDataBlock), still bound by
  // the same "never invent, only use what's literally present" rule.
  readonly clayFullData: Record<string, any> | null;
  // Same principle, extended to the primary scrape source (Bright Data for
  // LinkedIn, Tavily for ProZ/ATA/etc.) -- shape varies by provider (Bright
  // Data returns a list, Tavily a dict), so this is `any`, not a fixed type.
  readonly rawScrapeData: any;

  constructor(fields: LeadFields) {
    this.firstName = fields.firstName;
    this.caseId = fields.caseId ?? null;
    this.fullName = fields.fullName ?? null;
    this.country = fields.country ?? null;
    this.source = fields.source ?? null;
    this.profileLink = fields.profileLink ?? null;
    this.email = fields.email ?? null;
    this.services = fields.services ?? [];
    this.sourceLanguage = fields.sourceLanguage ?? null;
    this.targetLanguage = fields.targetLanguage ?? null;
    this.secondaryLanguages = fields.secondaryLanguages ?? [];
    this.yearsOfExp = fields.yearsOfExp ?? null;
    this.vendorExperience = fields.vendorExperience ?? null;
    this.enrichmentStatus = fields.enrichmentStatus ?? null;
    this.headline = fields.headline ?? null;
    this.aboutSnippet = fields.aboutSnippet ?? null;
    this.currentTitle = fields.currentTitle ?? null;
    this.toolsSoftware = fields.toolsSoftware ?? [];
    this.certifications = fields.certifications ?? [];
    this.experience = fields.experience ?? [];
    this.education = fields.education ?? [];
    this.languages = fields.languages ?? [];
    this.courses = fields.courses ?? [];
    this.clayFullData = fields.clayFullData ?? null;
    this.rawScrapeData = fields.rawScrapeData ?? null;
  }

  /** Best single 'language' label for the outreach. */
  get primaryLanguage(): string {
    return this.targetLanguage || this.sourceLanguage || "language";
  }

  /** True if the lead has a valid email address. */
  get hasEmail(): boolean {
    return !!(this.email && this.email.includes("@"));
  }

  /** True only if the lead has a genuine LinkedIn profile URL (not just any profile link). */
  get hasLinkedin(): boolean {
    if (!this.profileLink) return false;
    const link = this.profileLink.toLowerCase();
    return link.includes("linkedin.com/in/") || link.includes("linkedin.com/pub/");
  }

  /** True if the lead is enriched. */
  get isEnriched(): boolean {
    if (this.enrichmentStatus) {
      const status = this.enrichmentStatus.trim().toLowerCase();
      if (["no public data", "pending", "failed", "invalid"].includes(status)) return false;
      if (["enriched", "ok", "complete", "enrichment_complete"].includes(status)) return true;
    }
    const hasRealName = !!(this.firstName && !["there", "test"].includes(this.firstName.toLowerCase()));
    const hasDetails = !!(
      this.services.length ||
      this.sourceLanguage ||
      this.targetLanguage ||
      this.yearsOfExp !== null ||
      this.email
    );
    return hasRealName && hasDetails;
  }

  /** True if at least one of this.services is corroborated by the lead's OWN
   * scraped signals (current_title, headline, about_snippet, tools/certs,
   * recent experience) -- not just the target service tag we're recruiting
   * them for. `services` is set at lead-creation time to say what Global3
   * wants to recruit this person FOR; it is not itself evidence of the
   * person's actual background, and the draft prompt has no other signal
   * to tell those apart. Fails OPEN (returns true) when there's simply no
   * real profile data yet to check against -- this only catches the case
   * where we DO know their real background and it doesn't match, not thin
   * profiles we haven't enriched yet. */
  private hasServiceCorroboration(): boolean {
    if (!this.services.length) return true;
    const haystack = [
      this.currentTitle,
      this.headline,
      this.aboutSnippet,
      this.toolsSoftware.join(" "),
      this.certifications.join(" "),
      ...this.experience.map((e) => (e && typeof e === "object" && !Array.isArray(e) ? formatRole(e) : "")),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack) return true;
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.services.some((s) => new RegExp(`\\b${escapeRegExp(s.toLowerCase())}\\b`).test(haystack));
  }

  /** The ONLY facts the model is allowed to use, as a flat dict. */
  groundingFacts(): Record<string, string> {
    const facts: Record<string, string> = { first_name: this.firstName };
    if (this.fullName) facts.full_name = this.fullName;
    if (this.country) facts.country = this.country;
    if (this.targetLanguage) facts.target_language = this.targetLanguage;
    if (this.sourceLanguage) facts.source_language = this.sourceLanguage;
    if (this.secondaryLanguages.length) facts.secondary_languages = this.secondaryLanguages.join(", ");
    // Only claim services as a fact about THEM when their own real profile
    // signals actually back it up -- otherwise this is just our internal
    // recruiting target for this lead, not something to tell them we
    // "noticed." Omitting it here (rather than a new prompt rule) means the
    // model falls back to whatever else is real (current_title, tools,
    // etc.) via the existing "if absent, don't mention it" rule below.
    if (this.services.length && this.hasServiceCorroboration()) facts.services = this.services.join(", ");
    if (this.yearsOfExp !== null) facts.years_of_experience = `${this.yearsOfExp} years`;
    if (this.vendorExperience) facts.current_role_or_company = this.vendorExperience;
    if (this.currentTitle) facts.current_title = this.currentTitle;
    if (this.headline) facts.headline = this.headline;
    if (this.toolsSoftware.length) facts.tools_software = this.toolsSoftware.join(", ");
    if (this.certifications.length) facts.certifications = this.certifications.join(", ");
    if (this.aboutSnippet) facts.about_snippet = this.aboutSnippet;

    // Clay's richer data -- rendered concisely (most recent 1-2 roles, not
    // the whole array) so the model has specific, named material to draw on
    // without the prompt ballooning. Never invents structure: if a field is
    // missing from an entry, it's just omitted, same discipline as every
    // other fact here.
    if (this.experience.length) {
      // Skip roles at our own company -- confirmed against real test data
      // that a lead's most recent entry can be a role at Global3 itself
      // (e.g. a current/former contractor), which would make for a
      // nonsensical "personalization" ("we noticed you work at us"). Must
      // match promptBuilder's BRAND.company (not imported directly --
      // promptBuilder already imports Lead from here, so importing back
      // would be circular).
      const externalEntries = this.experience.filter(
        (e) =>
          e &&
          typeof e === "object" &&
          !Array.isArray(e) &&
          !OWN_COMPANY_NAMES.has(String(e.company || e.Company || "").trim().toLowerCase())
      );
      const topRoles = externalEntries.slice(0, 2).map(formatRole).filter(Boolean);
      if (topRoles.length) facts.recent_experience = topRoles.join("; ");
    }

    if (this.education.length && this.education[0] && typeof this.education[0] === "object" && !Array.isArray(this.education[0])) {
      const edu = this.education[0] as Record<string, any>;
      // `school_name` confirmed as the real key in captured Clay data (not
      // `school`) -- kept both for defensiveness.
      const inst = edu.institution || edu.school_name || edu.school;
      const degree = edu.degree;
      const fieldOfStudy = edu.field_of_study;
      const eduParts = [degree, fieldOfStudy, inst].filter((x) => x && String(x).toLowerCase() !== "not specified");
      if (eduParts.length) facts.education = eduParts.join(", ");
    }

    if (this.languages.length) {
      facts.additional_languages_spoken = this.languages
        .slice(0, 5)
        .map(labelOf)
        .filter(Boolean)
        .join(", ");
    }
    if (this.courses.length) {
      facts.courses_completed = this.courses.slice(0, 3).map(labelOf).filter(Boolean).join(", ");
    }

    return facts;
  }
}

/** Result of the automatic-trigger eligibility gate for one (lead, channel) pair. */
export interface ChannelEligibility {
  channel: string;
  eligible: boolean;
  reason: string; // "OK" | "NO_EMAIL" | "NO_LINKEDIN_PROFILE" | "MANUAL_OVERRIDE" | "UNKNOWN_CHANNEL:<x>"
  manualOverride: boolean;
}

/** Does `lead` have the contact data required to auto-generate a draft for
 * `channel`? Bypassed unconditionally when manualOverride=true (an explicit
 * recruiter-selected trigger gets full discretion once a lead has been
 * explicitly chosen). */
export function checkChannelEligibility(lead: Lead, channel: string, manualOverride = false): ChannelEligibility {
  if (manualOverride) {
    return { channel, eligible: true, reason: "MANUAL_OVERRIDE", manualOverride: true };
  }
  if (channel === "email") {
    return { channel, eligible: lead.hasEmail, reason: lead.hasEmail ? "OK" : "NO_EMAIL", manualOverride: false };
  }
  if (channel === "linkedin") {
    return {
      channel,
      eligible: lead.hasLinkedin,
      reason: lead.hasLinkedin ? "OK" : "NO_LINKEDIN_PROFILE",
      manualOverride: false,
    };
  }
  return { channel, eligible: false, reason: `UNKNOWN_CHANNEL:${channel}`, manualOverride: false };
}

/** Normalize one raw enriched-lead record (PascalCase field names, matching
 * server/src/lib/draftLeadPayload.ts's buildDraftLeadPayload output). */
export function fromRecord(rec: Record<string, any>): Lead {
  return new Lead({
    firstName: clean(rec.First_Name) ?? clean(rec.first_name) ?? "there",
    caseId: clean(rec.Case_ID),
    fullName: clean(rec.Full_Name) ?? clean(rec.full_name),
    country: clean(rec.Country_of_Residence) ?? clean(rec.country),
    source: clean(rec.Source) ?? clean(rec.source),
    profileLink: clean(rec.Profile_Link) ?? clean(rec.profile_link),
    email: clean(rec.Email_Address) ?? clean(rec.email),
    services: splitList(rec.Services ?? rec.services),
    sourceLanguage: clean(rec.Source_Language) ?? clean(rec.source_language),
    targetLanguage: clean(rec.Target_Language) ?? clean(rec.target_language),
    secondaryLanguages: splitList(rec.Secondary_Languages ?? rec.secondary_languages),
    yearsOfExp: toInt(rec.Years_of_Exp ?? rec.years_of_exp),
    vendorExperience: clean(rec.Vendor_Experience) ?? clean(rec.vendor_experience),
    enrichmentStatus: clean(rec.Enrichment_Status) ?? clean(rec.enrichment_status),
    headline: clean(rec.Headline) ?? clean(rec.headline),
    aboutSnippet: clean(rec.About_Snippet) ?? clean(rec.about_snippet),
    currentTitle: clean(rec.Current_Title) ?? clean(rec.current_title),
    toolsSoftware: splitList(rec.Tools_Software ?? rec.tools_software),
    certifications: splitList(rec.Certifications ?? rec.certifications),
    experience: asList(rec.Clay_Experience),
    education: asList(rec.Clay_Education),
    languages: asList(rec.Clay_Languages),
    courses: asList(rec.Clay_Courses),
    clayFullData:
      rec.Clay_Full_Data && typeof rec.Clay_Full_Data === "object" && !Array.isArray(rec.Clay_Full_Data)
        ? rec.Clay_Full_Data
        : null,
    rawScrapeData: rec.Raw_Scrape_Data ? rec.Raw_Scrape_Data : null,
  });
}
