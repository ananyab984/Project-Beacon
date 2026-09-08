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


# Fields Stage 6 (orchestrator.py's web search) could ever actually fill,
# excluded from the 10-field UI metric above.
#
# `Profile_Link` is the LEAD'S INPUT, not something enrichment resolves --
# confirmed live 2026-09-08 across all 32 production leads, it was filled by
# enrichment exactly ZERO times, ever. `Email_Address`/`Contact_Number` are in
# orchestrator.py's WEBSEARCH_EXCLUDED_FIELDS (a wrong contact reaches a
# different real human being, so Stage 6 is forbidden from touching them) yet
# were still counted in the "how thin is this lead" metric that decides
# whether to RUN Stage 6 -- so the gate was partly measuring a stage's own
# forbidden output as if filling it were possible.
#
# Net effect, measured on the same 32 leads: with a denominator of 10 including
# these three, Stage 6 fired for 28 of 32 (88%) and recorded ZERO successes
# across every run captured in production logs. The threshold was demanding 6
# of a real 7 fillable fields without knowing it.
_STAGE6_UNFILLABLE_FIELDS = frozenset({"Profile_Link", "Email_Address", "Contact_Number"})

STAGE6_GATING_FIELDS = tuple(f for f in ENRICHMENT_COUNT_FIELDS if f not in _STAGE6_UNFILLABLE_FIELDS)


def count_stage6_fillable_fields(lead: Dict[str, Any], field_sources: Dict[str, str]) -> int:
    """Same provenance-gated counting as `count_enriched_fields`, but scoped to
    the fields Stage 6 could actually have filled -- use this ONLY to decide
    whether Stage 6 should run. `count_enriched_fields`/`ENRICHMENT_COUNT_FIELDS`
    stay untouched because they back the recruiter-facing "Enriched (n)" badge,
    which people already read; changing that denominator would move a number
    in front of users for a reason unrelated to what they see it for."""
    count = 0
    for field in STAGE6_GATING_FIELDS:
        if is_empty_value(lead.get(field)):
            continue
        source = field_sources.get(field)
        if source and source not in _NOT_ENRICHED_SOURCES:
            count += 1
    return count
