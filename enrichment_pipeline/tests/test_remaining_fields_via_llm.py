"""Tests for _infer_remaining_fields_via_llm -- the waterfall's last tier for
Current_Title/Certifications: only fires for fields already confirmed empty
(never re-asked about a populated field, manual or otherwise), one Claude
call covering every gap at once.

Tools_Software and Vendor_Experience used to be covered here too, but now
have their own dedicated stage (_infer_tools_vendor_via_llm, Stage 3.77 --
see test_tools_vendor_llm_cleanup.py) that runs regardless of prior
emptiness instead of fill-only, so they were removed from this stage's
field set to avoid a redundant second Claude call for the same two fields.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_remaining_fields_via_llm.py
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


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


def test_fills_only_the_fields_that_were_actually_empty():
    calls = []

    def extract(text, missing_fields):
        calls.append(list(missing_fields))
        return {"Current_Title": "Freelance Subtitler"}

    orch = make_orchestrator()
    orch.groq_mapper = stub(extract_missing_fields=extract)

    lead = {
        "Headline": "Experienced subtitler using Trados",
        "Current_Title": None,
        "Certifications": "ATA Certified",  # already populated -- must never be re-asked
    }
    field_sources: dict[str, str] = {}
    orch._infer_remaining_fields_via_llm(lead, field_sources, [])

    assert calls == [["Current_Title"]], (
        "Certifications was already populated and must never be included in the request"
    )
    assert lead["Current_Title"] == "Freelance Subtitler"
    assert field_sources["Current_Title"] == "llm_fallback"
    assert lead["Certifications"] == "ATA Certified", "an already-populated field must never be overwritten"


def test_never_called_when_nothing_is_missing():
    calls = {"n": 0}
    orch = make_orchestrator()
    orch.groq_mapper = stub(extract_missing_fields=lambda *a, **k: calls.__setitem__("n", calls["n"] + 1) or {})

    lead = {"Current_Title": "Senior Editor", "Certifications": "None"}
    orch._infer_remaining_fields_via_llm(lead, {}, [])
    assert calls["n"] == 0, "no API call should be made when every candidate field already has a value"


def test_never_called_when_no_free_text_is_available():
    calls = {"n": 0}
    orch = make_orchestrator()
    orch.groq_mapper = stub(extract_missing_fields=lambda *a, **k: calls.__setitem__("n", calls["n"] + 1) or {})

    lead = {"Current_Title": None, "Certifications": None}
    orch._infer_remaining_fields_via_llm(lead, {}, [])
    assert calls["n"] == 0, "no text to read means no reason to call Claude"


def test_absence_prose_in_a_returned_field_is_rejected():
    orch = make_orchestrator()
    orch.groq_mapper = stub(extract_missing_fields=lambda text, missing: {"Current_Title": "Not disclosed in the available profile text."})

    lead = {"Headline": "Freelance translator", "Current_Title": None}
    field_sources: dict[str, str] = {}
    orch._infer_remaining_fields_via_llm(lead, field_sources, [])

    assert lead["Current_Title"] is None
    assert "Current_Title" not in field_sources


def test_claude_error_leaves_fields_empty_without_raising():
    from llm_fallback.groq_client import GroqMappingError

    def boom(text, missing):
        raise GroqMappingError("network blip")

    orch = make_orchestrator()
    orch.groq_mapper = stub(extract_missing_fields=boom)

    lead = {"Headline": "Freelance translator", "Current_Title": None}
    field_sources: dict[str, str] = {}
    orch._infer_remaining_fields_via_llm(lead, field_sources, [])

    assert lead["Current_Title"] is None
    assert "Current_Title" not in field_sources
