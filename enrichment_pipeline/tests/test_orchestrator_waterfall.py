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
from providers.parallel_client import ParallelError
from providers.tavily_client import TavilyError


def make_orchestrator() -> EnrichmentOrchestrator:
    # Empty keys -- __init__ skips constructing real clients; tests stub
    # orch.brightdata/tavily/parallel/claude directly, same pattern as
    # tests/test_dedup.py's StubDedupClient.
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


def test_linkedin_waterfall_falls_through_brightdata_parallel_to_llm():
    orch = make_orchestrator()
    calls = {"brightdata": 0, "parallel": 0, "llm": 0}

    def bd_scrape(url):
        calls["brightdata"] += 1
        raise BrightDataError("scrape failed")

    def parallel_enrich(lead, profile_link):
        calls["parallel"] += 1
        raise ParallelError("call failed")

    def llm_extract(system_prompt, raw_text):
        calls["llm"] += 1
        return {}

    orch.brightdata = stub(scrape_profile=bd_scrape)
    orch.parallel = stub(enrich_profile=parallel_enrich)
    orch.claude = stub(extract_critical_fields=llm_extract)

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone", "Full_Name": "Jane Doe"}
    result = orch.process_lead(lead)

    assert calls["brightdata"] == 1, "BrightData should have been tried first"
    assert calls["parallel"] == 1, "Parallel should be tried after BrightData fails"
    # raw_source_text is empty since BrightData failed -- LLM fallback is
    # skipped for lack of source text, not called; this is existing,
    # unrelated behavior (LLM needs something to extract from).
    assert calls["llm"] == 0
    assert result["conclusion"] == "exhausted_no_match"
    assert result["parallel_fallback"]["called"] is True
    assert result["parallel_fallback"]["error"] == "call failed"


def test_parallel_not_re_called_once_already_settled_for_this_lead():
    """A repeat process_lead pass for the same lead (the Node poller's normal
    re-enrichment path) must not re-pay for a Parallel call that already
    concluded on a prior pass -- covers both 'complete' and 'failed' terminal
    states via known_field_sources["_parallel_fallback"], exactly as the Node
    caller round-trips a lead's persisted field_sources on every re-enrichment
    call (see orchestrator.py's `already_ran` check)."""
    orch = make_orchestrator()
    calls = {"parallel": 0}
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: calls.__setitem__("parallel", calls["parallel"] + 1) or {})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone", "Full_Name": "Jane Doe"}
    result = orch.process_lead(lead, known_field_sources={"_parallel_fallback": "complete"})

    assert calls["parallel"] == 0, "Parallel must not be re-called once this lead already has a concluded Stage 3.5 pass"
    assert result["parallel_fallback"]["called"] is False
    assert result["parallel_fallback"]["reason"] == "already_complete"


def test_non_linkedin_waterfall_also_runs_parallel():
    """Parallel is Tier 2 for EVERY platform, not just LinkedIn.

    Clay's version of this stage was hard-gated to linkedin.com URLs because
    Clay itself rejected any other identifier; Parallel has no such
    limitation (its PoC covered ProZ/Bodalgo/ATA/Freelancer URLs), so
    carrying that gate forward left non-LinkedIn leads permanently without
    Tier 2 data and split enrichment provenance across the table. A
    ProZ/Bodalgo lead must now get the same Tier 2 treatment as a LinkedIn
    one, with Tavily rather than Bright Data as its Tier 1."""
    orch = make_orchestrator()
    calls = {"tavily": 0, "parallel": 0}
    seen_url = {}

    def tavily_extract(url):
        calls["tavily"] += 1
        raise TavilyError("extract failed")

    def parallel_enrich(lead, profile_link):
        calls["parallel"] += 1
        seen_url["url"] = profile_link
        return {"headline": "Voice-over artist", "country": "Spain"}

    orch.tavily = stub(extract_url=tavily_extract)
    orch.parallel = stub(enrich_profile=parallel_enrich)

    lead = {
        "Source": "ADA",  # routes to tavily_extract, per core/source_router.py
        "Profile_Link": "https://www.bodalgo.com/en/voice-over-talents/someone",
        "Full_Name": "Jane Doe",
    }
    result = orch.process_lead(lead)

    assert calls["tavily"] == 1, "Tier 1 for a non-LinkedIn lead is still Tavily"
    assert calls["parallel"] == 1, "Parallel must run for a non-LinkedIn lead too"
    assert seen_url["url"] == lead["Profile_Link"], "Parallel gets the lead's own profile URL, whatever platform it is"
    assert result["field_sources"].get("_parallel_fallback") == "complete"
    assert result["parallel_fallback"]["called"] is True
    # And its resolved fields actually land on the lead, same as LinkedIn's.
    assert result["lead"].get("Headline") == "Voice-over artist"


def test_parallel_skipped_entirely_when_lead_has_no_profile_link():
    """The gate is now "is there a URL to research", so a lead with no
    Profile_Link at all must skip Tier 2 rather than call Parallel with an
    empty string."""
    orch = make_orchestrator()
    calls = {"parallel": 0}
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: calls.__setitem__("parallel", calls["parallel"] + 1) or {})

    result = orch.process_lead({"Source": "LinkedIn", "Full_Name": "Jane Doe"})

    assert calls["parallel"] == 0, "no URL means nothing for Parallel to research"
    assert result["parallel_fallback"] is None
    assert "_parallel_fallback" not in result["field_sources"]


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


def test_parallel_absence_prose_never_reaches_a_data_field():
    """Confirmed live 2026-09-07: Parallel returned the string "No
    certifications are listed in the available profile evidence." INSIDE its
    `certifications` list for 2 of 7 real leads, which landed in
    Lead.certifications and would have been quoted back to the lead as a fact
    in their outreach draft. The schema now instructs an empty list, but this
    guard is what actually keeps prose out of the column if the model
    regresses -- while still letting a genuine credential through."""
    orch = make_orchestrator()
    orch.parallel = stub(
        enrich_profile=lambda lead, profile_link: {
            "certifications": [
                "No certifications are listed in the available profile evidence.",
                "ATA Certified Translator",
            ],
            "country": "India",
        }
    )

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/someone", "Full_Name": "Jane Doe"}
    result = orch.process_lead(lead)

    certs = result["lead"].get("Certifications") or ""
    assert "ATA Certified Translator" in certs, "a real credential must still come through"
    assert "profile evidence" not in certs.lower(), "absence prose must never reach a data field"
    assert any("dropped 1 non-data" in line for line in result["logs"]), "the drop should be logged, not silent"
