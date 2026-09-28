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

from typing import Dict, List

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
