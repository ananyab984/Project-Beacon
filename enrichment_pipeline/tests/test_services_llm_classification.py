"""Tests for Stage 3.75's local Services classification
(orchestrator._infer_services_via_llm / GroqMappingClient.classify_services) --
added because parsers/service_aliases.py's fixed ~15-term keyword list only
recognizes localization-industry vocabulary (Dubbing, Subtitling,
Translation...), so a real service phrased differently ("Audio Engineer",
"Sound Designer") never matches it, however plainly the text states it.

Confirmed live: a lead with a fully populated Headline/Current_Title/
About_Snippet ("Audio Engineer at VSI / Voice & Script International",
"London-based audio engineer...") had a completely empty Services field,
and Stage 6's web-search fallback never got a chance to fix it either,
since that stage is gated on overall lead thinness -- a lead this rich in
other fields looks "not thin enough" even though Services alone never
resolved. This stage runs unconditionally instead (no live web search, so
no thinness gate applies) whenever Services is still empty after Tier 1 +
Tier 2.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_services_llm_classification.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from llm_fallback.groq_client import GroqMappingError
from orchestrator import EnrichmentOrchestrator


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


def test_classifies_a_service_the_fixed_alias_list_cannot_recognize():
    orch = _orch()
    orch.groq_mapper = stub(classify_services=lambda text: ["Audio Engineering"])
    lead = {
        "Services": None,
        "Headline": "Audio Engineer at VSI / Voice & Script International",
        "Current_Title": "Audio Engineer",
        "About_Snippet": "London-based audio engineer with 8 years mixing dub tracks.",
    }
    field_sources: dict = {}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead["Services"] == "Audio Engineering"
    assert field_sources["Services"] == "llm_fallback"


def test_skipped_when_services_already_populated():
    orch = _orch()
    calls = {"n": 0}
    orch.groq_mapper = stub(classify_services=lambda text: calls.__setitem__("n", calls["n"] + 1) or ["Dubbing"])
    lead = {"Services": "Translation", "Headline": "Translator"}
    field_sources = {"Services": "brightdata"}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead["Services"] == "Translation", "an already-resolved Services value must never be touched"
    assert calls["n"] == 0, "the LLM must not even be called when Services is already populated"


def test_skipped_when_claude_not_configured():
    orch = _orch()
    assert orch.groq_mapper is None
    lead = {"Services": None, "Headline": "Audio Engineer"}
    field_sources: dict = {}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead.get("Services") is None
    assert any("GROQ_API_KEY" in line for line in logs)


def test_skipped_when_no_text_to_classify():
    orch = _orch()
    orch.groq_mapper = stub(classify_services=lambda text: ["Dubbing"])
    lead = {"Services": None}
    field_sources: dict = {}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead.get("Services") is None


def test_no_groundable_service_leaves_services_empty():
    orch = _orch()
    orch.groq_mapper = stub(classify_services=lambda text: [])
    lead = {"Services": None, "Headline": "Business Owner", "Current_Title": "Operations"}
    field_sources: dict = {}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead.get("Services") is None
    assert "Services" not in field_sources


def test_claude_error_leaves_services_empty_not_a_crash():
    orch = _orch()

    def fail(text):
        raise GroqMappingError("boom")

    orch.groq_mapper = stub(classify_services=fail)
    lead = {"Services": None, "Headline": "Audio Engineer"}
    field_sources: dict = {}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead.get("Services") is None
    assert any("failed" in line.lower() for line in logs)


def test_a_title_that_recruits_for_a_specialty_is_not_treated_as_performing_it():
    # This is what the fixed keyword scan gets wrong (matches "Localization
    # Recruiter" as if the person localizes content themselves) and the LLM
    # prompt explicitly guards against -- exercised here via the stub
    # returning what a correctly-behaving classification would produce.
    orch = _orch()
    orch.groq_mapper = stub(classify_services=lambda text: [])
    lead = {"Services": None, "Current_Title": "Localization Recruiter", "Headline": "Recruiter"}
    field_sources: dict = {}
    logs: list = []
    orch._infer_services_via_llm(lead, field_sources, logs)
    assert lead.get("Services") is None
