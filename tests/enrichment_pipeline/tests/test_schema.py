"""Tests for canonical schema definitions and value/emptiness helpers."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from core.schema import CANONICAL_FIELDS, CRITICAL_FIELDS, create_empty_lead, is_empty_value


def test_canonical_fields_has_18_unique_entries():
    """13 original Template_ProjectBeacon.xlsx fields + 5 extra LinkedIn-scrape fields."""
    assert len(CANONICAL_FIELDS) == 18
    assert len(set(CANONICAL_FIELDS)) == 18, "CANONICAL_FIELDS must not contain duplicates"


def test_critical_fields_are_a_subset_of_canonical_fields():
    assert set(CRITICAL_FIELDS).issubset(set(CANONICAL_FIELDS))
    assert CRITICAL_FIELDS == ["Email_Address", "Contact_Number", "Years_of_Exp"]


def test_is_empty_value_none():
    assert is_empty_value(None) is True


def test_is_empty_value_empty_and_whitespace_strings():
    assert is_empty_value("") is True
    assert is_empty_value("   ") is True
    assert is_empty_value("\t\n") is True


def test_is_empty_value_non_empty_string():
    assert is_empty_value("Alice") is False
    assert is_empty_value("  Alice  ") is False


def test_is_empty_value_empty_collections():
    assert is_empty_value([]) is True
    assert is_empty_value({}) is True
    assert is_empty_value(set()) is True
    assert is_empty_value(()) is True


def test_is_empty_value_non_empty_collections():
    assert is_empty_value(["x"]) is False
    assert is_empty_value({"k": "v"}) is False
    assert is_empty_value({1}) is False
    assert is_empty_value((1,)) is False


def test_is_empty_value_falsy_but_meaningful_values_are_not_empty():
    """0 and False are real values, not "missing" -- must not be treated as empty."""
    assert is_empty_value(0) is False
    assert is_empty_value(False) is False
    assert is_empty_value(0.0) is False


def test_create_empty_lead_has_every_canonical_field_set_to_none():
    lead = create_empty_lead()
    assert set(lead.keys()) == set(CANONICAL_FIELDS)
    assert all(v is None for v in lead.values())


def test_create_empty_lead_returns_a_fresh_dict_each_call():
    lead_a = create_empty_lead()
    lead_b = create_empty_lead()
    lead_a["First_Name"] = "Alice"
    assert lead_b["First_Name"] is None, "Mutating one empty lead must not affect another"
