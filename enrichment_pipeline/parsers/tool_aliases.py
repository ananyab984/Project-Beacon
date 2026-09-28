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

ponytail: a few canonical names are short, generic-looking tokens ("Swift",
"XL8", "PXL", "Polaris") that could in principle substring-match unrelated
text (e.g. a Swift *programming language* mention). Left as plain substring
matches rather than adding word-boundary/context disambiguation -- these are
real, specific product names in this industry and a false-positive here is
rare and low-stakes (an extra selected checkbox), not worth the extra
complexity unless it's confirmed live to actually happen.
"""
from __future__ import annotations

from typing import Dict, List

TOOL_ALIASES: Dict[str, List[str]] = {
    "Ableton Live": ["ableton live", "ableton"],
    "Adobe Audition": ["adobe audition", "audition"],
    "Adobe Premiere Pro": ["adobe premiere pro", "premiere pro", "adobe premiere"],
    "Audacity": ["audacity"],
    "Avid Media Composer": ["avid media composer", "avid"],
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
    lowered = text_blob.lower()
    matched: List[str] = []
    for canonical, aliases in TOOL_ALIASES.items():
        if canonical not in matched and any(alias in lowered for alias in aliases):
            matched.append(canonical)
    return matched
