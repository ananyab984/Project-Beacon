/**
 * Maps our internal human-readable language labels (client/src/lib
 * /languages.ts's STANDARD_LANGUAGES -- confirmed NOT already BCP47, e.g.
 * "German", "Portuguese (Brazilian)") to a BCP47-style language tag for the
 * `source_language`/`target_language` params G3's apply form expects
 * (contract example: "en-US", "pt-BR").
 *
 * Every entry picks one representative region for a language, since our
 * label doesn't otherwise specify one -- each choice is a deliberate,
 * defensible default (documented inline where it's not obvious), not a
 * guess invented at request time. A label with an explicit regional
 * qualifier already in it (e.g. "English (UK)", "Portuguese (Brazilian)")
 * maps to that exact region; a "plain" label picks the most common default
 * for that language.
 *
 * An unrecognized label returns undefined -- callers must omit the param
 * entirely rather than send a made-up tag.
 */
const LANGUAGE_LABEL_TO_BCP47: Record<string, string> = {
  // KNOWN JUDGMENT CALL, flagged for revisit: Arabic dialects vary more
  // than most languages in this table (Gulf vs. Egyptian vs. Levantine vs.
  // Maghrebi), and our plain "Arabic" label carries no dialect/region
  // signal at all. ar-SA (Modern Standard Arabic, Saudi Arabia) is a
  // common, defensible default, but it's a guess -- if our actual
  // candidate pool for this language skews toward a different region,
  // this single line is the one to change. Not blocking on it now.
  "arabic": "ar-SA",
  "bengali": "bn-BD",
  "bulgarian": "bg-BG",
  "cantonese": "zh-HK",
  "castilian spanish": "es-ES",
  "catalan": "ca-ES",
  "chinese (simplified)": "zh-CN",
  "chinese (traditional)": "zh-TW",
  "croatian": "hr-HR",
  "czech": "cs-CZ",
  "danish": "da-DK",
  "dutch": "nl-NL",
  "english": "en-US",
  "english (aus)": "en-AU",
  "english (canada)": "en-CA",
  "english (uk)": "en-GB",
  "finnish": "fi-FI",
  "french": "fr-FR",
  "french (canadian)": "fr-CA",
  "french (parisian)": "fr-FR",
  "german": "de-DE",
  "greek": "el-GR",
  "gujarati": "gu-IN",
  "hebrew": "he-IL",
  "hindi": "hi-IN",
  "hungarian": "hu-HU",
  "icelandic": "is-IS",
  "indonesian": "id-ID",
  "italian": "it-IT",
  "japanese": "ja-JP",
  "kannada": "kn-IN",
  "kazakh": "kk-KZ",
  "korean": "ko-KR",
  "malay": "ms-MY",
  "malayalam": "ml-IN",
  "marathi": "mr-IN",
  "norwegian": "nb-NO",
  "odia": "or-IN",
  "polish": "pl-PL",
  "portuguese (brazilian)": "pt-BR",
  "portuguese (portugal)": "pt-PT",
  "punjabi": "pa-IN",
  "romanian": "ro-RO",
  "russian": "ru-RU",
  "slovak": "sk-SK",
  "slovenian": "sl-SI",
  // Both "Spanish (LatAm)" and "Spanish (Latin America)" exist as distinct
  // entries in STANDARD_LANGUAGES (a leftover duplication there) -- both
  // map to the same region-neutral Latin American Spanish tag.
  "spanish (latam)": "es-419",
  "spanish (latin america)": "es-419",
  "swedish": "sv-SE",
  "tamil": "ta-IN",
  "telugu": "te-IN",
  "thai": "th-TH",
  "turkish": "tr-TR",
  "ukrainian": "uk-UA",
  "urdu": "ur-PK",
  "vietnamese": "vi-VN",
};

export function languageToBcp47(label: string | null | undefined): string | undefined {
  if (!label) return undefined;
  const key = label.trim().toLowerCase();
  if (!key) return undefined;
  return LANGUAGE_LABEL_TO_BCP47[key];
}

// Exported for tests / debugging -- callers should use languageToBcp47().
export { LANGUAGE_LABEL_TO_BCP47 };
