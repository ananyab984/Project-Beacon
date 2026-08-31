// Keep in sync with client/src/lib/services.ts -- client and server are
// separate TS projects with no shared package, so this list is duplicated
// deliberately rather than silently drifting the way the un-normalized raw
// service strings used to.
const STANDARD_SERVICES = [
  "AI Post-editing",
  "Audio Description",
  "CC",
  "Conform",
  "Dubbing",
  "Interpretation",
  "Localization QA",
  "Prelude",
  "Quality Control",
  "SDH",
  "Scripting",
  "Subtitling",
  "Transcreation",
  "Transcription",
  "Translation",
  "Voice Over",
];

// Real variant spellings confirmed live in ingested lead data (enrichment
// scrapes, CSV imports) that a plain case-insensitive match against
// STANDARD_SERVICES wouldn't catch -- e.g. "subtitling" already matches
// "Subtitling" case-insensitively, so it needs no entry here, but
// "voiceover" (no space) never matches "Voice Over" without one.
const SYNONYMS: Record<string, string> = {
  voiceover: "Voice Over",
  "voice-over": "Voice Over",
  interpreting: "Interpretation",
  sub: "Subtitling",
  qc: "Quality Control",
  "qc editor": "Quality Control",
  qa: "Quality Control",
  "closed captioning": "CC",
  "audio description (ad)": "Audio Description",
  "sdh (subtitles for deaf & hard of hearing)": "SDH",
  "sdh (subtitles for deaf and hard of hearing)": "SDH",
};

const CANONICAL_BY_LOWER = new Map(STANDARD_SERVICES.map((s) => [s.toLowerCase(), s]));

/**
 * Splits a raw services string/array into canonical STANDARD_SERVICES
 * values wherever possible. A token that's genuinely not one of the known
 * services or synonyms is kept as-is (trimmed) rather than dropped -- this
 * normalizes what it recognizes without ever discarding real data.
 */
export function normalizeServices(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => s.split(/[,;/:|]+/))
    .map((s) => s.trim())
    .filter(Boolean);

  const normalized = tokens.map((token) => {
    const lower = token.toLowerCase();
    return CANONICAL_BY_LOWER.get(lower) ?? SYNONYMS[lower] ?? token;
  });

  return Array.from(new Set(normalized));
}
