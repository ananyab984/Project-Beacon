"""Grounding safeguard for Tier 3's Claude web-search fallback."""

from __future__ import annotations

from typing import Any, Dict, List

from logger import get_logger

log = get_logger(__name__)


def filter_web_search_result(result: Dict[str, Any], target_fields: List[str]) -> Dict[str, Any]:
    """Process safeguard for the web_search fallback, in place of verbatim
    verification: Claude's web_search tool matches results server-side and
    returns them to us as encrypted content blocks, so unlike the old
    raw-text extraction there's no client-visible source text to check
    extracted facts against. Instead: discard everything if the model
    reported finding nothing, or cited no real source URL for the batch --
    grounding here rests on the prompt's strict rules plus this minimum
    citation requirement, not an independent verbatim match.
    """
    if not isinstance(result, dict) or result.get("could_not_find_anything"):
        return {}

    sources = result.get("sources_used")
    if not isinstance(sources, list) or not any(isinstance(s, str) and s.strip() for s in sources):
        log.warning("DISCARDING web_search result: no real source URL cited")
        return {}

    verified: Dict[str, Any] = {}
    for field in target_fields:
        val = result.get(field)
        if isinstance(val, str) and val.strip():
            verified[field] = val.strip()
            log.info("Accepted web_search %s=%s (sources=%s)", field, val, sources)

    # Hard line, defense in depth alongside never asking for these in the
    # prompt (build_web_search_prompt) and never passing them in
    # target_fields (orchestrator.py's _WEBSEARCH_EXCLUDED_FIELDS): a wrong
    # contact value reaches a different real human being, so it must never
    # survive this filter even if a caller or a model slip put one here.
    for contact_field in ("Email_Address", "Contact_Number"):
        verified.pop(contact_field, None)

    return verified
