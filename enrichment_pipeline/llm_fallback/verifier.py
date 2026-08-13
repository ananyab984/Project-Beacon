"""Verbatim evidence verification module for LLM-extracted critical fields."""

from __future__ import annotations

import re
from typing import Any, Dict

from logger import get_logger

log = get_logger(__name__)


def verify_against_source(llm_result: Dict[str, Any], raw_source_text: str) -> Dict[str, Any]:
    """Belt-and-suspenders verification.

    Nulls out any LLM-extracted value whose evidence quote does NOT appear verbatim
    in the raw source text.
    """
    if not isinstance(llm_result, dict):
        return {}

    src = (raw_source_text or "").lower()
    verified: Dict[str, Any] = {}

    # 1. Verify Years_of_Exp
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

    # 2. Verify Email_Address
    email_val = llm_result.get("Email_Address")
    if email_val and isinstance(email_val, str):
        if email_val.strip().lower() in src:
            verified["Email_Address"] = email_val.strip()
            log.info("Verified LLM Email_Address=%s in source text", email_val)
        else:
            log.warning("DISCARDING LLM Email_Address=%s: not found in source text", email_val)

    # 3. Verify Contact_Number
    phone_val = llm_result.get("Contact_Number")
    if phone_val and isinstance(phone_val, str):
        digits_phone = re.sub(r"[^\d+]", "", phone_val)
        digits_src = re.sub(r"[^\d+]", "", src)
        if digits_phone and digits_phone in digits_src:
            verified["Contact_Number"] = phone_val.strip()
            log.info("Verified LLM Contact_Number=%s in source text", phone_val)
        else:
            log.warning("DISCARDING LLM Contact_Number=%s: digits not found in source text", phone_val)

    return verified
