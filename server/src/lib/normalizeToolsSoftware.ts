// Keep in sync with enrichment_pipeline/parsers/tool_aliases.py -- Python
// and this Node service are separate projects with no shared package, so
// this list is duplicated deliberately, same convention as
// normalizeServices.ts / STANDARD_SERVICES.
export const STANDARD_TOOLS = [
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

// Keep in sync with enrichment_pipeline/parsers/tool_aliases.py's
// TOOL_ALIASES -- alias PHRASES for substring-scanning free-flowing text
// (matchToolsInText below), distinct from SYNONYMS above (which matches one
// already-delimiter-split token exactly, not a substring within prose).
const TOOL_ALIASES: Record<string, string[]> = {
  "Ableton Live": ["ableton live", "ableton"],
  "Adobe Audition": ["adobe audition", "audition"],
  "Adobe Premiere Pro": ["adobe premiere pro", "premiere pro", "adobe premiere"],
  Audacity: ["audacity"],
  "Avid Media Composer": ["avid media composer"],
  Cubase: ["cubase"],
  "DaVinci Resolve": ["davinci resolve", "da vinci resolve", "resolve"],
  "Final Cut Pro": ["final cut pro", "final cut", "fcpx"],
  "Logic Pro": ["logic pro"],
  Nuendo: ["nuendo"],
  "Pro Tools": ["pro tools", "protools"],
  "Studio One": ["studio one"],
  XL8: ["xl8"],
  Smartcat: ["smartcat", "smart cat"],
  MemoQ: ["memoq", "memo q"],
  MemSource: ["memsource", "mem source"],
  DeepL: ["deepl", "deep l"],
  Aegisub: ["aegisub"],
  EZTitle: ["eztitle", "ez title", "eztitles"],
  iMediaTrans: ["imediatrans", "i media trans"],
  Jubler: ["jubler"],
  MacCaptions: ["maccaptions", "mac captions"],
  Ooona: ["ooona"],
  PlintCore: ["plintcore", "plint core"],
  Polaris: ["polaris"],
  PXL: ["pxl"],
  Sfera: ["sfera"],
  "Subtitle Edit": ["subtitle edit"],
  Swift: ["swift"],
  WinCaps: ["wincaps"],
  ZooSub: ["zoosub", "zoo sub"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Scans free-flowing text (not delimiter-split tokens) for any mention of
 *  a canonical tool, in declaration order -- mirrors
 *  enrichment_pipeline/parsers/tool_aliases.py's extract_tools_from_text.
 *
 *  Word-boundary match, not a bare substring check -- confirmed live: a
 *  plain `.includes()` check matched "avid" (the tool) inside the ordinary
 *  English adjective "avid" ("an avid translator"); the bare "avid" alias
 *  was removed for the same reason, keeping only the safe, equally
 *  matchable full phrase "Avid Media Composer". */
export function matchToolsInText(text: string): string[] {
  const lowered = text.toLowerCase();
  const matched: string[] = [];
  for (const [canonical, aliases] of Object.entries(TOOL_ALIASES)) {
    if (!matched.includes(canonical) && aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(lowered))) {
      matched.push(canonical);
    }
  }
  return matched;
}

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
