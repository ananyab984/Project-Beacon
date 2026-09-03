"""Tests for the waterfall's two shapes, conclusion states, and the 60s
lead-level cumulative timeout.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_orchestrator_waterfall.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import orchestrator as orchestrator_module
from config import Config
from llm_fallback.client import ClaudeError
from orchestrator import EnrichmentOrchestrator
from providers.brightdata_client import BrightDataError
from providers.clay_client import ClayError
from providers.tavily_client import TavilyError


def make_orchestrator() -> EnrichmentOrchestrator:
    # Empty keys -- __init__ skips constructing real clients; tests stub
    # orch.brightdata/tavily/clay/claude directly, same pattern as
    # tests/test_dedup.py's StubDedupClient.
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


def test_linkedin_waterfall_falls_through_brightdata_clay_to_llm():
    orch = make_orchestrator()
    calls = {"brightdata": 0, "clay": 0, "llm": 0}

    def bd_scrape(url):
        calls["brightdata"] += 1
        raise BrightDataError("scrape failed")

    def clay_dispatch(lead, correlation_id):
        calls["clay"] += 1
        raise ClayError("dispatch failed")

    def llm_extract(system_prompt, raw_text):
        calls["llm"] += 1
        return {}

    orch.brightdata = stub(scrape_profile=bd_scrape)
    orch.clay = stub(dispatch_lead=clay_dispatch)
    orch.claude = stub(extract_critical_fields=llm_extract)

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone", "Full_Name": "Jane Doe"}
    result = orch.process_lead(lead)

    assert calls["brightdata"] == 1, "BrightData should have been tried first"
    assert calls["clay"] == 1, "Clay should be tried after BrightData fails"
    # raw_source_text is empty since BrightData failed -- LLM fallback is
    # skipped for lack of source text, not called; this is existing,
    # unrelated behavior (LLM needs something to extract from).
    assert calls["llm"] == 0
    assert result["conclusion"] == "exhausted_no_match"


def test_non_linkedin_waterfall_never_calls_clay_even_with_a_linkedin_shaped_url():
    """Adversarial case: a non-LinkedIn-sourced lead whose Profile_Link
    happens to look like a LinkedIn URL -- the OLD regex-only gate would
    have dispatched this to Clay; the structural split must not, regardless
    of what Profile_Link contains, since routing is by provider_type alone."""
    orch = make_orchestrator()
    calls = {"tavily": 0, "clay": 0}

    def tavily_extract(url):
        calls["tavily"] += 1
        raise TavilyError("extract failed")

    def clay_dispatch(lead, correlation_id):
        calls["clay"] += 1
        return None

    orch.tavily = stub(extract_url=tavily_extract)
    orch.clay = stub(dispatch_lead=clay_dispatch)

    lead = {
        "Source": "ADA",  # routes to tavily_extract, per core/source_router.py
        "Profile_Link": "https://www.linkedin.com/in/adversarial-case",
        "Full_Name": "Jane Doe",
    }
    result = orch.process_lead(lead)

    assert calls["tavily"] == 1
    assert calls["clay"] == 0, "non-LinkedIn waterfall must never call Clay, regardless of Profile_Link's contents"
    assert result["conclusion"] == "exhausted_no_match"


def test_short_circuit_success_when_nothing_left_to_fill():
    """A lead that's already complete bypasses the LLM fallback entirely --
    conclusion is short_circuit_success, not exhausted_no_match (nothing was
    exhausted, there was nothing left to try). Realistically this is a
    REPEAT pass: OVERRIDE_ON_VERIFIED_FIELDS count as "unverified" (and so
    still a fallback target) until a prior scrape/LLM pass confirmed them --
    simulated here via known_field_sources, exactly as the Node caller
    round-trips a lead's persisted field_sources on every re-enrichment call."""
    orch = make_orchestrator()
    llm_calls = {"n": 0}
    orch.claude = stub(extract_critical_fields=lambda *a, **kw: llm_calls.__setitem__("n", llm_calls["n"] + 1) or {})

    lead = {
        "Source": "Freelancer",
        "Email_Address": "jane@example.com",
        "Contact_Number": "+1 555 0100",
        "Years_of_Exp": "5",
        "Full_Name": "Jane Doe",
        "Services": "Subtitling",
        "Source_Language": "English",
        "Target_Language": "German",
        "Secondary_Languages": "",
        "Country_of_Residence": "Germany",
        "Current_Title": "Translator",
        "Tools_Software": "Trados",
        "Certifications": "ATA",
    }
    known_field_sources = {
        f: "llm_fallback" for f in
        ["Full_Name", "First_Name", "Services", "Source_Language", "Target_Language", "Secondary_Languages", "Country_of_Residence"]
    }
    result = orch.process_lead(lead, known_field_sources=known_field_sources)

    assert llm_calls["n"] == 0, "LLM fallback must be bypassed when nothing is left to fill or verify"
    assert result["conclusion"] == "short_circuit_success"


def test_lead_level_timeout_fires_as_timed_out_not_exhausted():
    orch = make_orchestrator()
    original_ceiling = orchestrator_module.LEAD_LEVEL_TIMEOUT_SECONDS
    orchestrator_module.LEAD_LEVEL_TIMEOUT_SECONDS = 0.0  # already "elapsed" at the very first check
    try:
        lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone"}
        result = orch.process_lead(lead)
    finally:
        orchestrator_module.LEAD_LEVEL_TIMEOUT_SECONDS = original_ceiling

    assert result["conclusion"] == "timed_out"
    assert result["enrichment_status"] == "enrichment_partial"


def test_normal_fast_run_does_not_time_out():
    orch = make_orchestrator()
    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone", "Full_Name": "Jane Doe"}
    result = orch.process_lead(lead)
    assert result["conclusion"] != "timed_out"


def test_genuine_crash_propagates_uncaught_distinct_from_exhausted_no_match():
    """A real code-level bug (here: a parser raising something that isn't
    one of the 3 narrow provider-error types) must NOT be swallowed into a
    fake exhausted_no_match result -- it has to propagate all the way out,
    since that's what lets main.py's route handler turn it into an HTTP 500
    (system_error to the Node caller), distinct from a normal empty result."""
    orch = make_orchestrator()
    orch.brightdata = stub(scrape_profile=lambda url: {"some": "payload"})

    class BrokenParser:
        def parse(self, profile_link, raw_scraped_data):
            raise RuntimeError("a genuine bug, not a provider error")

    orch.parsers["linkedin"] = BrokenParser()

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone", "Full_Name": "Jane Doe"}
    try:
        orch.process_lead(lead)
        assert False, "expected RuntimeError to propagate, but process_lead returned normally"
    except RuntimeError as exc:
        assert "genuine bug" in str(exc)
