"""Prompt builder for Tier 3's Claude web-search fallback."""

from __future__ import annotations

from typing import List

# Years_of_Exp is the one field that can't be trusted as a bare number the
# way a name/language/service string can, so it gets a dedicated
# evidence-quote schema entry pairing it with the source phrase that
# supports it -- the closest available approximation to verbatim evidence
# when there's no single scraped blob to check against (see
# filter_web_search_result in verifier.py).
_YEARS_FIELD = "Years_of_Exp"


def build_web_search_prompt(
    missing_fields: List[str], full_name: str, profile_link: str, source_platform: str
) -> str:
    """Prompt Claude to use its web_search tool to find specific missing
    fields about a named, disambiguated person -- for when Bright Data/
    Tavily and Parallel have both come up thin (see orchestrator.py's
    MAX_FIELDS_BEFORE_WEBSEARCH gate), so there's no scraped source text left
    for a raw-text extraction to work from. Ported from the abandoned
    feat/linkedin-websearch-fallback branch (commit 2da2456), generalized
    beyond LinkedIn: any platform's profile URL is treated as an identity
    hint rather than a fetchable page, since a live browser fetch isn't
    reliably possible for any of them (LinkedIn blocks it outright; ProZ/
    Bodalgo/etc. have no such guarantee either).
    """
    field_targets = ", ".join(missing_fields)

    schema_lines = []
    if _YEARS_FIELD in missing_fields:
        schema_lines.append('  "Years_of_Exp": <integer or null>,')
        schema_lines.append(
            '  "years_experience_evidence": <a short quoted phrase from a real source that supports this number, or null>,'
        )
    for field in missing_fields:
        if field == _YEARS_FIELD:
            continue
        schema_lines.append(f'  "{field}": <string or null>,')
    schema_body = "\n".join(schema_lines)

    return f"""I'm researching a real person named {full_name} for a recruiting/outreach purpose. Their {source_platform} profile URL is {profile_link} -- use that only as an identity hint to make sure you find the right person (there may be other people with the same name), not something to fetch directly (a {source_platform} profile page cannot be fetched directly).

Use web_search to find whatever real, public information exists about this specific person for these fields: {field_targets}. Try multiple search angles if the first doesn't turn up much (their name plus any known company/location, third-party profile aggregators, press mentions, company bios, etc).

STRICT RULES:
1. Only report information you actually found in real search-result content. Do NOT guess, infer, estimate, or fabricate anything about this specific person.
2. Leave a field null if you genuinely found nothing for it -- do not pad with generic guesses.
3. This name may be common. Before attributing any fact to this person, confirm the search result is actually about THEM and not a different person of the same name -- check that company, role, or location context lines up.
4. For Years_of_Exp specifically, only report it if a real source states it (directly, or plainly computable from a clearly-dated career start) and quote the supporting phrase in years_experience_evidence. If you cannot support it this way, return null for both.
5. List every source URL that actually supported a fact in sources_used. If sources_used is empty, every field above must be null.
6. Set could_not_find_anything to true if you found nothing usable at all.

Respond with ONLY a single JSON object (no markdown fence, no prose before or after) matching exactly this shape:
{{
{schema_body}
  "sources_used": [<url string>, ...],
  "could_not_find_anything": <true or false>
}}
"""
