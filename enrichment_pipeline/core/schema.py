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
    "Experience_History",
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


def create_empty_lead() -> Dict[str, Any]:
    """Create a dictionary with all canonical fields initialized to None."""
    return {field: None for field in CANONICAL_FIELDS}
