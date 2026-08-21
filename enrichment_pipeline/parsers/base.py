"""Abstract base class for all deterministic platform parsers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BaseParser(ABC):
    """Abstract parser interface. Every platform parser produces two
    independent outputs from the same raw scrape:

    1. `parse()` -- the canonical schema fields used to score/mark a lead
       enriched. Unaffected by `build_context()`.
    2. `build_context()` -- curated, professionally-relevant background for
       the drafting prompt (stored under "Full_Profile_Context"), built
       directly from the raw scrape, not from `parse()`'s already-narrowed
       output. Default is no context, not a raw passthrough -- every source
       examined so far (LinkedIn, ADA, Bodalgo, ProZ) turned out to carry
       real noise (tracking cookies, login forms, other people's data) that
       would waste prompt tokens and risk misattribution if dumped raw.
    """

    @abstractmethod
    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        """Parse raw scraped content into a dictionary matching canonical schema fields.

        Only return fields that were actually present/extracted (omit missing ones).
        """
        pass

    def build_context(self, profile_link: str, raw_data: Any) -> Optional[str]:
        """Curated background for the drafting prompt. Override to surface
        whatever's professionally relevant in this platform's raw scrape;
        the default (no context) is deliberate, not a placeholder to fill in
        later with a raw passthrough."""
        return None
