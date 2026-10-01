"""Tests for _looks_garbled and its use in _infer_services_via_llm's guard --
the recovery path for leads whose Services value was shredded from a JSON
object (e.g. `[{"id":..., "task":"Quality Control", ...}]`) into individual
garbage tokens ("rate", "10", "{id", "it-IT}") before normalizeServices.ts
learned to parse that shape. A plain "is Services empty" check leaves those
leads stuck forever, since any non-empty value (however bogus) reads as
"already resolved" to both the deterministic keyword scan and this stage.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_services_garbled_recovery.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from orchestrator import EnrichmentOrchestrator, _looks_garbled
from config import Config


def make_orchestrator() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


def test_looks_garbled_detects_the_real_shredded_payload():
    shredded = (
        "[{id, 1788358696814, rate, 10, task, Quality Control, service, dub, "
        "min_rate, 8, source_language, en-US, target_language, it-IT}, "
        "{id, 1788358845347, 3, Voice Generation, 2, it-IT}]"
    )
    assert _looks_garbled(shredded) is True


def test_looks_garbled_is_false_for_real_service_names():
    assert _looks_garbled("Subtitling, Dubbing, Quality Control") is False


def test_looks_garbled_is_false_for_empty_or_missing():
    assert _looks_garbled(None) is False
    assert _looks_garbled("") is False


def test_infer_services_reclassifies_a_garbled_value():
    orch = make_orchestrator()
    calls: list[str] = []

    def classify(text: str):
        calls.append(text)
        return ["Audio Engineering"]

    orch.groq_mapper = stub(classify_services=classify)
    lead = {
        "Services": "id, 1788358696814, rate, 10, task, Quality Control",
        "Headline": "Audio Engineer at VSI",
    }
    field_sources: dict[str, str] = {}
    orch._infer_services_via_llm(lead, field_sources, [])

    assert calls, "Claude should have been asked to reclassify a garbled Services value"
    assert lead["Services"] == "Audio Engineering"
    assert field_sources["Services"] == "llm_fallback"


def test_infer_services_clears_garbled_value_when_nothing_groundable():
    """A test/placeholder lead whose scrape only returned "No X was found"
    text (confirmed live on the reported bug's lead) has nothing real to
    classify from -- Claude correctly returns no services, and the garbled
    value must be cleared rather than left sitting there forever."""
    orch = make_orchestrator()
    orch.groq_mapper = stub(classify_services=lambda text: [])

    lead = {
        "Services": "id, 1788358696814, rate, 10, task, Quality Control",
        "Headline": "No profile headline was found for this lead.",
    }
    field_sources: dict[str, str] = {}
    orch._infer_services_via_llm(lead, field_sources, [])

    assert lead["Services"] == ""
    assert field_sources["Services"] == "llm_fallback"


def test_infer_services_leaves_a_real_value_untouched():
    orch = make_orchestrator()
    calls: list[str] = []
    orch.groq_mapper = stub(classify_services=lambda text: calls.append(text) or ["Should not be used"])

    lead = {"Services": "Subtitling, Dubbing", "Headline": "Localization specialist"}
    field_sources: dict[str, str] = {}
    orch._infer_services_via_llm(lead, field_sources, [])

    assert calls == [], "A real, non-garbled Services value must never be reclassified"
    assert lead["Services"] == "Subtitling, Dubbing"
    assert "Services" not in field_sources


def test_infer_services_still_fires_on_a_genuinely_empty_value():
    orch = make_orchestrator()
    orch.groq_mapper = stub(classify_services=lambda text: ["Translation"])

    lead = {"Services": "", "Headline": "Freelance translator"}
    field_sources: dict[str, str] = {}
    orch._infer_services_via_llm(lead, field_sources, [])

    assert lead["Services"] == "Translation"
    assert field_sources["Services"] == "llm_fallback"
