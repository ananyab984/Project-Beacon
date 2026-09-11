"""Canonical linguist service category -> surface phrase/synonym aliases.

Originally lived only in linkedin_parser.py for Stage 3's BrightData text
scan. Pulled out here so Stage 3.5's Parallel merge (orchestrator.py) can
resolve Services with the exact same heuristic instead of Parallel-sourced
leads simply never getting a Services value at all -- confirmed live that
several leads had a full headline/about/skills payload from Parallel with a
clear service (e.g. "Dubbing Artist", "Subtitling") sitting unused because
nothing downstream of BrightData ever looked for it.
"""
from __future__ import annotations

from typing import Dict, List

SERVICE_ALIASES: Dict[str, List[str]] = {
    "Audio Description": ["audio description"],
    "Subtitling": ["subtitling", "subtitler", "subtitles"],
    "Closed Captioning": ["closed captioning", "closed caption"],
    "Captioning": ["captioning"],
    "Dubbing": ["dubbing", "dubbing artist", "dubbing director"],
    "Voice-over": ["voice-over", "voice over", "voiceover"],
    "Interpretation": ["interpretation", "interpreter", "interpreting"],
    "Translation": ["translation", "translator"],
    "Localization": ["localization", "localisation"],
    "Transcription": ["transcription", "transcriber"],
    "Proofreading": ["proofreading", "proofreader"],
    "Transcreation": ["transcreation"],
    "Copywriting": ["copywriting", "copywriter"],
    "Linguistic QA": ["linguistic qa", "lqa"],
    "Post-Editing": ["post-editing", "post editing", "mtpe"],
}


def extract_services_from_text(text_blob: str) -> List[str]:
    lowered = text_blob.lower()
    matched: List[str] = []
    for canonical, aliases in SERVICE_ALIASES.items():
        if canonical not in matched and any(alias in lowered for alias in aliases):
            matched.append(canonical)
    return matched
