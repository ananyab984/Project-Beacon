"""Tests for EnrichmentOrchestrator's 7-stage waterfall (engine -> Clay -> LLM).

Every provider/LLM client class orchestrator.py imports (BrightDataClient,
TavilyClient, ClaudeClient, ClayClient) is patched at the orchestrator module
boundary -- never real network. Parsers are real objects with `.parse`
monkeypatched per test, since parser correctness itself is covered elsewhere.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

import pytest

from config import Config
from orchestrator import EnrichmentOrchestrator
from providers.brightdata_client import BrightDataError
from providers.tavily_client import TavilyError
from providers.clay_client import ClayError
from llm_fallback.client import ClaudeError


def make_config(**overrides):
    defaults = dict(
        brightdata_api_key="bd-key", dataset_id="ds1", tavily_api_key="tv-key",
        claude_api_key="cl-key", clay_webhook_url="https://clay.example/hook",
    )
    defaults.update(overrides)
    return Config(**defaults)


@pytest.fixture
def mocked_clients(mocker):
    """Patch the 4 client classes orchestrator.py imports; returns their instances."""
    bd_cls = mocker.patch("orchestrator.BrightDataClient")
    tv_cls = mocker.patch("orchestrator.TavilyClient")
    cl_cls = mocker.patch("orchestrator.ClaudeClient")
    clay_cls = mocker.patch("orchestrator.ClayClient")
    return {
        "brightdata": bd_cls.return_value,
        "tavily": tv_cls.return_value,
        "claude": cl_cls.return_value,
        "clay": clay_cls.return_value,
    }


def make_orchestrator(config=None):
    return EnrichmentOrchestrator(config or make_config())


# ---------------------------------------------------------------------------
# Stage order: engine (Bright Data/Tavily) before Clay before LLM.
#
# NOTE on actual behavior: Clay is dispatched asynchronously. The SAME
# process_lead() pass that dispatches Clay never also calls the LLM --
# `_clay_dispatch` = "pending" blocks Stage 4 until a LATER pass (once the
# webhook resolved it, via known_field_sources) sees a non-"pending" state.
# So a single pass shows either [engine -> clay-dispatch] or, once Clay is
# already resolved, [engine -> llm] -- never all three actively firing in
# one pass. Both are verified below since that's what the code actually does.
# ---------------------------------------------------------------------------

def test_first_pass_linkedin_lead_calls_brightdata_then_parser_then_clay_and_skips_llm(mocker, mocked_clients):
    o = make_orchestrator()
    order = []
    mocked_clients["brightdata"].scrape_profile.side_effect = lambda *a, **k: order.append("brightdata") or {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", side_effect=lambda *a, **k: order.append("parse") or {})
    mocked_clients["clay"].dispatch_lead.side_effect = lambda *a, **k: order.append("clay")

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe", "Full_Name": "Jane Doe"}
    result = o.process_lead(lead)

    assert order == ["brightdata", "parse", "clay"]
    mocked_clients["claude"].extract_critical_fields.assert_not_called()
    assert result["clay_fallback"] == {
        "dispatched": True, "correlation_id": lead["Profile_Link"], "reason": "linkedin_lead",
    }
    assert result["field_sources"]["_clay_dispatch"] == "pending"


def test_llm_fallback_runs_after_clay_already_resolved(mocker, mocked_clients):
    """Once a prior pass's Clay dispatch resolved (state != 'pending'), Stage 4
    is no longer blocked and the LLM fallback runs -- Clay is not re-dispatched."""
    o = make_orchestrator()
    order = []
    mocked_clients["brightdata"].scrape_profile.side_effect = lambda *a, **k: order.append("brightdata") or {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", side_effect=lambda *a, **k: order.append("parse") or {})
    mocked_clients["claude"].extract_critical_fields.side_effect = lambda *a, **k: order.append("claude") or {}
    mocker.patch("orchestrator.verify_against_source", return_value={})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe", "Full_Name": "Jane Doe"}
    known = {"_clay_dispatch": "complete"}
    result = o.process_lead(lead, known_field_sources=known)

    assert order == ["brightdata", "parse", "claude"]
    mocked_clients["clay"].dispatch_lead.assert_not_called()
    assert result["clay_fallback"] == {
        "dispatched": False, "correlation_id": lead["Profile_Link"], "reason": "already_complete",
    }


def test_clay_not_re_dispatched_when_already_pending_from_prior_pass(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    result = o.process_lead(lead, known_field_sources={"_clay_dispatch": "pending"})

    mocked_clients["clay"].dispatch_lead.assert_not_called()
    mocked_clients["claude"].extract_critical_fields.assert_not_called()
    assert result["clay_fallback"]["reason"] == "already_pending"
    assert any("still awaiting its async result" in l for l in result["logs"])


# ---------------------------------------------------------------------------
# Clay gating: only dispatched for a genuine LinkedIn/SalesNav identifier.
# ---------------------------------------------------------------------------

def test_clay_never_dispatched_for_non_linkedin_profile_link(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["tavily"].search_snippets.return_value = {"primary_snippet": None, "other_snippets": []}
    mocker.patch.object(o.parsers["proz"], "parse", return_value={})
    mocked_clients["claude"].extract_critical_fields.return_value = {}
    mocker.patch("orchestrator.verify_against_source", return_value={})

    lead = {"Source": "ProZ", "Profile_Link": "https://www.proz.com/profile/12345", "Full_Name": "A"}
    result = o.process_lead(lead)

    mocked_clients["clay"].dispatch_lead.assert_not_called()
    assert result["clay_fallback"] is None
    assert any("no LinkedIn URL" in l for l in result["logs"])


def test_clay_skipped_when_not_configured(mocker):
    """CLAY_WEBHOOK_URL unset -> self.clay is None -> Clay stage is a no-op, not an error."""
    mocker.patch("orchestrator.BrightDataClient")
    mocker.patch("orchestrator.TavilyClient")
    mocker.patch("orchestrator.ClaudeClient")
    mocker.patch("orchestrator.ClayClient")
    o = make_orchestrator(make_config(clay_webhook_url=""))
    assert o.clay is None
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={})
    o.brightdata.scrape_profile.return_value = {"raw": "x"}

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    result = o.process_lead(lead)

    assert result["clay_fallback"] is None
    assert any("CLAY_WEBHOOK_URL not configured" in l for l in result["logs"])


# ---------------------------------------------------------------------------
# Platform routing table -- confirmed directly from core/source_router.py's
# SOURCE_MAP: only linkedin/proz/ada/ata/ataa/bodalgo/freelancer are mapped
# to a specific provider+parser. There is NO "not automated" short-circuit
# (Upwork/Voices.com/AVU) and NO AVTEurope-specific N/A handling anywhere in
# orchestrator.py or core/source_router.py -- an unmapped Source string
# (Upwork, Voices.com, AVTEurope, or anything else) falls through to the
# SAME generic ("tavily_extract", "generic_llm") route as any custom source
# and goes through the full waterfall exactly like every other lead. These
# tests assert that REAL behavior, not the short-circuit the task brief
# assumed exists.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("source_name", ["Upwork", "Voices.com", "AVTEurope", "SomeRandomPlatform"])
def test_unmapped_platform_gets_no_special_case_and_still_hits_the_waterfall(mocker, mocked_clients, source_name):
    o = make_orchestrator()
    mocked_clients["tavily"].extract_url.return_value = {"url": "x", "raw_content": "some content", "tavily_raw": {}}
    mocker.patch.object(o.parsers["generic_llm"], "parse", return_value={})
    mocked_clients["claude"].extract_critical_fields.return_value = {}
    mocker.patch("orchestrator.verify_against_source", return_value={})

    lead = {"Source": source_name, "Profile_Link": "https://example.com/profile/x", "Full_Name": "A"}
    result = o.process_lead(lead)

    # Proves no short-circuit exists: the engine (Tavily Extract) really ran.
    mocked_clients["tavily"].extract_url.assert_called_once_with(lead["Profile_Link"])
    assert "manual" not in result["enrichment_status"]
    assert "N/A" not in result["enrichment_status"]
    assert set(result.keys()) == {
        "lead", "enrichment_status", "enrichment_percentage", "field_sources",
        "audit", "execution_time_ms", "logs", "clay_fallback", "raw_enrichment_data",
    }


def test_avteurope_lead_completes_without_crashing_and_without_clay(mocker, mocked_clients):
    """AVTEurope has no mapping entry -> routes like any custom source; confirmed
    NOT an error path (no exception, normal PipelineResult), but also NOT the
    literal 'N/A' status the task brief assumed -- that field/state doesn't exist."""
    o = make_orchestrator()
    mocked_clients["tavily"].extract_url.return_value = {"url": "x", "raw_content": "", "tavily_raw": {}}
    mocker.patch.object(o.parsers["generic_llm"], "parse", return_value={})

    lead = {"Source": "AVTEurope", "Profile_Link": "https://avteurope.example/profile/x"}
    result = o.process_lead(lead)

    assert result["enrichment_status"] in ("enrichment_partial", "enrichment_complete")
    mocked_clients["clay"].dispatch_lead.assert_not_called()


# ---------------------------------------------------------------------------
# Early-complete-profile path: nothing left to fill or verify bypasses the
# LLM stage entirely (Stage 4 Bypass Guard).
# ---------------------------------------------------------------------------

def test_bypass_guard_skips_llm_when_nothing_left_to_fill_or_verify(mocker, mocked_clients):
    o = make_orchestrator()
    lead = {
        "Full_Name": "Complete Person", "First_Name": "Complete",
        "Country_of_Residence": "USA", "Source": "CustomSource",
        "Email_Address": "x@example.com", "Contact_Number": "+1-555-0100",
        "Services": "Translation", "Source_Language": "English", "Target_Language": "French",
        "Secondary_Languages": "German", "Years_of_Exp": 5, "Vendor_Experience": "Yes",
        "Current_Title": "Translator", "Tools_Software": "SDL Trados", "Certifications": "ATA",
        # no Profile_Link -> Stage 3 never runs, so field_sources below are what govern everything
    }
    known = {f: "brightdata" for f in (
        "Full_Name", "First_Name", "Services", "Source_Language",
        "Target_Language", "Secondary_Languages", "Country_of_Residence",
    )}
    result = o.process_lead(lead, known_field_sources=known)

    mocked_clients["claude"].extract_critical_fields.assert_not_called()
    assert any("BYPASSING LLM FALLBACK ENTIRELY" in l for l in result["logs"])
    assert result["enrichment_status"] == "enrichment_complete"


def test_known_field_sources_excludes_already_verified_field_from_llm_targets(mocker, mocked_clients):
    o = make_orchestrator()
    captured = {}
    mocker.patch("orchestrator.build_targeted_prompt", side_effect=lambda targets: captured.setdefault("targets", targets) or "prompt")
    mocked_clients["tavily"].extract_url.return_value = {"url": "x", "raw_content": "some content here", "tavily_raw": {}}
    mocker.patch.object(o.parsers["generic_llm"], "parse", return_value={})
    mocked_clients["claude"].extract_critical_fields.return_value = {}
    mocker.patch("orchestrator.verify_against_source", return_value={})

    lead = {"Source": "CustomSource", "Profile_Link": "https://example.com/x", "Full_Name": "Jane"}
    result = o.process_lead(lead, known_field_sources={"Full_Name": "llm_fallback"})

    assert "Full_Name" not in captured["targets"], "already-verified field must not be re-sent to the LLM"


# ---------------------------------------------------------------------------
# Error handling per step -- caught, logged, pipeline continues.
# ---------------------------------------------------------------------------

def test_brightdata_error_is_caught_logged_and_pipeline_continues(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.side_effect = BrightDataError("boom", status_code=500)
    parse_mock = mocker.patch.object(o.parsers["linkedin"], "parse")

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    result = o.process_lead(lead)

    parse_mock.assert_not_called()
    assert result["raw_enrichment_data"] is None
    assert any("Scraping warning (brightdata): boom" in l for l in result["logs"])
    assert result["enrichment_status"] == "enrichment_partial"


def test_tavily_extract_error_is_caught_logged_and_pipeline_continues(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["tavily"].extract_url.side_effect = TavilyError("tavily down")

    lead = {"Source": "AdA", "Profile_Link": "https://ada.example/profile/x"}
    result = o.process_lead(lead)

    assert result["raw_enrichment_data"] is None
    assert any("Scraping warning (tavily_extract): tavily down" in l for l in result["logs"])


def test_clay_error_is_caught_logged_and_leaves_clay_fallback_none(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={})
    mocked_clients["clay"].dispatch_lead.side_effect = ClayError("clay down")

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    result = o.process_lead(lead)

    assert result["clay_fallback"] is None, "a failed dispatch must not be reported as a successful one"
    assert "_clay_dispatch" not in result["field_sources"]
    assert any("Clay dispatch failed: clay down" in l for l in result["logs"])


def test_claude_error_is_caught_logged_and_fields_stay_unfilled(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["tavily"].search_snippets.return_value = {"primary_snippet": "x", "other_snippets": [], "tavily_raw": {}}
    mocker.patch.object(o.parsers["proz"], "parse", return_value={})
    mocked_clients["claude"].extract_critical_fields.side_effect = ClaudeError("model unavailable")

    lead = {"Source": "ProZ", "Profile_Link": "https://www.proz.com/profile/1", "Full_Name": "A"}
    result = o.process_lead(lead)

    assert result["lead"].get("Email_Address") is None
    assert any("LLM Fallback error: model unavailable" in l for l in result["logs"])


def test_stage6_verified_llm_fills_missing_fields_and_overrides_manual_entry(mocker, mocked_clients):
    """Stage 6: a verified LLM extraction fills a fill-only field (Current_Title)
    and overrides a differing OVERRIDE_ON_VERIFIED_FIELDS value (Services)."""
    o = make_orchestrator()
    mocked_clients["tavily"].search_snippets.return_value = {"primary_snippet": "some text", "other_snippets": [], "tavily_raw": {}}
    mocker.patch.object(o.parsers["proz"], "parse", return_value={})
    mocked_clients["claude"].extract_critical_fields.return_value = {"raw": "output"}
    mocker.patch("orchestrator.verify_against_source", return_value={
        "Current_Title": "Senior Translator", "Services": "Translation, Editing",
    })

    lead = {
        "Source": "ProZ", "Profile_Link": "https://www.proz.com/profile/1",
        "Full_Name": "A", "Services": "Translation",
    }
    result = o.process_lead(lead)

    assert result["lead"]["Current_Title"] == "Senior Translator"
    assert result["field_sources"]["Current_Title"] == "llm_fallback"
    assert result["lead"]["Services"] == "Translation, Editing"
    assert result["field_sources"]["Services"] == "llm_fallback"
    assert any("verified profile overrides manual entry" in l for l in result["logs"])
    assert any("Stage 6 Verified LLM: Current_Title" in l for l in result["logs"])


def test_stage6_verified_llm_matching_value_marks_source_without_rewrite(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["tavily"].search_snippets.return_value = {"primary_snippet": "some text", "other_snippets": [], "tavily_raw": {}}
    mocker.patch.object(o.parsers["proz"], "parse", return_value={})
    mocked_clients["claude"].extract_critical_fields.return_value = {"raw": "output"}
    mocker.patch("orchestrator.verify_against_source", return_value={"Services": "Translation"})

    lead = {
        "Source": "ProZ", "Profile_Link": "https://www.proz.com/profile/1",
        "Full_Name": "A", "Services": "Translation",
    }
    result = o.process_lead(lead)

    assert result["lead"]["Services"] == "Translation"
    assert result["field_sources"]["Services"] == "llm_fallback"
    assert any("confirmed matches manual entry" in l for l in result["logs"])


def test_llm_skipped_when_claude_not_configured(mocker):
    mocker.patch("orchestrator.BrightDataClient")
    mocker.patch("orchestrator.TavilyClient")
    mocker.patch("orchestrator.ClaudeClient")
    mocker.patch("orchestrator.ClayClient")
    o = make_orchestrator(make_config(claude_api_key=""))
    assert o.claude is None
    o.tavily.search_snippets.return_value = {"primary_snippet": None, "other_snippets": [], "tavily_raw": {}}
    mocker.patch.object(o.parsers["proz"], "parse", return_value={})

    lead = {"Source": "ProZ", "Profile_Link": "https://www.proz.com/profile/1", "Full_Name": "A"}
    result = o.process_lead(lead)

    assert any("CLAUDE_API_KEY not configured" in l for l in result["logs"])


def test_llm_skipped_when_no_raw_source_text(mocker, mocked_clients):
    """No Profile_Link at all -> Stage 3 never runs -> raw_source_text stays empty
    -> even with missing critical fields, the LLM stage is skipped for lack of source text."""
    o = make_orchestrator()
    lead = {"Full_Name": "No Link Person", "Source": "LinkedIn"}
    result = o.process_lead(lead)

    mocked_clients["claude"].extract_critical_fields.assert_not_called()
    assert any("No raw scraped text available" in l for l in result["logs"])


# ---------------------------------------------------------------------------
# Stage 3 merge rules.
# ---------------------------------------------------------------------------

def test_override_field_overwritten_when_scraped_value_differs_from_manual_entry(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={"Full_Name": "Jane A. Doe"})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe", "Full_Name": "Jane Doe"}
    result = o.process_lead(lead)

    assert result["lead"]["Full_Name"] == "Jane A. Doe"
    assert result["field_sources"]["Full_Name"] == "brightdata"
    assert any("verified profile overrides manual entry" in l for l in result["logs"])


def test_override_field_marked_verified_without_rewrite_when_values_match(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={"Full_Name": "Jane Doe"})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe", "Full_Name": "Jane Doe"}
    result = o.process_lead(lead)

    assert result["lead"]["Full_Name"] == "Jane Doe"
    assert result["field_sources"]["Full_Name"] == "brightdata"
    assert any("confirmed matches manual entry" in l for l in result["logs"])


def test_non_override_field_never_overwrites_existing_manual_value(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={"Headline": "Scraped Headline"})

    lead = {
        "Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe",
        "Headline": "Manual Headline",
    }
    result = o.process_lead(lead)

    assert result["lead"]["Headline"] == "Manual Headline"


def test_stage3_parsed_empty_field_value_is_skipped(mocker, mocked_clients):
    """A parser can return a field with an empty value (e.g. nothing found) --
    that must be a no-op, not overwrite anything or record a source."""
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={"Headline": "", "Full_Name": "Jane Doe"})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe", "Full_Name": "Jane Doe"}
    result = o.process_lead(lead)

    assert "Headline" not in result["field_sources"]
    assert result["lead"].get("Headline") is None


def test_non_override_field_fills_when_empty(mocker, mocked_clients):
    o = make_orchestrator()
    mocked_clients["brightdata"].scrape_profile.return_value = {"raw": "x"}
    mocker.patch.object(o.parsers["linkedin"], "parse", return_value={"Headline": "Scraped Headline"})

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    result = o.process_lead(lead)

    assert result["lead"]["Headline"] == "Scraped Headline"
    assert result["field_sources"]["Headline"] == "brightdata"


# ---------------------------------------------------------------------------
# Result contract / scoring.
# ---------------------------------------------------------------------------

def test_result_reports_execution_time_and_existing_field_sources(mocker, mocked_clients):
    o = make_orchestrator()
    lead = {"Full_Name": "Someone", "Source": "LinkedIn"}
    result = o.process_lead(lead)

    assert isinstance(result["execution_time_ms"], int)
    assert result["execution_time_ms"] >= 0
    assert result["field_sources"]["Full_Name"] == "existing"


def test_status_is_partial_when_critical_fields_missing():
    o = make_orchestrator(make_config(
        brightdata_api_key="", tavily_api_key="", claude_api_key="", clay_webhook_url="",
    ))
    result = o.process_lead({"Full_Name": "Someone"})
    assert result["enrichment_status"] == "enrichment_partial"
    assert result["audit"]["is_complete"] is False


def test_status_is_complete_when_critical_fields_present():
    o = make_orchestrator(make_config(
        brightdata_api_key="", tavily_api_key="", claude_api_key="", clay_webhook_url="",
    ))
    lead = {
        "Full_Name": "Someone", "Email_Address": "x@example.com",
        "Contact_Number": "+1-555-0000", "Years_of_Exp": 3,
    }
    result = o.process_lead(lead)
    assert result["audit"]["is_complete"] is True


def test_no_clients_configured_is_fully_inert_no_crash():
    """All keys unset -> every client is None -> pipeline still runs to completion
    (nothing scraped, nothing dispatched, nothing LLM-verified)."""
    cfg = make_config(brightdata_api_key="", tavily_api_key="", claude_api_key="", clay_webhook_url="")
    o = EnrichmentOrchestrator(cfg)
    assert o.brightdata is None and o.tavily is None and o.claude is None and o.clay is None

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    result = o.process_lead(lead)
    assert result["raw_enrichment_data"] is None
    assert result["clay_fallback"] is None
