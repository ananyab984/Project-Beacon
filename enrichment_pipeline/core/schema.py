"""Canonical schema definitions for Project Beacon enrichment pipeline."""

from __future__ import annotations

from typing import Any, Dict, List

# The 13 canonical fields from Template_ProjectBeacon.xlsx, plus 5 additional
# fields captured from the same LinkedIn scrape to maximize personalization
# material (headline, About text, current title, named tools/software,
# certifications) that was previously discarded after parsing.
CANONICAL_FIELDS: List[str] = [
    "First_Name",
    "Full_Name",
    "Country_of_Residence",
    "Source",
    "Profile_Link",
    "Contact_Number",
    "Email_Address",
    "Services",
    "Source_Language",
    "Target_Language",
    "Secondary_Languages",
    "Years_of_Exp",
    "Vendor_Experience",
    "Headline",
    "About_Snippet",
    "Current_Title",
    "Tools_Software",
    "Certifications",
]

# The 3 critical fields that determine if LLM fallback is triggered
CRITICAL_FIELDS: List[str] = [
    "Email_Address",
    "Contact_Number",
    "Years_of_Exp",
]


def is_empty_value(val: Any) -> bool:
    """Return True if a field value is null, empty string, or empty collection."""
    if val is None:
        return True
    if isinstance(val, str) and not val.strip():
        return True
    if isinstance(val, (list, dict, set, tuple)) and len(val) == 0:
        return True
    return False


def has_content(value: Any) -> bool:
    """True if `value` carries actual data rather than a well-formed shell.

    Recurses on purpose: "is not empty" and "contains anything" are different
    questions, and only the second is worth acting on. `[{}, {}, {}]` is a
    non-empty list of three entries that each say nothing, and a plain
    truthiness check (or `is_empty_value` above, which only measures length)
    reads it as real content.

    That gap was not hypothetical. Confirmed live 2026-09-08: every one of 112
    experience/education/language rows across 32 enriched leads was `{}`,
    because the output schema declared those entries as free-form objects with
    no properties. The row COUNTS were right, so every check that asked "did
    anything come back?" said yes, the result was banked as a success, and the
    lead was never re-attempted -- while the recruiter saw "Enriched" over a
    profile whose deep sections all read "None found".

    Lives here rather than in orchestrator.py because every provider needs the
    same judgement and `providers/` cannot import `orchestrator` without a
    cycle. Judging a payload by its structure rather than its presence is what
    makes that whole class of bug self-correcting: a provider returning shells
    raises and gets retried instead of being recorded as a find.
    """
    if isinstance(value, dict):
        # Skip our own bookkeeping keys (`_original_language`, `_parallel_fallback`)
        # -- they are never the reason a payload counts as having found something.
        return any(
            has_content(v)
            for k, v in value.items()
            if not (isinstance(k, str) and k.startswith("_"))
        )
    if isinstance(value, (list, tuple, set)):
        return any(has_content(v) for v in value)
    if isinstance(value, str):
        return bool(value.strip())
    return value is not None


def create_empty_lead() -> Dict[str, Any]:
    """Create a dictionary with all canonical fields initialized to None."""
    return {field: None for field in CANONICAL_FIELDS}
