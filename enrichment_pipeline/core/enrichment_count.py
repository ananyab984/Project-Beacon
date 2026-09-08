"""Python-side mirror of server/src/lib/enrichmentCount.ts's ENRICHMENT_COUNT_FIELDS
/ countPopulatedFields -- the exact same 10-field, provenance-gated "how many
fields did enrichment actually find" metric the recruiter-facing "Enriched
(n)" UI badge already uses, so Stage 6's <= 5 trigger threshold means the
same thing on both sides of the stack.

Deliberately a separate module from core/field_audit.py's audit_lead_fields:
that function's 18-field, provenance-blind count backs the recruiter-facing
Enrichment Score shown elsewhere, and changing its denominator would move a
number people already read. This one exists purely to gate Stage 6.
"""

from __future__ import annotations

from typing import Any, Dict

from core.schema import is_empty_value

# Same 10 canonical fields as the Node dialog's ENRICHMENT_COUNT_FIELDS.
ENRICHMENT_COUNT_FIELDS = (
    "Email_Address",
    "Contact_Number",
    "Country_of_Residence",
    "Profile_Link",
    "Source_Language",
    "Target_Language",
    "Services",
    "Headline",
    "Current_Title",
    "About_Snippet",
)

# A field with this source (or no recorded source at all) arrived already
# populated on the input row, not from enrichment -- same "existing" tag
# orchestrator.py's process_lead stamps before any provider runs.
_NOT_ENRICHED_SOURCES = frozenset({"existing"})


def count_enriched_fields(lead: Dict[str, Any], field_sources: Dict[str, str]) -> int:
    """How many of the 10 dialog fields enrichment actually found for this
    lead -- non-empty AND attributed to a real provider, not merely present
    from import."""
    count = 0
    for field in ENRICHMENT_COUNT_FIELDS:
        if is_empty_value(lead.get(field)):
            continue
        source = field_sources.get(field)
        if source and source not in _NOT_ENRICHED_SOURCES:
            count += 1
    return count
