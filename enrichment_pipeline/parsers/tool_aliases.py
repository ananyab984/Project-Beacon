"""Canonical subtitling/translation/media-tools software name -> surface
phrase/synonym aliases -- the Tools_Software analogue of service_aliases.py.

Replaces the old inline `_KNOWN_TOOLS` list in linkedin_parser.py, which had
drifted from the recruiter-facing Software Proficiency dropdown (missing
XL8, Smartcat, Adobe Premiere Pro, DaVinci Resolve, Ableton Live, Audacity,
Avid Media Composer, Cubase, Final Cut Pro, Logic Pro, Nuendo, Studio One,
DeepL, iMediaTrans, Jubler, MacCaptions, PlintCore, Polaris, PXL, Sfera,
Swift, ZooSub entirely, and spelling "EZTitle" as "EZTitles" so its own
alias never matched the canonical name). This list matches the dropdown
exactly, same reasoning as vendor_aliases.py.

Matching is word-boundary based (see extract_tools_from_text's docstring for
why -- a plain substring check has confirmed false-positive failure modes).

ponytail: "Swift" is still a residual risk even with word boundaries -- it's
also an ordinary English word/name ("swift turnaround", "Taylor Swift"),
and there's no more specific alternate phrasing this product is actually
called. Left as-is (rare, low-stakes false positive -- an extra selected
checkbox) rather than adding real disambiguation (e.g. requiring nearby
subtitling-context words), not worth the complexity unless confirmed live
to actually happen. The bare "Avid" alias was removed instead of hedged --
"Avid Media Composer" is a safe, specific enough phrase on its own that
nothing is lost by requiring it.
"""

from __future__ import annotations

import re
from typing import Dict, List

TOOL_ALIASES: Dict[str, List[str]] = {
    "Ableton Live": ["ableton live", "ableton"],
    "Adobe Audition": ["adobe audition", "audition"],
    "Adobe Premiere Pro": ["adobe premiere pro", "premiere pro", "adobe premiere"],
    "Audacity": ["audacity"],
    "Avid Media Composer": ["avid media composer"],
    "Cubase": ["cubase"],
    "DaVinci Resolve": ["davinci resolve", "da vinci resolve", "resolve"],
    "Final Cut Pro": ["final cut pro", "final cut", "fcpx"],
    "Logic Pro": ["logic pro"],
    "Nuendo": ["nuendo"],
    "Pro Tools": ["pro tools", "protools"],
    "Studio One": ["studio one"],
    "XL8": ["xl8"],
    "Smartcat": ["smartcat", "smart cat"],
    "MemoQ": ["memoq", "memo q"],
    "MemSource": ["memsource", "mem source"],
    "DeepL": ["deepl", "deep l"],
    "Aegisub": ["aegisub"],
    "EZTitle": ["eztitle", "ez title", "eztitles"],
    "iMediaTrans": ["imediatrans", "i media trans"],
    "Jubler": ["jubler"],
    "MacCaptions": ["maccaptions", "mac captions"],
    "Ooona": ["ooona"],
    "PlintCore": ["plintcore", "plint core"],
    "Polaris": ["polaris"],
    "PXL": ["pxl"],
    "Sfera": ["sfera"],
    "Subtitle Edit": ["subtitle edit"],
    "Swift": ["swift"],
    "WinCaps": ["wincaps"],
    "ZooSub": ["zoosub", "zoo sub"],
}


def extract_tools_from_text(text_blob: str) -> List[str]:
    """Word-boundary match, not a bare substring check -- confirmed live: a
    plain `alias in lowered` check matched "avid" inside "avid" (an ordinary
    English adjective a profile uses to describe itself, e.g. "an avid
    translator"), and a 3-letter acronym-style alias sitting embedded inside
    an unrelated word ("bti" inside "subtitle"/"subtitling") would hit the
    same failure mode for any other short alias. `\\b` on both sides of each
    alias phrase (spaces inside a multi-word alias are unaffected) rejects
    both shapes while still matching the alias as its own word/phrase."""
    lowered = text_blob.lower()
    matched: List[str] = []
    for canonical, aliases in TOOL_ALIASES.items():
        if canonical in matched:
            continue
        if any(re.search(rf"\b{re.escape(alias)}\b", lowered) for alias in aliases):
            matched.append(canonical)
    return matched
