"""Verbatim evidence verification module for LLM-extracted critical fields."""

from __future__ import annotations

import re
from typing import Any, Dict

from logger import get_logger

log = get_logger(__name__)


def verify_against_source(llm_result: Dict[str, Any], raw_source_text: str) -> Dict[str, Any]:
    """Belt-and-suspenders verification, generalized over whatever fields were
    requested (the 3 original critical fields, plus Services/languages/
    country when those were also targeted -- see orchestrator.py's
    LLM_ENRICHABLE_FIELDS).

    Nulls out any LLM-extracted value that doesn't verifiably appear in the
    raw source text.
    """
    if not isinstance(llm_result, dict):
        return {}

    src = (raw_source_text or "").lower()
    verified: Dict[str, Any] = {}

    # 1. Verify Years_of_Exp via its dedicated evidence-quote field -- a bare
    # integer can't be verbatim-matched against source text the way a
    # name/language/service string can.
    years_val = llm_result.get("Years_of_Exp")
    years_quote = (llm_result.get("years_experience_evidence") or "").strip().lower()
    if years_val is not None:
        if years_quote and years_quote in src:
            try:
                verified["Years_of_Exp"] = int(years_val)
                log.info("Verified LLM Years_of_Exp=%s with evidence quote %r", years_val, years_quote)
            except (ValueError, TypeError):
                log.warning("Invalid integer format for LLM Years_of_Exp: %r", years_val)
        else:
            log.warning("DISCARDING LLM Years_of_Exp=%s: evidence quote %r not found verbatim in source", years_val, years_quote)

    # 2. Verify Contact_Number via digit-normalized comparison (formatting varies).
    phone_val = llm_result.get("Contact_Number")
    if phone_val and isinstance(phone_val, str):
        digits_phone = re.sub(r"[^\d+]", "", phone_val)
        digits_src = re.sub(r"[^\d+]", "", src)
        if digits_phone and digits_phone in digits_src:
            verified["Contact_Number"] = phone_val.strip()
            log.info("Verified LLM Contact_Number=%s in source text", phone_val)
        else:
            log.warning("DISCARDING LLM Contact_Number=%s: digits not found in source text", phone_val)

    # 3. Every other requested field (Email_Address, Services, Source_Language,
    # Target_Language, Secondary_Languages, Country_of_Residence, ...):
    # accept only if the exact returned value appears verbatim (case-
    # insensitive) somewhere in the source text.
    _HANDLED = {"Years_of_Exp", "years_experience_evidence", "Contact_Number"}
    for key, val in llm_result.items():
        if key in _HANDLED or not val or not isinstance(val, str):
            continue
        if val.strip().lower() in src:
            verified[key] = val.strip()
            log.info("Verified LLM %s=%s in source text", key, val)
        else:
            log.warning("DISCARDING LLM %s=%s: not found verbatim in source text", key, val)

    return verified
