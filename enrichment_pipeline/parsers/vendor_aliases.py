"""Canonical linguist-industry vendor/client name -> surface phrase/synonym
aliases -- the Vendor_Experience analogue of service_aliases.py.

The canonical list matches exactly what the recruiter-facing Vendor
Experience multi-select offers (Deluxe, SDI, Pixel Logic, Zoo Digital, VSI,
Plint, BTI, DeepDub, Ooona), so a name this scan matches is guaranteed to be
selectable in that UI -- an unmatched company (e.g. an unrelated past
employer) is deliberately left out rather than invented as a false vendor
entry, mirroring extract_services_from_text's closed-canonical-set behavior.
"""
from __future__ import annotations

from typing import Dict, List, Optional

VENDOR_ALIASES: Dict[str, List[str]] = {
    "Deluxe": ["deluxe media", "deluxe entertainment", "deluxe"],
    "SDI": ["sdi media", "sdi"],
    "Pixel Logic": ["pixelogic", "pixel logic"],
    "Zoo Digital": ["zoo digital group", "zoodigital", "zoo digital"],
    "VSI": ["voice & script international", "voice and script international", "vsi"],
    "Plint": ["plint ab", "plint"],
    "BTI": ["bti studios", "bti"],
    "DeepDub": ["deep dub", "deepdub"],
    "Ooona": ["ooona"],
}


def extract_vendors_from_text(text_blob: str) -> List[str]:
    lowered = text_blob.lower()
    matched: List[str] = []
    for canonical, aliases in VENDOR_ALIASES.items():
        if canonical not in matched and any(alias in lowered for alias in aliases):
            matched.append(canonical)
    return matched


# Employment-status words that show up in a `current_company`/experience
# `company` field on real profiles but are not actually the name of a
# company -- confirmed live: a lead whose Experience section named 9 real,
# distinct employers still had Vendor_Experience holding only "Freelancer",
# because that's literally what BrightData put in `current_company` and
# nothing downstream filtered it out before it reached a data column meant
# to name real companies.
NON_COMPANY_EMPLOYMENT_LABELS = {
    "freelancer", "freelance", "freelancing",
    "self-employed", "self employed", "independent", "independent contractor",
    "various clients", "confidential", "n/a", "none",
}


def canonicalize_or_keep(name: str) -> Optional[str]:
    """Maps a raw company name to its canonical spelling when it matches (or
    obviously varies from) a known vendor -- e.g. "SDI Media" / "Iyuno-SDI"
    both normalize to "SDI" -- and returns it unchanged when it's a real
    company that just isn't one of the 9 largest known industry vendors.
    Returns None for a name that isn't a real company at all (see
    NON_COMPANY_EMPLOYMENT_LABELS above), so a caller building a company list
    can drop it instead of reporting "Freelancer" as if it were a vendor.
    """
    cleaned = name.strip()
    if not cleaned or cleaned.lower() in NON_COMPANY_EMPLOYMENT_LABELS:
        return None
    lowered = cleaned.lower()
    for canonical, aliases in VENDOR_ALIASES.items():
        if any(alias in lowered for alias in aliases):
            return canonical
    return cleaned
