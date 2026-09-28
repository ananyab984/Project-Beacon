// Keep in sync with enrichment_pipeline/parsers/tool_aliases.py -- Python
// and this Node service are separate projects with no shared package, so
// this list is duplicated deliberately, same convention as
// normalizeServices.ts / STANDARD_SERVICES.
const STANDARD_TOOLS = [
  "Ableton Live",
  "Adobe Audition",
  "Adobe Premiere Pro",
  "Audacity",
  "Avid Media Composer",
  "Cubase",
  "DaVinci Resolve",
  "Final Cut Pro",
  "Logic Pro",
  "Nuendo",
  "Pro Tools",
  "Studio One",
  "XL8",
  "Smartcat",
  "MemoQ",
  "MemSource",
  "DeepL",
  "Aegisub",
  "EZTitle",
  "iMediaTrans",
  "Jubler",
  "MacCaptions",
  "Ooona",
  "PlintCore",
  "Polaris",
  "PXL",
  "Sfera",
  "Subtitle Edit",
  "Swift",
  "WinCaps",
  "ZooSub",
];

// Real variant spellings a plain case-insensitive match against
// STANDARD_TOOLS wouldn't catch (no space / short form), same reasoning as
// normalizeServices.ts's SYNONYMS.
const SYNONYMS: Record<string, string> = {
  protools: "Pro Tools",
  premiere: "Adobe Premiere Pro",
  "premiere pro": "Adobe Premiere Pro",
  resolve: "DaVinci Resolve",
  "final cut": "Final Cut Pro",
  fcpx: "Final Cut Pro",
  "memo q": "MemoQ",
  "mem source": "MemSource",
  "deep l": "DeepL",
  "ez title": "EZTitle",
  eztitles: "EZTitle",
  "plint core": "PlintCore",
  "zoo sub": "ZooSub",
  "mac captions": "MacCaptions",
  "i media trans": "iMediaTrans",
};

const CANONICAL_BY_LOWER = new Map(STANDARD_TOOLS.map((s) => [s.toLowerCase(), s]));

/**
 * Splits a raw tools/software string/array into canonical STANDARD_TOOLS
 * values wherever possible. A token that's genuinely not a known tool or
 * synonym is kept as-is (trimmed) rather than dropped -- normalizes what it
 * recognizes without ever discarding real data.
 */
export function normalizeToolsSoftware(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => s.split(/[,;/|]+/))
    .map((s) => s.trim())
    .filter(Boolean);

  const normalized = tokens.map((token) => {
    const lower = token.toLowerCase();
    return CANONICAL_BY_LOWER.get(lower) ?? SYNONYMS[lower] ?? token;
  });

  return Array.from(new Set(normalized));
}
