"""Tests for _infer_years_of_experience_from_text -- the free-text companion
to _years_of_experience_from_parallel_entries (which only reads Parallel's
structured `experience` list, and stays permanently unresolved for a lead
whose duration is stated in prose instead, e.g. a Headline reading "Hybrid
Localization Pro, 18+ years").

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_years_of_experience_free_text.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from orchestrator import EnrichmentOrchestrator
from config import Config


def make_orchestrator() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def test_confirmed_live_case_extracts_18_plus_years_from_headline():
    orch = make_orchestrator()
    lead = {"Headline": "Hybrid Localization Pro, 18+ years", "Years_of_Exp": None}
    field_sources: dict[str, str] = {}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])

    assert lead["Years_of_Exp"] == "18"
    assert field_sources["Years_of_Exp"] == "llm_fallback"


def test_plain_years_phrasing_without_plus_sign():
    orch = make_orchestrator()
    lead = {"About_Snippet": "Freelance translator with 10 years of experience in legal documents.", "Years_of_Exp": None}
    field_sources: dict[str, str] = {}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])
    assert lead["Years_of_Exp"] == "10"


def test_abbreviated_yrs_phrasing():
    orch = make_orchestrator()
    lead = {"Current_Title": "Senior Editor, 12+ yrs", "Years_of_Exp": None}
    field_sources: dict[str, str] = {}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])
    assert lead["Years_of_Exp"] == "12"


def test_does_not_overwrite_an_already_populated_value():
    orch = make_orchestrator()
    lead = {"Headline": "18+ years in localization", "Years_of_Exp": 5}
    field_sources: dict[str, str] = {"Years_of_Exp": "parallel"}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])

    assert lead["Years_of_Exp"] == 5, "an existing value -- from any source -- must never be overwritten by this fallback"
    assert field_sources["Years_of_Exp"] == "parallel"


def test_no_text_to_search_leaves_it_empty():
    orch = make_orchestrator()
    lead = {"Years_of_Exp": None}
    field_sources: dict[str, str] = {}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])
    assert "Years_of_Exp" not in field_sources


def test_no_duration_mentioned_leaves_it_empty():
    orch = make_orchestrator()
    lead = {"Headline": "Passionate about great subtitles.", "Years_of_Exp": None}
    field_sources: dict[str, str] = {}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])
    assert "Years_of_Exp" not in field_sources


def test_implausible_number_is_rejected():
    """A stray "500 years" (a typo, or a year like "2005" partially matched)
    must not be accepted as a real career length."""
    orch = make_orchestrator()
    lead = {"Headline": "500 years of combined team experience", "Years_of_Exp": None}
    field_sources: dict[str, str] = {}
    orch._infer_years_of_experience_from_text(lead, field_sources, [])
    # The regex only captures 1-2 digits, so "500" can never match whole --
    # this documents that boundary rather than re-deriving it.
    assert "Years_of_Exp" not in field_sources
