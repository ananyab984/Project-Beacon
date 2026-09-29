// Keep in sync with enrichment_pipeline/parsers/language_filter.py -- same
// deliberate-duplication convention as normalizeServices.ts/STANDARD_SERVICES.
//
// Lightweight non-English text detection -- a word-list sniff, not real
// language identification (same known ceiling as the Python original:
// upgrade path is a real detector like franc/lingua if this proves too
// blunt in practice, not worth a dependency for the handful of languages
// seen so far).
//
// Confirmed live: a real profile's BrightData `skills` list held both an
// English tag and its own-language duplicate side by side ("Teamwork" and
// "Trabalho em equipe"), both joined straight into Services with no
// language filtering at all.
const NON_ENGLISH_MARKERS = new Set([
  // Spanish / Portuguese
  "de", "la", "el", "los", "las", "con", "para", "por", "una", "como",
  "muy", "más", "también", "años", "voz", "trabajo", "em", "não", "uma",
  "del", "su", "sus", "está", "tradução", "português",
  // French
  "le", "les", "des", "une", "du", "au", "aux", "est", "sur", "avec",
  "pour", "dans", "traduction", "traductrice", "traducteur", "ans", "et",
  "à", "chez", "en", "formation", "expérience", "étudiante", "étudiant",
  "lieu", "ses", "son",
  // German
  "und", "der", "die", "das", "den", "von", "mit", "für", "ich", "auch",
  "sprachen", "jahre", "übersetzer", "übersetzerin",
  // Italian
  "il", "lo", "gli", "che", "con", "per", "sono", "anni", "voce",
  "traduzione", "esperienza",
  // Polish
  "redagowanie", "tłumaczenie",
]);

// Non-Latin scripts NON_ENGLISH_MARKERS can't catch at all (CJK, Hangul,
// Cyrillic, Arabic, Hebrew) -- confirmed live: a lead's duplicate
// Japanese-language skills text passed straight through untouched.
const NON_LATIN_RE = /[぀-ヿ㐀-鿿가-힯Ѐ-ӿ؀-ۿ֐-׿]/;

/** True for a SHORT string (a single skill/service tag, not a whole
 *  payload) that reads as non-English -- either non-Latin script, or
 *  containing one of NON_ENGLISH_MARKERS' European-language function
 *  words. A short, single-purpose tag needs only one hit to be worth
 *  dropping (unlike a whole-payload ratio check, which needs enough text
 *  to judge reliably). */
export function looksNonEnglishToken(text: string): boolean {
  if (NON_LATIN_RE.test(text)) return true;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.some((w) => NON_ENGLISH_MARKERS.has(w));
}
