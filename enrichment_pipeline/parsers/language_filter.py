"""Lightweight non-English text detection -- a word-list sniff, not real
language identification (ceiling and upgrade path noted on
NON_ENGLISH_MARKERS below, same as orchestrator.py's _looks_non_english,
which uses this same wordlist for its whole-payload translation gate).

Lives here (not in orchestrator.py, where the wordlist originally lived)
so parsers/linkedin_parser.py can filter a non-English skill/service tag
before it reaches Services -- orchestrator.py already imports FROM
parsers.linkedin_parser, so the reverse import would be circular.

Confirmed live: a real profile's `skills` list from BrightData included
both an English tag and its own-language duplicate side by side
("Teamwork" and "Trabalho em equipe"), and unlike Parallel's Services path
(translated via orchestrator.py's _normalize_parallel_language before
_merge_parallel_fields ever reads it), BrightData's structured `skills`
list is joined straight into Services with no language filtering at all.
"""
from __future__ import annotations

import re

# Function words that are common and distinctive in the languages these
# profiles actually turn up in (Spanish, French, German, Portuguese, Italian),
# and rare-to-absent in English profile prose.
#
# ponytail: a word-list sniff, not language identification. Ceiling: a mostly
# English tag with a stray foreign word could still slip past, and this list
# only covers Latin-alphabet European languages (see looks_non_english_token's
# separate non-Latin-script check below for CJK/Cyrillic/etc). Upgrade path
# is a real detector (langdetect/lingua) if this proves too blunt in
# practice; not worth a dependency for the handful of languages seen so far.
NON_ENGLISH_MARKERS = frozenset(
    {
        # Spanish / Portuguese
        "de", "la", "el", "los", "las", "con", "para", "por", "una", "como",
        "muy", "más", "también", "años", "voz", "trabajo", "em", "não", "uma",
        "del", "su", "sus", "está", "años", "tradução", "português",
        # French
        "le", "les", "des", "une", "du", "au", "aux", "est", "sur", "avec",
        "pour", "dans", "traduction", "traductrice", "traducteur", "ans", "et",
        "à", "chez", "en", "formation", "expérience", "étudiante", "étudiant",
        "lieu", "ses", "son",
        # German
        "und", "der", "die", "das", "den", "von", "mit", "für", "ich", "auch",
        "sprachen", "jahre", "übersetzer", "übersetzerin",
        # Italian
        "il", "lo", "gli", "che", "con", "per", "sono", "anni", "voce",
        "traduzione", "esperienza",
        # Polish
        "redagowanie", "tłumaczenie",
    }
)

# Unicode-aware ("any letter, not a digit/underscore/punctuation"), not the
# hand-picked `[a-zà-öø-ÿ']` Latin-1-only class orchestrator.py's older
# _looks_non_english uses -- confirmed live that class fails to even
# tokenize Polish diacritics (ł, ń, ś, ź, ż, ą, ę, ć all fall outside the
# Latin-1 Supplement range it covers), silently splitting a word like
# "tłumaczenie" into fragments that then never match NON_ENGLISH_MARKERS'
# own "tłumaczenie" entry.
_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

# Non-Latin scripts NON_ENGLISH_MARKERS can't catch at all, since its word
# list only recognizes Latin-alphabet European languages -- confirmed live:
# a lead's duplicate Japanese-language skills/experience text passed
# straight through untouched. Covers CJK, Hangul, Cyrillic, Arabic, Hebrew.
_NON_LATIN_RE = re.compile(
    r"[぀-ヿ㐀-鿿가-힯Ѐ-ӿ؀-ۿ֐-׿]"
)


def looks_non_english_token(text: str) -> bool:
    """True for a SHORT string (a single skill/service tag, not a whole
    payload) that reads as non-English -- either non-Latin script, or
    containing one of NON_ENGLISH_MARKERS' European-language function
    words. Unlike orchestrator.py's _looks_non_english (a whole-payload
    ratio check that needs >=8 words to judge reliably, since a handful of
    incidental foreign words shouldn't flag an otherwise-English profile), a
    short, single-purpose tag needs only one hit to be worth dropping."""
    if _NON_LATIN_RE.search(text):
        return True
    words = _WORD_RE.findall(text.lower())
    return any(w in NON_ENGLISH_MARKERS for w in words)
