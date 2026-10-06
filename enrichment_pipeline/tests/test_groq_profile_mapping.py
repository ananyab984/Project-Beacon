"""Tests for _map_all_fields_via_groq: Groq only FORMATS the raw provider
data into canonical fields, and the grounding check is what makes that a
guarantee -- a value that is not in the raw data never lands, whatever the
model returns. Also pins the Christopher Boyce gap: a tool named only in
Parallel's skills used to stay out of Tools_Software because only a fixed
keyword list could fill it.

Run: cd enrichment_pipeline && .venv/bin/python -m pytest tests/test_groq_profile_mapping.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from llm_fallback.groq_client import GroqMappingClient, GroqMappingError
from orchestrator import EnrichmentOrchestrator

PARALLEL = {
    "headline": "Voice-over Artist & Audio Engineer",
    "skills": ["Voice Acting", "Reaper", "Source-Connect"],
    "experience": [{"company": "Self-employed", "title": "Voice Actor"}, {"company": "VoiceWorks Studio", "title": "Engineer"}],
}


def _orch(mapped):
    orch = EnrichmentOrchestrator(Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key=""))
    calls = []

    def map_profile(raw_json):
        calls.append(raw_json)
        if isinstance(mapped, Exception):
            raise mapped
        return mapped

    orch.groq_mapper = type("Stub", (), {"map_profile": staticmethod(map_profile)})()
    return orch, calls


def _run(orch, lead=None, raw=None):
    lead = lead if lead is not None else {}
    field_sources, logs = {}, []
    orch._map_all_fields_via_groq(lead, field_sources, logs, raw if raw is not None else {"parallel": PARALLEL})
    return lead, field_sources, logs


def test_a_tool_listed_only_in_skills_reaches_tools_software():
    orch, _ = _orch({"Tools_Software": ["Reaper", "Source-Connect"]})
    lead, sources, _ = _run(orch)
    assert lead["Tools_Software"] == "Reaper, Source-Connect"
    assert sources["Tools_Software"] == "llm_fallback"


def test_a_value_not_in_the_raw_data_is_dropped():
    orch, _ = _orch({"Tools_Software": ["Reaper", "Pro Tools"], "Current_Title": "Senior Sound Designer"})
    lead, _, logs = _run(orch)
    assert lead["Tools_Software"] == "Reaper"
    assert "Current_Title" not in lead
    assert any("not found in the raw data" in line for line in logs)


def test_punctuation_and_case_differences_still_ground():
    orch, _ = _orch({"Headline": "voice over artist & audio engineer"})
    lead, _, _ = _run(orch)
    assert lead["Headline"] == "voice over artist & audio engineer"


def test_text_fields_are_fill_only_and_lists_are_unioned():
    orch, _ = _orch({"Headline": "Voice-over Artist & Audio Engineer", "Vendor_Experience": ["VoiceWorks Studio", "Self-employed"]})
    lead, _, _ = _run(orch, lead={"Headline": "Narrator", "Vendor_Experience": "Iyuno"})
    assert lead["Headline"] == "Narrator"
    # Self-employed is a non-company label, never a vendor (vendor_aliases.canonicalize_or_keep)
    assert lead["Vendor_Experience"] == "Iyuno, VoiceWorks Studio"


def test_contact_and_years_are_never_part_of_the_mapping():
    fields = GroqMappingClient.PROFILE_FIELDS
    assert not {"Email_Address", "Contact_Number", "Years_of_Exp"} & set(fields)


def test_noise_and_bookkeeping_keys_are_not_sent():
    orch, calls = _orch({})
    _run(orch, raw={"parallel": {**PARALLEL, "_original_language": {"headline": "x"}}, "brightdata": [{"avatar": "http://img", "about": "Hi"}]})
    assert "http://img" not in calls[0] and "_original_language" not in calls[0]
    assert "Hi" in calls[0]


def test_nothing_raw_means_no_groq_call():
    orch, calls = _orch({"Headline": "x"})
    _run(orch, raw={"parallel": None, "brightdata": None})
    assert calls == []


def test_a_groq_error_keeps_the_deterministic_mapping():
    orch, _ = _orch(GroqMappingError("boom"))
    lead, _, logs = _run(orch, lead={"Headline": "Narrator"})
    assert lead == {"Headline": "Narrator"}
    assert any("Groq mapping failed" in line for line in logs)


def test_a_garbled_services_value_is_cleared_then_refilled():
    orch, _ = _orch({"Services": ["Voice Acting"]})
    lead, _, _ = _run(orch, lead={"Services": "id, 1788358696814, rate, 10, task, Quality Control"})
    assert lead["Services"] == "Voice Acting"
