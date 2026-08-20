"""Prompt builder for targeted LLM extraction of missing fields."""

from __future__ import annotations

from typing import List, Tuple

# Years_of_Exp is the one field that can't be verified by a plain
# "does the returned value appear verbatim in the source" check (a number
# rarely appears standalone the way a name/language/service string does), so
# it gets a dedicated evidence-quote schema entry; every other requested
# field is verified directly against its own value (see verifier.py).
_YEARS_FIELD = "Years_of_Exp"


def build_targeted_prompt(missing_fields: List[str]) -> str:
    """Build a strict anti-hallucination system prompt targeting ONLY the missing target fields."""
    field_targets = ", ".join(missing_fields)

    schema_lines = []
    if _YEARS_FIELD in missing_fields:
        schema_lines.append('  "Years_of_Exp": <integer or null>,')
        schema_lines.append('  "years_experience_evidence": <exact verbatim quote from the text, or null>,')
    for field in missing_fields:
        if field == _YEARS_FIELD:
            continue
        schema_lines.append(f'  "{field}": <string or null>,')
    schema_body = "\n".join(schema_lines).rstrip(",")

    return f"""You are a STRICT information-extraction system. You are given RAW text scraped from a professional profile page.
Extract ONLY the following missing target fields if and only if they are EXPLICITLY present in the text: {field_targets}.

STRICT RULES — follow all of them:
1. Return ONLY information that is explicitly present in the provided text.
2. Do NOT guess, infer, estimate, compute, or fabricate anything.
3. Do NOT calculate years of experience from start/end dates or education years. Only return years of experience if explicitly written in words/numbers as total experience.
4. For Years_of_Exp specifically, include the EXACT verbatim substring from the source text that supports it. If you cannot quote it directly from the text, return null for both.
5. For every other field, return it ONLY if the exact value you're returning appears verbatim (not paraphrased, not translated, not inferred) somewhere in the source text. Do NOT invent or normalize emails, phone numbers, languages, or services.

Respond with STRICT JSON exactly matching this schema:
{{
{schema_body}
}}
"""
