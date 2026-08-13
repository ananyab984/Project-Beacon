"""Prompt builder for targeted LLM extraction of missing critical fields."""

from __future__ import annotations

from typing import List, Tuple


def build_targeted_prompt(missing_critical_fields: List[str]) -> str:
    """Build a strict anti-hallucination system prompt targeting ONLY the missing critical fields."""
    field_targets = ", ".join(missing_critical_fields)

    return f"""You are a STRICT information-extraction system. You are given RAW text scraped from a professional profile page.
Extract ONLY the following missing target fields if and only if they are EXPLICITLY present in the text: {field_targets}.

STRICT RULES — follow all of them:
1. Return ONLY information that is explicitly present in the provided text.
2. Do NOT guess, infer, estimate, compute, or fabricate anything.
3. Do NOT calculate years of experience from start/end dates or education years. Only return years of experience if explicitly written in words/numbers as total experience.
4. For EVERY non-null value you return, include the EXACT verbatim substring from the source text that supports it. If you cannot quote it directly from the text, return null.
5. Do NOT invent or normalize emails or phone numbers. Only report ones that appear verbatim in the text.

Respond with STRICT JSON exactly matching this schema:
{{
  "Years_of_Exp": <integer or null>,
  "years_experience_evidence": <exact verbatim quote from the text, or null>,
  "Email_Address": <string or null>,
  "Contact_Number": <string or null>,
  "contact_evidence": <exact verbatim quote from the text, or null>
}}
"""
