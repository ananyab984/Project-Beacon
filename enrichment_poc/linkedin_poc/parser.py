"""Parse & flatten Bright Data LinkedIn responses into tabular columns.

Two things make this parser robust to the uncertainty flagged in the spec:

1. **Shape-agnostic input** — Bright Data documents a single flat object for a
   one-URL request, but the parser also accepts a one-item list. Confirm the
   real shape in Phase 1; either way this code copes.

2. **Candidate-key field map** — each output column lists several plausible
   source keys/paths (LinkedIn dataset field names vary), and the first present
   non-empty one wins. Adding or re-mapping a field is a one-line change.

Unmapped top-level keys in the response are logged so new fields Bright Data
starts returning are easy to spot and wire up later.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from logger import get_logger
from utils import safe_get

log = get_logger(__name__)

# Prefix keeps enrichment columns from clobbering original input columns
# (the input already has First_Name, Full_Name, Email_Address, etc.).
COL_PREFIX = "Enriched_"


def _join_skills(value: Any) -> str:
    """Skills may arrive as a list of strings or list of {name/title} dicts."""
    if not isinstance(value, list):
        return _stringify(value)
    names = []
    for item in value:
        if isinstance(item, dict):
            names.append(item.get("name") or item.get("title") or "")
        else:
            names.append(str(item))
    return ", ".join(n for n in names if n)


def _join_links(value: Any) -> str:
    """Join a list of {title, link} dicts (bio_links) as ``title: url``.

    This is the closest thing to public contact data for freelancer profiles
    (e.g. a personal/company website), since email/phone are never returned.
    """
    if not isinstance(value, list):
        return _stringify(value)
    out = []
    for item in value:
        if isinstance(item, dict):
            link = item.get("link") or item.get("url") or ""
            title = item.get("title")
            if link:
                out.append(f"{title}: {link}" if title else link)
        elif item:
            out.append(str(item))
    return "; ".join(out)


def _join_titled(value: Any) -> str:
    """Join a list of {title, subtitle} dicts (languages, certifications).

    Example: ``[{"title": "English", "subtitle": "Full professional ..."}]``
    -> ``"English (Full professional ...)"``.
    """
    if not isinstance(value, list):
        return _stringify(value)
    out = []
    for item in value:
        if isinstance(item, dict):
            title = item.get("title") or item.get("name") or ""
            subtitle = item.get("subtitle")
            out.append(f"{title} ({subtitle})" if subtitle else title)
        else:
            out.append(str(item))
    return "; ".join(x for x in out if x)


def _as_json(value: Any) -> str:
    """Serialize a nested list/dict (experience, education) to compact JSON."""
    if value in (None, "", [], {}):
        return ""
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


# Each entry: output column suffix -> (candidate source paths, transform).
# A path is a tuple walked with safe_get; the first non-empty result wins.
# `transform` is applied to the chosen raw value.
FIELD_MAP: dict[str, tuple[list[tuple[str, ...]], Callable[[Any], Any]]] = {
    "Full_Name": ([("name",), ("full_name",)], _stringify),
    "First_Name": ([("first_name",)], _stringify),
    "Last_Name": ([("last_name",)], _stringify),
    "Headline": ([("headline",), ("position",), ("sub_title",)], _stringify),
    "About": ([("about",), ("summary",), ("bio",)], _stringify),
    "Current_Job_Title": (
        [("current_company", "title"), ("position",), ("current_job_title",)],
        _stringify,
    ),
    "Current_Company": (
        [("current_company", "name"), ("current_company_name",), ("company",)],
        _stringify,
    ),
    "Company_Website": (
        [("current_company", "website"), ("company_website",)],
        _stringify,
    ),
    "Company_LinkedIn": (
        [("current_company", "link"), ("current_company", "url"), ("company_linkedin_url",)],
        _stringify,
    ),
    "Industry": ([("industry",), ("current_company", "industry")], _stringify),
    "Location": ([("city",), ("location",)], _stringify),
    "Country": ([("country_code",), ("country",)], _stringify),
    "Followers": ([("followers",)], _stringify),
    "Connections": ([("connections",)], _stringify),
    "Public_Email": ([("public_email",), ("email",)], _stringify),
    "Work_Email": ([("work_email",)], _stringify),
    "Phone_Number": ([("phone_number",), ("phone",), ("phone1",)], _stringify),
    # Personal/company website(s) from bio_links — the only public contact-ish
    # data available (email/phone are never returned by this dataset).
    "Website": ([("bio_links",)], _join_links),
    "Experience": ([("experience",), ("experiences",)], _as_json),
    "Education": ([("education",), ("educations_details",), ("educations",)], _as_json),
    "Skills": ([("skills",)], _join_skills),
    # Confirmed present in the real Bright Data response (Phase 1) and highly
    # relevant for a translator/recruiter platform.
    "Languages": ([("languages",)], _join_titled),
    "Certifications": ([("certifications",)], _join_titled),
    "Profile_URL": ([("url",), ("input_url",), ("linkedin_url",)], _stringify),
}

# The set of top-level source keys we intentionally consume, so we can report
# everything else as "unmapped" for future extension.
_KNOWN_TOP_LEVEL = {paths[0][0] for paths, _ in FIELD_MAP.values()} | {
    p[0] for paths, _ in FIELD_MAP.values() for p in paths
}


def normalize_response(raw: Any) -> dict:
    """Collapse Bright Data's response into a single profile dict.

    Accepts either a dict (documented single-URL shape) or a list; for a list
    the first element is used (a warning is logged if more than one was
    returned for what should be a single-URL request).
    """
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, list):
        if not raw:
            return {}
        if len(raw) > 1:
            log.warning(
                "Response was a list of %d items for a single-URL request; "
                "using the first.",
                len(raw),
            )
        first = raw[0]
        return first if isinstance(first, dict) else {}
    log.warning("Unexpected response type %s; treating as empty.", type(raw).__name__)
    return {}


def _first_present(profile: dict, paths: list[tuple[str, ...]]) -> Any:
    """Return the first non-empty value among the candidate paths."""
    for path in paths:
        value = safe_get(profile, *path)
        if value not in (None, "", [], {}):
            return value
    return None


def parse_profile(raw: Any) -> dict[str, Any]:
    """Flatten a Bright Data response into ``Enriched_*`` columns.

    Missing fields (very common for email/phone on public profiles) yield "" —
    that is the normal case, never an error.
    """
    profile = normalize_response(raw)
    flat: dict[str, Any] = {}

    for suffix, (paths, transform) in FIELD_MAP.items():
        raw_value = _first_present(profile, paths)
        flat[f"{COL_PREFIX}{suffix}"] = transform(raw_value) if raw_value is not None else ""

    _log_unmapped_keys(profile)
    return flat


def enrichment_columns() -> list[str]:
    """Ordered list of the enrichment column names this parser produces.

    Used by the writer so failed rows still get a full, aligned set of columns.
    """
    return [f"{COL_PREFIX}{suffix}" for suffix in FIELD_MAP]


def _log_unmapped_keys(profile: dict) -> None:
    """Log any top-level response keys not covered by FIELD_MAP."""
    if not profile:
        return
    unmapped = sorted(set(profile.keys()) - _KNOWN_TOP_LEVEL)
    if unmapped:
        log.info(
            "Unmapped top-level response keys (candidates for future columns): %s",
            ", ".join(unmapped),
        )
