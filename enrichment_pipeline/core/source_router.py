"""Source router logic for mapping explicit form Source dropdown values to providers & parsers."""

from __future__ import annotations

from typing import Tuple

# Tier 1 provider to use when we have no dedicated parser for the lead's
# platform. NOT a Tier 1 scrape at all: it skips straight to Stage 3.5
# (Parallel) and then the LLM fallback, which is the whole point.
#
# Tier 1 only ever earns its latency when a dedicated parser exists to turn
# its raw page text into canonical fields. For an unrecognized platform there
# is none -- a Tavily Extract of a personal portfolio site just hands the
# generic LLM parser a wall of marketing copy, which is work Parallel's
# browsing agent already does better and does anyway on this same lead. So an
# unknown source spends nothing on Tier 1 and goes Parallel -> LLM fallback.
# See orchestrator.py's _run_non_linkedin_steps, which skips its Tavily call
# for this provider type (Parallel is dispatched before that call regardless).
PARALLEL_ONLY = ("parallel_only", "generic_llm")

# Explicit mapping of form Source dropdown values to (provider_type, parser_name)
SOURCE_MAP = {
    "linkedin": ("brightdata", "linkedin"),
    "proz": ("tavily_search", "proz"),
    "ada": ("tavily_extract", "ada"),
    "ata": ("tavily_extract", "ata"),
    "ataa": ("tavily_extract", "ataa"),
    "bodalgo": ("tavily_extract", "bodalgo"),
    "freelancer": ("tavily_extract", "freelancer"),
    # Deliberately absent, and therefore PARALLEL_ONLY via the default below:
    # "other" (the explicit "we could not identify this platform" value the
    # server assigns -- see server/src/lib/detectLeadSource.ts) and "apollo"
    # (a contact-data provider, not a scrapeable public profile host).
}


def route_lead(source: str) -> Tuple[str, str]:
    """Return (provider_name, parser_name) based strictly on explicit Source dropdown value.

    An unmapped source -- "other", "apollo", or anything unrecognized -- is
    routed to Parallel + LLM fallback with no Tier 1 scrape. See PARALLEL_ONLY.
    """
    src = (source or "").strip().lower()
    return SOURCE_MAP.get(src, PARALLEL_ONLY)
