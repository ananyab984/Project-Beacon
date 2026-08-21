"""Prompt builder for targeted LLM extraction of missing fields."""

from __future__ import annotations

from typing import List, Tuple

# Years_of_Exp is the one field that can't be verified by a plain
# "does the returned value appear verbatim in the source" check (a number
# rarely appears standalone the way a name/language/service string does), so
# it gets a dedicated evidence-quote schema entry; every other requested
# field is verified directly against its own value (see verifier.py).
_YEARS_FIELD = "Years_of_Exp"

# Fields our system stores as a comma-joined list -- asking for a single
# prose string here ("French and German") would either fail the verbatim
# check outright or, if it passed, downstream comma-splitting would treat it
# as one malformed item. Instead these get a JSON array schema entry, each
# element independently verbatim-verified, then joined with ", " once
# validated (see verifier.py).
LIST_FIELDS = {"Secondary_Languages", "Services"}


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
        if field in LIST_FIELDS:
            schema_lines.append(f'  "{field}": [<verbatim substrings from the text>] (empty array if none),')
        else:
            schema_lines.append(f'  "{field}": <string or null>,')
    schema_body = "\n".join(schema_lines).rstrip(",")

    return f"""You are a STRICT information-extraction system. You are given RAW text scraped from a professional profile page.
Extract ONLY the following missing target fields if and only if they are EXPLICITLY present in the text: {field_targets}.

STRICT RULES — follow all of them:
1. Return ONLY information that is explicitly present in the provided text.
2. Do NOT guess, infer, estimate, compute, or fabricate anything.
3. Do NOT calculate years of experience from start/end dates or education years. Only return years of experience if explicitly written in words/numbers as total experience.
4. For Years_of_Exp specifically, include the EXACT verbatim substring from the source text that supports it. If you cannot quote it directly from the text, return null for both.
5. For {", ".join(LIST_FIELDS)} specifically: return each distinct item as its own array element, exactly as it appears in the text (e.g. "French and German" in the source becomes ["French", "German"], not one combined string). Do NOT merge multiple items into a single string.
6. For every other field, return it ONLY if the exact value you're returning appears verbatim (not paraphrased, not translated, not inferred) somewhere in the source text. Do NOT invent or normalize emails, phone numbers, languages, or services.

Respond with STRICT JSON exactly matching this schema:
{{
{schema_body}
}}
"""


def build_web_search_prompt(missing_fields: List[str], full_name: str, profile_link: str) -> str:
    """Prompt Claude to use its web_search tool to find specific missing
    fields about a named, disambiguated person -- for when Bright Data's
    scrape had nothing for them to begin with, so there's no source text left
    for build_targeted_prompt's raw-text extraction to work from. Same strict
    grounding philosophy, adapted for a live web search instead of a fixed
    source blob."""
    field_targets = ", ".join(missing_fields)
    schema_lines = "\n".join(f'  "{field}": <string or null>,' for field in missing_fields)

    return f"""I'm researching a real person named {full_name} for a recruiting/outreach purpose. Their LinkedIn profile URL is {profile_link} -- use that only as an identity hint to make sure you find the right person (there may be other people with the same name), not something to fetch directly (LinkedIn profile pages cannot be fetched directly).

Use web_search to find whatever real, public information exists about this specific person for these fields: {field_targets}. Try multiple search angles if the first doesn't turn up much (their name plus any known company/location, third-party profile aggregators, press mentions, company bios, etc).

STRICT RULES:
1. Only report information you actually found in real search-result content. Do NOT guess, infer, estimate, or fabricate anything about this specific person.
2. Leave a field null if you genuinely found nothing for it -- do not pad with generic guesses.
3. List every source URL that actually supported a fact in sources_used. If sources_used is empty, every field above must be null.
4. Set could_not_find_anything to true if you found nothing usable at all.

Respond with ONLY a single JSON object (no markdown fence, no prose before or after) matching exactly this shape:
{{
{schema_lines}
  "sources_used": [<url string>, ...],
  "could_not_find_anything": <true or false>
}}
"""
