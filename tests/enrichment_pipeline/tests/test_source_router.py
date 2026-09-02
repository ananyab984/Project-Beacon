"""Tests for the explicit Source-dropdown -> (provider, parser) router."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from core.source_router import SOURCE_MAP, route_lead


def test_all_source_map_entries_route_correctly():
    """Every explicit mapping must round-trip exactly as declared in SOURCE_MAP."""
    for source, expected in SOURCE_MAP.items():
        assert route_lead(source) == expected


def test_route_lead_is_case_insensitive():
    assert route_lead("LinkedIn") == ("brightdata", "linkedin")
    assert route_lead("PROZ") == ("tavily_search", "proz")


def test_route_lead_strips_whitespace():
    assert route_lead("  linkedin  ") == ("brightdata", "linkedin")
    assert route_lead("\tata\n") == ("tavily_extract", "ata")


def test_route_lead_unmapped_source_falls_back_to_generic_llm():
    assert route_lead("some-custom-agency") == ("tavily_extract", "generic_llm")


def test_route_lead_empty_string_falls_back_to_generic_llm():
    assert route_lead("") == ("tavily_extract", "generic_llm")


def test_route_lead_none_falls_back_to_generic_llm():
    assert route_lead(None) == ("tavily_extract", "generic_llm")


def test_ata_and_ataa_are_distinct_mappings():
    """ATA and ATAA share a prefix but must route to distinct parsers."""
    assert route_lead("ata") == ("tavily_extract", "ata")
    assert route_lead("ataa") == ("tavily_extract", "ataa")
    assert route_lead("ata") != route_lead("ataa")
