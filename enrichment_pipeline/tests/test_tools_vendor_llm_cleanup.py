"""Tests for Stage 3.77's Groq-based cleanup/broadening pass for
Tools_Software and Vendor_Experience
(orchestrator._infer_tools_vendor_via_llm / GroqMappingClient.classify_tools_and_vendors).

Added because parsers/tool_aliases.py's and parsers/vendor_aliases.py's
plain substring alias scan only catches a tool/vendor phrased exactly one of
the ways the alias list anticipates -- "cut on Avid" or "editing in Adobe's
Premiere suite" names a real, recognizable tool that no substring match
would catch. Unlike every other LLM stage in the waterfall, this one is NOT
fill-only: it runs regardless of whether the deterministic scan already
found something, and merges with (never replaces) whatever's already there --
this is also what makes a repeat enrichment run actually able to backfill
these two fields on an already-enriched lead, instead of the "never
overwrite existing data" rule treating a stale/incomplete prior value as
permanently resolved.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_tools_vendor_llm_cleanup.py
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


def test_merges_llm_result_with_existing_deterministic_match():
    orch = _orch()
    orch.groq_mapper = stub(
        classify_tools_and_vendors=lambda text: {"tools_software": ["Avid Media Composer"], "vendor_experience": []}
    )
    lead = {
        "Tools_Software": "Pro Tools",
        "Vendor_Experience": None,
        "Headline": "Post-production editor -- cut on Avid daily",
    }
    field_sources: dict = {}
    logs: list = []
    orch._infer_tools_vendor_via_llm(lead, field_sources, logs)
    assert lead["Tools_Software"] == "Pro Tools, Avid Media Composer"
    assert field_sources["Tools_Software"] == "llm_fallback"


def test_runs_even_when_both_fields_already_populated():
    # Unlike every other LLM stage, this one must NOT skip on "already has a
    # value" -- that's the whole point (a repeat enrichment run needs to be
    # able to backfill a stale/incomplete prior value).
    orch = _orch()
    calls = {"n": 0}

    def classify(text):
        calls["n"] += 1
        return {"tools_software": ["XL8"], "vendor_experience": ["SDI"]}

    orch.groq_mapper = stub(classify_tools_and_vendors=classify)
    lead = {"Tools_Software": "MemoQ", "Vendor_Experience": "Deluxe", "Headline": "Localization specialist"}
    field_sources = {"Tools_Software": "brightdata", "Vendor_Experience": "brightdata"}
    logs: list = []
    orch._infer_tools_vendor_via_llm(lead, field_sources, logs)
    assert calls["n"] == 1
    assert lead["Tools_Software"] == "MemoQ, XL8"
    assert lead["Vendor_Experience"] == "Deluxe, SDI"
    assert field_sources["Tools_Software"] == "llm_fallback"
    assert field_sources["Vendor_Experience"] == "llm_fallback"


def test_no_new_data_leaves_fields_and_sources_untouched():
    orch = _orch()
    orch.groq_mapper = stub(classify_tools_and_vendors=lambda text: {"tools_software": [], "vendor_experience": []})
    lead = {"Tools_Software": "Pro Tools", "Vendor_Experience": None, "Headline": "Editor"}
    field_sources = {"Tools_Software": "brightdata"}
    logs: list = []
    orch._infer_tools_vendor_via_llm(lead, field_sources, logs)
    assert lead["Tools_Software"] == "Pro Tools"
    assert lead.get("Vendor_Experience") is None
    assert field_sources == {"Tools_Software": "brightdata"}, "must not stamp llm_fallback when nothing new was merged in"


def test_skipped_when_groq_not_configured():
    orch = _orch()
    assert orch.groq_mapper is None
    lead = {"Tools_Software": None, "Headline": "Editor"}
    field_sources: dict = {}
    logs: list = []
    orch._infer_tools_vendor_via_llm(lead, field_sources, logs)
    assert lead.get("Tools_Software") is None
    assert any("GROQ_API_KEY" in line for line in logs)


def test_skipped_when_no_text_to_classify():
    orch = _orch()
    orch.groq_mapper = stub(classify_tools_and_vendors=lambda text: {"tools_software": ["Pro Tools"], "vendor_experience": []})
    lead = {"Tools_Software": None}
    field_sources: dict = {}
    logs: list = []
    orch._infer_tools_vendor_via_llm(lead, field_sources, logs)
    assert lead.get("Tools_Software") is None


def test_groq_error_leaves_fields_untouched_not_a_crash():
    orch = _orch()

    def fail(text):
        raise GroqMappingError("boom")

    orch.groq_mapper = stub(classify_tools_and_vendors=fail)
    lead = {"Tools_Software": "Pro Tools", "Headline": "Editor"}
    field_sources: dict = {}
    logs: list = []
    orch._infer_tools_vendor_via_llm(lead, field_sources, logs)
    assert lead["Tools_Software"] == "Pro Tools"
    assert any("failed" in line.lower() for line in logs)
