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

/** Parallel's list-shaped fields (experience/education/languages) arrive
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
  parallelFullData?: Record<string, any> | null;
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
  // Parallel's full-fidelity enrichment -- specific past roles/companies/
  // dates, not the lossy thin summary above. Each entry is whatever dict
  // shape Parallel's Task Run returned (title/company/start_date/end_date,
  // etc. -- see enrichment_pipeline/providers/parallel_client.py's
  // LeadProfile), rendered into a concise, specific grounding fact in
  // groundingFacts() below. `courses` has no Parallel equivalent -- kept as
  // an always-empty field rather than removed, so nothing else on this
  // class needs to special-case its absence.
  readonly experience: Record<string, any>[];
  readonly education: Record<string, any>[];
  readonly languages: unknown[];
  readonly courses: unknown[];
  // The COMPLETE raw Parallel payload, verbatim, on top of the curated
  // fields above -- deliberately included so the model can mine anything not
  // explicitly modeled by this class, rather than a code-level decision in
  // advance about what's "relevant". Rendered as a labeled supplementary
  // block in the prompt (see promptBuilder.fullRawDataBlock), still bound by
  // the same "never invent, only use what's literally present" rule.
  readonly parallelFullData: Record<string, any> | null;
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
    this.parallelFullData = fields.parallelFullData ?? null;
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

    // Parallel's richer data -- rendered concisely (most recent 1-2 roles, not
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
      // Three roles rather than two: each entry's post-colon excerpt is the
      // richest source of named productions/clients/tools, and the draft now
      // has to cite TWO distinct specifics -- a two-role window too often
      // offered only one usable name.
      const topRoles = externalEntries.slice(0, 3).map(formatRole).filter(Boolean);
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

  /** Every concrete, NAMED detail this lead's profile offers -- the things a
   * draft can point to that prove somebody actually read the profile, as
   * opposed to the broad service category ("subtitling") that could apply to
   * thousands of linguists.
   *
   * Single source of truth for the specificity bar, shared by
   * draftGenerator's regenerate-once guard and evaluator's specificity check
   * so both agree on what counts. Deliberately excludes languages, country
   * and services -- those are already covered by evaluator's separate
   * personalization_depth check, and none of them is evidence of profile
   * reading on its own. */
  specificFactCandidates(): string[] {
    return this.collectFactCandidates().all;
  }

  /** The subset whose mention genuinely proves someone read this profile: a
   * named organization, school, tool, credential or field of study.
   *
   * Bare job titles are deliberately NOT here. A title like "Translator" or
   * "Voice Over Artist" is the generic name of the job, so a good draft often
   * (correctly) doesn't parrot it -- but while titles counted toward the
   * per-lead target, that absence was punished: confirmed live 2026-09-07, a
   * genuinely excellent draft naming "five years as an English/Spanish
   * captioner at Rev" and "transcribing Spanish interviews about migrants in
   * the U.S." was held at 1/2 purely because the lead's second "available
   * specific" was the bare title "Translator". The target is therefore sized
   * from strong candidates only, while citing a title still COUNTS toward
   * meeting it (see citedNamedSpecifics). */
  strongFactCandidates(): string[] {
    return this.collectFactCandidates().strong;
  }

  private collectFactCandidates(): { all: string[]; strong: string[] } {
    // `strong: false` marks a bare job title -- see strongFactCandidates().
    const tagged: Array<{ value: string; strong: boolean }> = [];
    const add = (v: unknown, strong: boolean) => {
      if (v) tagged.push({ value: String(v), strong });
    };

    for (const t of this.toolsSoftware) add(t, true);
    for (const c of this.certifications) add(c, true);
    add(this.currentTitle, false);
    if (this.vendorExperience) {
      for (const c of this.vendorExperience.split(",")) add(c.trim(), true);
    }
    // Named employers and role titles from the full work history -- richer
    // than vendorExperience's flattened summary, and the entries Parallel
    // returns carry the named productions/clients worth citing.
    for (const entry of this.experience) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, any>;
      for (const key of ["company", "Company", "org"]) add(e[key], true);
      for (const key of ["title", "Title"]) add(e[key], false);
    }
    for (const entry of this.education) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, any>;
      for (const key of ["school_name", "school", "institution", "field_of_study", "degree"]) {
        add(e[key], true);
      }
    }

    // De-duplicate case-insensitively, drop anything too short to be a
    // meaningful match ("QA", "IT") since a 2-char substring hits by accident,
    // and drop our own company so "at Global3" never counts as personalization.
    const seen = new Set<string>();
    const all: string[] = [];
    const strong: string[] = [];
    for (const { value, strong: isStrong } of tagged) {
      const f = value.trim();
      const key = f.toLowerCase();
      if (
        f.length < 3 ||
        seen.has(key) ||
        OWN_COMPANY_NAMES.has(key) ||
        isGenericRoleDescriptor(key)
      ) {
        continue;
      }
      seen.add(key);
      all.push(f);
      if (isStrong) strong.push(f);
    }
    return { all, strong };
  }

  /** The lowercased text a claimed named detail must be grounded in.
   *
   * Deliberately EXCLUDES the generic grounding facts -- country, services,
   * languages, years, full_name. Including all of groundingFacts() made the
   * bar self-defeating: "your Audio Description work in the United Kingdom"
   * grounded "United Kingdom" against the country fact and scored a named
   * specific, which is precisely the mail-merge phrasing this check exists
   * to reject. What's left is the material that can only come from reading
   * the profile: the raw enrichment payloads (which the prompt explicitly
   * invites the model to mine) plus the curated facts that are themselves
   * named details. */
  profileHaystack(): string {
    const facts = this.groundingFacts();
    const parts: string[] = [];
    for (const key of [
      "recent_experience", "education", "current_title", "headline",
      "tools_software", "certifications", "about_snippet",
      "current_role_or_company", "courses_completed",
    ]) {
      if (facts[key]) parts.push(facts[key]);
    }
    for (const payload of [this.parallelFullData, this.rawScrapeData]) {
      if (payload) parts.push(JSON.stringify(payload));
    }
    return parts.join(" \n ").toLowerCase();
  }

  /** EVERYTHING known about this lead, including the generic attributes
   * profileHaystack() leaves out.
   *
   * Distinct from profileHaystack() on purpose, and the two must not be
   * merged: this one answers "could the lead's data support saying this at
   * all?" (anti-fabrication), while the narrower one answers "is this a
   * detail that proves the profile was read?" (personalization). A language
   * pair like "British English" belongs in the first and not the second. */
  allKnownText(): string {
    const parts = Object.values(this.groundingFacts());
    for (const payload of [this.parallelFullData, this.rawScrapeData]) {
      if (payload) parts.push(JSON.stringify(payload));
    }
    return parts.join(" \n ").toLowerCase();
  }
}

// Employment descriptors that LOOK like a named employer or title but prove
// nothing about having read the profile -- "your background as a
// self-employed artist" is exactly the generic filler this bar exists to
// reject, and counting it also inflated the per-lead target so a lead whose
// only "named details" were "CEO" and "Self-employed" was held to a
// two-specific bar its profile could never meaningfully meet.
const GENERIC_ROLE_DESCRIPTORS = new Set([
  "self-employed", "self employed", "selfemployed", "freelance", "freelancer",
  "independent", "independent contractor", "contractor", "various",
  "multiple", "n/a", "na", "none", "unknown", "not specified",
  "sole proprietor", "own business", "various clients", "multiple clients",
]);

/** True if `lower` is a generic employment descriptor, or is one only
 * decorated with a job word ("Freelance Translator", "Self-employed Artist").
 * Exact-set membership alone wasn't enough: a scraped `company:
 * "Freelance Translator"` counted as a STRONG candidate and pushed the bar
 * to two specifics for a lead that had only one real name to cite -- a
 * permanent HOLD, which is the exact failure this set was added to prevent. */
function isGenericRoleDescriptor(lower: string): boolean {
  const cleaned = lower.trim();
  if (GENERIC_ROLE_DESCRIPTORS.has(cleaned)) return true;
  // Strip trailing generic job words, then re-test the stem.
  const stem = cleaned
    .replace(/\b(artist|translator|subtitler|linguist|interpreter|professional|worker|consultant|specialist)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stem.length > 0 && stem !== cleaned && GENERIC_ROLE_DESCRIPTORS.has(stem);
}

// Capitalized words that start sentences or are otherwise structural, so they
// never count as a "named detail" even though they match the proper-noun shape.
const NAMED_ENTITY_STOPWORDS = new Set([
  "hi", "hello", "i", "we", "at", "if", "any", "best", "regards", "the", "a", "an",
  "your", "you", "my", "our", "it", "this", "that", "there", "these", "those",
  "reading", "came", "saw", "noticed", "particularly", "combined", "apply", "visit",
  "should", "would", "could", "looking", "forward", "thanks", "thank", "resources",
  "team", "subject", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]);

/** Distinct NAMED details the body cites that are genuinely grounded in this
 * lead's own profile data.
 *
 * This is the measurement behind the specificity bar, and it deliberately
 * does NOT just intersect the body with `specificFactCandidates()`. Confirmed
 * live 2026-09-07: a draft that cited "Maruti Suzuki Arena" and "Joyalukkas"
 * -- both straight out of that lead's own Parallel role summaries, and
 * exactly the kind of detail that proves the profile was read -- scored 0,
 * because those names live in free-text role excerpts rather than in a
 * structured field the candidate list could enumerate. Measuring the other
 * way round (what did the body name, and is it grounded?) credits real
 * specificity wherever it came from.
 *
 * Counts two shapes: a multi-word capitalized phrase ("Dublin City
 * University"), and an exact hit on an enumerated candidate, which is what
 * catches single-token tools ("OOONA", "Trados"). A single stray capitalized
 * word is not enough on its own -- that would let "Italian" or a
 * sentence-initial word pass as named detail. */
export function citedNamedSpecifics(lead: Lead, body: string): string[] {
  const haystack = lead.profileHaystack();
  // The lead's own name must never read as a named detail. This relies on
  // Full_Name actually being populated: enrichment writes the resolved name
  // to displayName and leaves fullName null on most real rows, so
  // buildDraftLeadPayload falls Full_Name back to displayName -- without
  // that, a two-token name like "Ruturaaj k" slipped through this filter and
  // was credited as though it were an employer.
  const ownName = new Set(
    `${lead.fullName || ""} ${lead.firstName || ""}`.toLowerCase().split(/\s+/).filter(Boolean)
  );
  const isExcluded = (phrase: string) => {
    const lower = phrase.toLowerCase();
    if (isGenericRoleDescriptor(lower)) return true;
    const toks = lower.split(/\s+/);
    return (
      toks.every((t) => NAMED_ENTITY_STOPWORDS.has(t)) ||
      toks.every((t) => ownName.has(t)) ||
      toks.every((t) => OWN_COMPANY_NAMES.has(t))
    );
  };

  const found = new Map<string, string>();

  // Shape 1: runs of consecutive capitalized words. Deliberately does NOT
  // hop over connectors like "and"/"for" -- doing so merged two separate
  // entities into one phrase ("Maruti Suzuki Arena and Joyalukkas") that
  // appears nowhere in the profile verbatim, so a draft naming two real
  // productions scored zero for them.
  for (const m of body.matchAll(/\b[A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*)+/g)) {
    let toks = m[0].trim().split(/\s+/);
    // Drop leading structural words so "At Global3" / "Reading Dublin City
    // University" reduce to the real entity instead of being discarded.
    while (toks.length > 1 && NAMED_ENTITY_STOPWORDS.has(toks[0].toLowerCase())) toks = toks.slice(1);
    // Trim from the right until what's left is actually grounded: the phrase
    // as written can trail into words the profile doesn't pair with it
    // ("Translation Technology at Dublin City University Programme"), and the
    // grounded prefix is still a genuine named detail.
    while (toks.length >= 2) {
      const phrase = toks.join(" ");
      if (phrase.length >= 5 && !isExcluded(phrase) && haystack.includes(phrase.toLowerCase())) {
        found.set(phrase.toLowerCase(), phrase);
        break;
      }
      toks = toks.slice(0, -1);
    }
  }

  // Shape 2: an enumerated candidate named verbatim (single-token tools,
  // certifications, titles the phrase scan above would miss).
  const lowered = body.toLowerCase();
  for (const cand of lead.specificFactCandidates()) {
    const key = cand.toLowerCase();
    if (cand.length >= 3 && !isExcluded(cand) && lowered.includes(key)) found.set(key, cand);
  }

  // One mention must not score twice. The two shapes overlap: "Maruti Suzuki
  // Arena" (phrase scan) and the candidate "Maruti Suzuki" (enumerated) are
  // the same mention, and counting both cleared the two-specific email bar
  // off a single name. Keep the longest form of any nested pair.
  const keys = Array.from(found.keys()).sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const key of keys) {
    if (!kept.some((k) => k.includes(key))) kept.push(key);
  }
  return kept.map((k) => found.get(k)!);
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
    experience: asList(rec.Parallel_Experience),
    education: asList(rec.Parallel_Education),
    languages: asList(rec.Parallel_Languages),
    // No Parallel equivalent -- always empty (see the `courses` field's own
    // comment on the Lead class above).
    courses: asList(rec.Parallel_Courses),
    parallelFullData:
      rec.Parallel_Full_Data && typeof rec.Parallel_Full_Data === "object" && !Array.isArray(rec.Parallel_Full_Data)
        ? rec.Parallel_Full_Data
        : null,
    rawScrapeData: rec.Raw_Scrape_Data ? rec.Raw_Scrape_Data : null,
  });
}
