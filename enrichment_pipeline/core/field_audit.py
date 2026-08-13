"""Field audit module and dynamic Enrichment Percentage calculator."""

from __future__ import annotations

from typing import Any, Dict, List, TypedDict

from core.schema import CANONICAL_FIELDS, CRITICAL_FIELDS, is_empty_value


class AuditResult(TypedDict):
    total_fields: int
    populated_count: int
    enrichment_percentage: int
    missing_fields: List[str]
    missing_critical_fields: List[str]
    is_complete: bool


def audit_lead_fields(lead: Dict[str, Any]) -> AuditResult:
    """Audit a lead record and calculate its current Enrichment Percentage.

    Formula: round((populated_count / 13) * 100)
    Rule: Never overwrite existing populated fields.
    """
    populated = [f for f in CANONICAL_FIELDS if not is_empty_value(lead.get(f))]
    missing = [f for f in CANONICAL_FIELDS if is_empty_value(lead.get(f))]
    missing_critical = [f for f in CRITICAL_FIELDS if is_empty_value(lead.get(f))]

    total = len(CANONICAL_FIELDS)
    percentage = round((len(populated) / total) * 100) if total > 0 else 0

    return {
        "total_fields": total,
        "populated_count": len(populated),
        "enrichment_percentage": percentage,
        "missing_fields": missing,
        "missing_critical_fields": missing_critical,
        "is_complete": len(missing_critical) == 0,
    }
