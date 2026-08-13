"""Rate Card lookup and grounding verification module."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from logger import get_logger

log = get_logger(__name__)

# Default fallback rate card table (structured lookup)
DEFAULT_RATE_CARD: List[Dict[str, Any]] = [
    {"source_language": "English", "target_language": "German", "service": "Translation", "rate": 0.12, "unit": "per word", "currency": "USD"},
    {"source_language": "English", "target_language": "Spanish", "service": "Translation", "rate": 0.10, "unit": "per word", "currency": "USD"},
    {"source_language": "English", "target_language": "French", "service": "Translation", "rate": 0.11, "unit": "per word", "currency": "USD"},
    {"source_language": "English", "target_language": "Japanese", "service": "Translation", "rate": 0.15, "unit": "per word", "currency": "USD"},
    {"source_language": "Spanish", "target_language": "English", "service": "Audio Description", "rate": 0.14, "unit": "per word", "currency": "USD"},
    {"source_language": "English", "target_language": "English", "service": "Audio Description", "rate": 0.13, "unit": "per word", "currency": "USD"},
]


class RateCardService:
    """Deterministic Rate Card Lookup service."""

    def __init__(self, rate_card: Optional[List[Dict[str, Any]]] = None):
        self.rate_card = rate_card or DEFAULT_RATE_CARD

    def lookup_rate(self, source_lang: Optional[str], target_lang: Optional[str], service: Optional[str] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Look up matching rate by (source_language, target_language, service).

        Returns (rate_dict, flag_str). If no matching rate exists, returns (None, 'NO_RATE_MATCH').
        """
        src = (source_lang or "").strip().lower()
        tgt = (target_lang or "").strip().lower()
        svc = (service or "Translation").strip().lower()

        if not src and not tgt:
            return None, "NO_RATE_MATCH"

        for row in self.rate_card:
            r_src = row.get("source_language", "").strip().lower()
            r_tgt = row.get("target_language", "").strip().lower()
            r_svc = row.get("service", "").strip().lower()

            if (r_src == src or not src) and (r_tgt == tgt or not tgt):
                log.info("Rate card MATCH found for %s -> %s (%s): %s %s/%s", source_lang, target_lang, service, row["rate"], row["currency"], row["unit"])
                return row, None

        log.warning("No rate card match found for %s -> %s (%s)", source_lang, target_lang, service)
        return None, "NO_RATE_MATCH"
