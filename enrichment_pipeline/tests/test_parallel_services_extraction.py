"""Tests for Parallel's new Services mapping -- previously Parallel (Tier 2)
mapped nothing into Services at all, so a lead whose Tier 1 scrape found no
structured `skills` and no free-text match (the common BrightData case)
stayed permanently un-serviced even when Parallel's own headline/about
payload for that same lead plainly named a service. Confirmed live: 5 of 10
real leads with empty Services and a stored Parallel payload would gain a
real Services value from headline/current_title/about_snippet text alone.

Mirrors Stage 3's BrightData/LinkedIn parser precedence exactly: a
structured skills/specialties section verbatim first, then a deterministic
keyword scan of headline/title/about text against the same canonical
service-category aliases (parsers/service_aliases.py), only when the
structured section came back empty.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_parallel_services_extraction.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from orchestrator import EnrichmentOrchestrator
from parsers.service_aliases import extract_services_from_text


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def test_structured_skills_are_used_verbatim():
    lead = {"Source": "LINKEDIN", "Services": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"skills": ["Subtitling", "Localization"]})
    assert lead["Services"] == "Subtitling, Localization"
    assert field_sources["Services"] == "parallel"


def test_falls_back_to_text_scan_when_no_structured_skills():
    lead = {"Source": "LINKEDIN", "Services": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"headline": "Voice & Dubbing Artist Punjabi Hindi", "current_title": "CEO", "about_snippet": None},
    )
    assert lead["Services"] == "Dubbing"


def test_no_match_leaves_services_untouched():
    lead = {"Source": "LINKEDIN", "Services": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"headline": "Operations at Global3", "current_title": "Business Owner", "about_snippet": None},
    )
    assert lead.get("Services") is None
    assert "Services" not in field_sources


def test_services_overrides_a_manual_dropdown_guess():
    # Services is in OVERRIDE_ON_VERIFIED_FIELDS -- a verified profile value
    # is allowed to replace a rough manually-picked dropdown value, same as
    # every other field in that set.
    lead = {"Source": "LINKEDIN", "Services": "Translation"}
    field_sources = {"Services": "manual"}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"skills": ["Dubbing"]})
    assert lead["Services"] == "Dubbing"
    assert field_sources["Services"] == "parallel"


def test_structured_skills_take_precedence_over_text_scan():
    lead = {"Source": "LINKEDIN", "Services": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"skills": ["Transcreation"], "headline": "Dubbing Artist"},
    )
    assert lead["Services"] == "Transcreation"


def test_absence_prose_in_skills_is_dropped_not_stored():
    lead = {"Source": "LINKEDIN", "Services": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"skills": ["None listed on this profile."], "headline": None, "current_title": None, "about_snippet": None},
    )
    assert lead.get("Services") is None


def test_extract_services_from_text_matches_known_aliases():
    assert extract_services_from_text("Experienced subtitler and translator") == ["Subtitling", "Translation"]
    assert extract_services_from_text("Just a regular bio with no service words") == []
