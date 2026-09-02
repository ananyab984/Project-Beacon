"""Tests for the Enrichment Percentage / field-completeness audit."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from core.field_audit import audit_lead_fields
from core.schema import CANONICAL_FIELDS, CRITICAL_FIELDS


def test_fully_empty_lead_has_zero_percentage_and_all_fields_missing():
    result = audit_lead_fields({})
    assert result["total_fields"] == len(CANONICAL_FIELDS)
    assert result["populated_count"] == 0
    assert result["enrichment_percentage"] == 0
    assert result["missing_fields"] == CANONICAL_FIELDS
    assert result["missing_critical_fields"] == CRITICAL_FIELDS
    assert result["is_complete"] is False


def test_fully_populated_lead_is_100_percent_and_complete():
    lead = {field: "value" for field in CANONICAL_FIELDS}
    result = audit_lead_fields(lead)
    assert result["populated_count"] == len(CANONICAL_FIELDS)
    assert result["enrichment_percentage"] == 100
    assert result["missing_fields"] == []
    assert result["missing_critical_fields"] == []
    assert result["is_complete"] is True


def test_partial_lead_rounds_percentage_correctly():
    """1 of 18 canonical fields populated -> round(1/18*100) = 6."""
    lead = {"First_Name": "Alice"}
    result = audit_lead_fields(lead)
    assert result["populated_count"] == 1
    assert result["enrichment_percentage"] == round((1 / len(CANONICAL_FIELDS)) * 100)
    assert "First_Name" not in result["missing_fields"]


def test_is_complete_depends_only_on_critical_fields_not_overall_percentage():
    """A lead can be far from 100% enriched yet still 'complete' if all 3
    critical fields (Email_Address, Contact_Number, Years_of_Exp) are filled."""
    lead = {f: "x" for f in CRITICAL_FIELDS}
    result = audit_lead_fields(lead)
    assert result["missing_critical_fields"] == []
    assert result["is_complete"] is True
    assert result["enrichment_percentage"] < 100


def test_missing_one_critical_field_marks_incomplete_even_if_mostly_populated():
    lead = {field: "x" for field in CANONICAL_FIELDS}
    lead["Email_Address"] = None
    result = audit_lead_fields(lead)
    assert result["missing_critical_fields"] == ["Email_Address"]
    assert result["is_complete"] is False


def test_placeholder_style_empty_values_count_as_missing():
    """Whitespace-only strings and empty collections are treated as empty
    (via core.schema.is_empty_value), not as populated values."""
    lead = {"First_Name": "   ", "Secondary_Languages": [], "Tools_Software": {}}
    result = audit_lead_fields(lead)
    assert "First_Name" in result["missing_fields"]
    assert "Secondary_Languages" in result["missing_fields"]
    assert "Tools_Software" in result["missing_fields"]


def test_missing_fields_and_missing_critical_preserve_canonical_order():
    lead = {}
    result = audit_lead_fields(lead)
    assert result["missing_fields"] == list(CANONICAL_FIELDS)
    assert result["missing_critical_fields"] == list(CRITICAL_FIELDS)
