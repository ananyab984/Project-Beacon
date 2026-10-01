"""Source router logic for mapping explicit form Source dropdown values to providers & parsers."""

from __future__ import annotations

from typing import Tuple

# Explicit mapping of form Source dropdown values to (provider_type, parser_name)
SOURCE_MAP = {
    "linkedin": ("brightdata", "linkedin"),
    "proz": ("tavily_search", "proz"),
    "ada": ("tavily_extract", "ada"),
    "ata": ("tavily_extract", "ata"),
    "ataa": ("tavily_extract", "ataa"),
    "bodalgo": ("tavily_extract", "bodalgo"),
    "freelancer": ("tavily_extract", "freelancer"),
}


def route_lead(source: str) -> Tuple[str, str]:
    """Return (provider_name, parser_name) based strictly on explicit Source dropdown value.

    If source is custom or unmapped, route directly to Tavily Extract + generic LLM fallback.
    """
    src = (source or "").strip().lower()
    return SOURCE_MAP.get(src, ("tavily_extract", "generic_llm"))
