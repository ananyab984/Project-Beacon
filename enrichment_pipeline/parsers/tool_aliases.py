"""Canonical subtitling/translation/media-tools software name -> surface
phrase/synonym aliases -- the Tools_Software analogue of service_aliases.py.

Replaces the old inline `_KNOWN_TOOLS` list in linkedin_parser.py, which had
drifted from the recruiter-facing Software Proficiency dropdown (missing
XL8, Smartcat, Adobe Premiere Pro, DaVinci Resolve, Ableton Live, Audacity,
Avid Media Composer, Cubase, Final Cut Pro, Logic Pro, Nuendo, Studio One,
DeepL, iMediaTrans, Jubler, MacCaptions, PlintCore, Polaris, PXL, Sfera,
Swift, ZooSub entirely, and spelling "EZTitle" as "EZTitles" so its own
alias never matched the canonical name). It started as that dropdown's
list; the common translation/audio tools it lacked (Trados, Wordfast,
Phrase, OmegaT, Reaper, Source-Connect, iZotope RX, Netflix Originator) are
now included too.

Matching is word-boundary based (see extract_tools_from_text's docstring for
why -- a plain substring check has confirmed false-positive failure modes).

How this list is used now -- it is NOT a filter. Tools are extracted from
what each profile actually lists (Parallel's `tools_software`, a skills
section, the Groq formatting pass), and any tool name, known here or not,
is kept. This table only (1) renames a recognised tool to one spelling and
(2) recognises tools inside free text and inside a skills list so they can
be sorted out of Services (orchestrator.py's _sort_tools_out_of_services).

Two alias maps, because free text and an explicit list are different risks:
  TOOL_ALIASES   -- scanned in FREE TEXT. Only phrases that cannot be an
                    ordinary word. "resolve", "audition", "swift", "final
                    cut", "polaris", "sfera", "phrase", "reaper" are NOT here:
                    confirmed live, "assistance to people to resolve common
                    troubles" (an insurance job) became "DaVinci Resolve", and
                    voice actors write "audition" constantly.
  EXPLICIT_NAMES -- matched only against a whole item of an explicit list
                    (a skills entry, a Parallel/Groq tools entry), where
                    "Resolve" or "Audition" on its own really is the tool.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

TOOL_ALIASES: Dict[str, List[str]] = {
    "Ableton Live": ["ableton live", "ableton"],
    "Adobe Audition": ["adobe audition"],
    "Adobe Premiere Pro": ["adobe premiere pro", "premiere pro", "adobe premiere"],
    "Audacity": ["audacity"],
    "Avid Media Composer": ["avid media composer"],
    "Cubase": ["cubase"],
    "DaVinci Resolve": ["davinci resolve", "da vinci resolve"],
    "Final Cut Pro": ["final cut pro", "fcpx"],
    "Logic Pro": ["logic pro"],
    "Nuendo": ["nuendo"],
    "Pro Tools": ["pro tools", "protools"],
    "Studio One": ["presonus studio one"],
    "XL8": ["xl8"],
    "Smartcat": ["smartcat"],
    "MemoQ": ["memoq"],
    "MemSource": ["memsource"],
    "DeepL": ["deepl"],
    "Aegisub": ["aegisub"],
    "EZTitle": ["eztitle", "eztitles"],
    "iMediaTrans": ["imediatrans"],
    "Jubler": ["jubler"],
    "MacCaptions": ["maccaptions"],
    "Ooona": ["ooona"],
    "PlintCore": ["plintcore"],
    "Polaris": ["polaris subtitling"],
    "PXL": ["pxl subtitle"],
    "Sfera": ["sfera subtitling"],
    "Subtitle Edit": ["subtitle edit"],
    "Swift": ["swift subtitling", "screen swift"],
    "WinCaps": ["wincaps"],
    "ZooSub": ["zoosub"],
    # Common translation/audio tools the original dropdown list never had.
    "SDL Trados Studio": ["sdl trados studio", "sdl trados", "trados studio", "rws trados", "trados"],
    "Wordfast": ["wordfast"],
    "Phrase": ["phrase tms"],
    "OmegaT": ["omegat"],
    "Reaper": ["cockos reaper", "reaper daw"],
    "Source-Connect": ["source-connect", "source connect"],
    "iZotope RX": ["izotope rx", "izotope"],
    "Netflix Originator": ["netflix originator"],
}

# Whole-item matches for an explicit list entry: every free-text alias above,
# plus the short names that are only safe when the item IS the tool name.
EXPLICIT_NAMES: Dict[str, str] = {
    **{alias: canonical for canonical, aliases in TOOL_ALIASES.items() for alias in aliases},
    **{canonical.lower(): canonical for canonical in TOOL_ALIASES},
    "audition": "Adobe Audition",
    "resolve": "DaVinci Resolve",
    "final cut": "Final Cut Pro",
    "premiere": "Adobe Premiere Pro",
    "studio one": "Studio One",
    "swift": "Swift",
    "polaris": "Polaris",
    "pxl": "PXL",
    "sfera": "Sfera",
    "phrase": "Phrase",
    "reaper": "Reaper",
    "smart cat": "Smartcat",
    "memo q": "MemoQ",
    "mem source": "MemSource",
    "deep l": "DeepL",
    "ez title": "EZTitle",
    "zoo sub": "ZooSub",
    "mac captions": "MacCaptions",
    "plint core": "PlintCore",
    "i media trans": "iMediaTrans",
}


def extract_tools_from_text(text_blob: str) -> List[str]:
    """Word-boundary match, not a bare substring check -- confirmed live: a
    plain `alias in lowered` check matched "avid" inside "avid" (an ordinary
    English adjective a profile uses to describe itself, e.g. "an avid
    translator"), and a 3-letter acronym-style alias sitting embedded inside
    an unrelated word ("bti" inside "subtitle"/"subtitling") would hit the
    same failure mode for any other short alias. `\\b` on both sides of each
    alias phrase (spaces inside a multi-word alias are unaffected) rejects
    both shapes while still matching the alias as its own word/phrase.
    Free text only uses TOOL_ALIASES, never the short EXPLICIT_NAMES."""
    lowered = text_blob.lower()
    matched: List[str] = []
    for canonical, aliases in TOOL_ALIASES.items():
        if canonical in matched:
            continue
        if any(re.search(rf"\b{re.escape(alias)}\b", lowered) for alias in aliases):
            matched.append(canonical)
    return matched


def known_tool(item: str) -> Optional[str]:
    """Canonical name if one explicit list item (a skills entry, a tools
    entry) is a recognised tool, else None: the whole item is a known name
    ("Resolve", "trados"), or it names one with a safe phrase inside it
    ("Pro Tools editing", "SDL Trados Studio 2021")."""
    name = str(item or "").strip()
    if not name:
        return None
    hit = EXPLICIT_NAMES.get(name.lower())
    if hit:
        return hit
    found = extract_tools_from_text(name)
    return found[0] if found else None


def canonicalize_tools(names: List[str]) -> List[str]:
    """Explicitly named tools -> de-duplicated list, renamed to one spelling
    where recognised (known_tool) and KEPT AS WRITTEN otherwise. Never a
    filter: these names were listed as tools by the source itself."""
    result: List[str] = []
    seen: set = set()
    for raw in names:
        name = str(raw or "").strip()
        if not name:
            continue
        canonical = known_tool(name) or name
        if canonical.lower() not in seen:
            seen.add(canonical.lower())
            result.append(canonical)
    return result
