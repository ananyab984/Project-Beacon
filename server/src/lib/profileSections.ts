/**
 * The deep profile sections (experience / education / languages /
 * certifications / courses), normalized to ONE shape and merged across every
 * source that found them.
 *
 * Why this exists: the enrichment-details dialog read `lead.parallelData` and
 * nothing else, so Parallel was the only source that could ever appear under
 * "Additional profile data found". That was fine while Parallel was assumed to
 * be the deep-data tier -- and it is, for ProZ/Bodalgo/personal sites. It is
 * NOT for LinkedIn, and the difference was measured rather than guessed
 * (2026-09-08, same output schema and same task instruction, one URL each):
 *
 *   LinkedIn  + processor "pro"   -> experience 0, education 0, languages 0
 *   ProZ      + processor "base"  -> education 1, languages 3, certifications 3
 *
 * LinkedIn keeps those sections behind its login wall, so Parallel's agent
 * only ever sees the public preview (headline, name, location, sometimes
 * About). Bright Data gets them because an authenticated scraping network is
 * exactly what it is for -- and it returned, for one real lead, 4 languages
 * WITH proficiency, 10 certifications and 29 courses, every one of which the
 * UI displayed as "None found".
 *
 * On a linguist recruitment platform, language + proficiency is the
 * qualifying field. Discarding it was the most expensive bug of the set.
 *
 * Computed at read time, never stored: same pattern (and same reasoning) as
 * enrichmentCount.ts's `withEnrichedFieldCount` -- a re-enrichment or a manual
 * edit is reflected immediately, and no migration is needed for a value that
 * is derivable from `rawScrapeData` + `parallelData`, both of which are
 * already persisted verbatim.
 */

/** One normalized entry, plus which provider found it. */
export interface SectionEntry {
  source: "brightdata" | "parallel";
  [key: string]: unknown;
}

export interface ProfileSections {
  experience: SectionEntry[];
  education: SectionEntry[];
  languages: SectionEntry[];
  certifications: SectionEntry[];
  courses: SectionEntry[];
}

const EMPTY: ProfileSections = { experience: [], education: [], languages: [], certifications: [], courses: [] };

/** Bright Data hands back LinkedIn's raw HTML text, entities included -- a
 *  real stored About read "Classical Greek &amp; Latin graduate". These
 *  strings are quoted back to candidates by drafting, so an undecoded entity
 *  is a defect in a message to a real person. Node has no html.unescape, and
 *  the named set that actually appears in scraped profile text is small and
 *  closed; numeric forms are handled generically. */
export function decodeEntities(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s.includes("&")) return s;
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" } as Record<string, string>)[name] ?? _
    );
}

const clean = (v: unknown): string | undefined => {
  const s = decodeEntities(v).replace(/\s{2,}/g, " ").trim();
  // "-" and "." are Bright Data's placeholders for an absent value on sparse
  // profiles, not data. Letting them through renders rows that say nothing.
  return s && s !== "-" && s !== "." ? s : undefined;
};

/** Anything with at least one real value beyond its own `source` tag. */
const isSubstantive = (e: SectionEntry): boolean =>
  Object.entries(e).some(([k, v]) => k !== "source" && v != null && String(v).trim() !== "");

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x != null) : []);

/**
 * Bright Data's LinkedIn shapes, confirmed against real stored payloads:
 *   languages      [{title:"Spanish", subtitle:"Native or bilingual proficiency"}]
 *   certifications [{title, subtitle:issuer, meta:"Issued Sep 2023", credential_url}]
 *   courses        [{title:"A Table! …", subtitle:"FRN371"}]
 *   education      [{title:institution, start_year, end_year, url}]   // no degree key
 *   experience     [{company, duration, subtitle, description_html}]  // no title key,
 *                                                                     // and null on
 *                                                                     // nearly every profile
 * Target keys are the ones both consumers already read -- the dialog's
 * formatRole/formatEducation/labelOf and drafting's _format_role/_label_of --
 * which are also exactly the keys parallel_client.py's ExperienceEntry/
 * EducationEntry/LanguageEntry emit. One shape, either source.
 */
function fromBrightData(raw: unknown): ProfileSections {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const p = (list[0] ?? {}) as Record<string, unknown>;
  if (!p || typeof p !== "object") return EMPTY;

  const languages = asArray(p.languages).map((e) => ({
    source: "brightdata" as const,
    language: clean(e.title ?? e.language ?? e.name),
    proficiency: clean(e.subtitle ?? e.proficiency),
  }));

  const education = asArray(p.education).map((e) => ({
    source: "brightdata" as const,
    institution: clean(e.title ?? e.institution ?? e.school_name),
    degree: clean(e.degree),
    field_of_study: clean(e.field_of_study),
    start_date: clean(e.start_year ?? e.start_date),
    end_date: clean(e.end_year ?? e.end_date),
  }));

  // `educations_details` is a bare school-name string that appears even when
  // the structured `education` array is null -- worth one entry rather than
  // showing nothing.
  if (!education.length && clean(p.educations_details)) {
    education.push({
      source: "brightdata" as const,
      institution: clean(p.educations_details),
      degree: undefined, field_of_study: undefined, start_date: undefined, end_date: undefined,
    });
  }

  const experience = asArray(p.experience).map((e) => ({
    source: "brightdata" as const,
    // No `title` key in this revision; `subtitle` is where a role title turns
    // up when it turns up at all, so it is read as one but never invented.
    title: clean(e.title ?? e.subtitle),
    company: clean(e.company ?? e.company_name),
    start_date: clean(e.start_date ?? e.duration),
    end_date: clean(e.end_date),
    summary: clean(e.description ?? e.description_html),
  }));

  const certifications = asArray(p.certifications)
    .map((e) => clean(typeof e === "string" ? e : e.title ?? e.name))
    .filter(Boolean)
    .map((title) => ({ source: "brightdata" as const, title: title as string }));

  const courses = asArray(p.courses)
    .map((e) => clean(typeof e === "string" ? e : e.title ?? e.name))
    .filter(Boolean)
    .map((title) => ({ source: "brightdata" as const, title: title as string }));

  return { experience, education, languages, certifications, courses };
}

/** Parallel already emits the target shape (see providers/parallel_client.py's
 *  nested entry models), so this only tags provenance and drops shells. */
function fromParallel(raw: unknown): ProfileSections {
  const p = (raw ?? {}) as Record<string, unknown>;
  const tag = (v: unknown) =>
    asArray(v).map((e) =>
      typeof e === "string"
        ? { source: "parallel" as const, title: clean(e) }
        : { source: "parallel" as const, ...Object.fromEntries(Object.entries(e).map(([k, val]) => [k, clean(val)])) }
    );
  return {
    experience: tag(p.experience),
    education: tag(p.education),
    languages: tag(p.languages),
    certifications: tag(p.certifications),
    courses: tag(p.courses),
  };
}

/** Case/whitespace-insensitive identity for de-duplication across sources. */
const dedupeKey = (e: SectionEntry): string =>
  Object.entries(e)
    .filter(([k]) => k !== "source")
    .map(([, v]) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");

/**
 * Union of both sources per section, de-duplicated, Bright Data first.
 *
 * A union rather than "whichever source found more": the two see genuinely
 * different slices of the same person (Bright Data reads the authenticated
 * page, Parallel reads the public web around it), so picking one wholesale
 * throws away real entries. Bright Data leads because on LinkedIn it is the
 * only source that can see these sections at all; where it found nothing the
 * list is simply Parallel's.
 */
export function mergeProfileSections(lead: {
  rawScrapeData?: unknown;
  parallelData?: unknown;
}): ProfileSections {
  const bd = fromBrightData(lead.rawScrapeData);
  const pl = fromParallel(lead.parallelData);
  const out = { ...EMPTY } as ProfileSections;
  for (const key of Object.keys(EMPTY) as (keyof ProfileSections)[]) {
    const seen = new Set<string>();
    out[key] = [...bd[key], ...pl[key]].filter((e) => {
      if (!isSubstantive(e)) return false;
      const k = dedupeKey(e);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}
