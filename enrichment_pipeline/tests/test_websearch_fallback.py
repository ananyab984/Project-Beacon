"""Tests for Tier 3's Claude web-search fallback: the grounding filter
(filter_web_search_result), the trigger metric (count_enriched_fields), and
the orchestrator wiring (threshold gate + retry-cap policy + the Martin
Godart end-to-end regression this whole feature was built for).

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_websearch_fallback.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.enrichment_count import count_enriched_fields
from llm_fallback.client import ClaudeError
from llm_fallback.verifier import filter_web_search_result
from providers.brightdata_client import BrightDataError
from providers.parallel_client import ParallelError

import orchestrator as orchestrator_module
from config import Config
from orchestrator import EnrichmentOrchestrator


def make_orchestrator() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


# --- filter_web_search_result -------------------------------------------

def test_accepts_a_well_formed_result_with_real_sources():
    result = {
        "Headline": "Senior Voice Artist",
        "Current_Title": None,
        "sources_used": ["https://example.com/profile"],
        "could_not_find_anything": False,
    }
    verified = filter_web_search_result(result, ["Headline", "Current_Title"])
    assert verified == {"Headline": "Senior Voice Artist"}


def test_rejects_could_not_find_anything():
    result = {"Headline": "should never surface", "sources_used": ["https://x.com"], "could_not_find_anything": True}
    assert filter_web_search_result(result, ["Headline"]) == {}


def test_rejects_a_result_with_no_sources_used():
    result = {"Headline": "unsourced claim", "sources_used": [], "could_not_find_anything": False}
    assert filter_web_search_result(result, ["Headline"]) == {}

    result_missing_key = {"Headline": "unsourced claim", "could_not_find_anything": False}
    assert filter_web_search_result(result_missing_key, ["Headline"]) == {}


def test_strips_contact_fields_even_if_the_model_returns_them():
    """The one hardening the abandoned branch's version didn't need: it
    never targeted contact fields, so this filter must strip them itself
    rather than trust the caller never asked for them."""
    result = {
        "Headline": "Senior Voice Artist",
        "Email_Address": "someone@example.com",
        "Contact_Number": "+1 555 0100",
        "sources_used": ["https://example.com/profile"],
        "could_not_find_anything": False,
    }
    verified = filter_web_search_result(result, ["Headline", "Email_Address", "Contact_Number"])
    assert verified == {"Headline": "Senior Voice Artist"}
    assert "Email_Address" not in verified
    assert "Contact_Number" not in verified


# --- count_enriched_fields ------------------------------------------------

def test_import_time_fields_are_not_counted():
    """Profile_Link/Source_Language/Target_Language are set at lead creation
    on nearly every row -- counting them would show enrichment for a lead
    the waterfall found nothing for."""
    lead = {"Profile_Link": "https://x.com/in/y", "Source_Language": "English", "Target_Language": "German"}
    field_sources = {"Profile_Link": "existing", "Source_Language": "existing", "Target_Language": "existing"}
    assert count_enriched_fields(lead, field_sources) == 0


def test_enriched_fields_with_a_real_source_are_counted():
    lead = {"Headline": "Voice Artist", "Country_of_Residence": "Spain"}
    field_sources = {"Headline": "parallel", "Country_of_Residence": "brightdata"}
    assert count_enriched_fields(lead, field_sources) == 2


def test_a_field_with_no_recorded_source_is_not_counted():
    """Populated but never attributed to any provider -- same as 'existing'."""
    lead = {"Headline": "Voice Artist"}
    assert count_enriched_fields(lead, {}) == 0


def test_fields_outside_the_dialogs_ten_are_not_counted():
    lead = {"Years_of_Exp": 5, "Tools_Software": "Trados"}
    field_sources = {"Years_of_Exp": "llm_fallback", "Tools_Software": "llm_fallback"}
    assert count_enriched_fields(lead, field_sources) == 0


# --- Orchestrator: threshold gate ----------------------------------------

def _thin_lead():
    return {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/martin-godart", "Full_Name": "Martin Godart"}


def _rich_lead():
    return {
        "Source": "LinkedIn",
        "Profile_Link": "https://www.linkedin.com/in/someone",
        "Full_Name": "Jane Doe",
        "Email_Address": "jane@example.com",
        "Contact_Number": "+1 555 0100",
        "Country_of_Residence": "Germany",
        "Source_Language": "English",
        "Target_Language": "German",
        "Services": "Subtitling",
        "Headline": "Senior Translator",
        "Current_Title": "Freelance Translator",
        "About_Snippet": "10 years of experience in AV translation.",
    }


def test_thin_lead_triggers_websearch_after_both_tiers_come_up_empty():
    calls = {"websearch": 0}
    orch = make_orchestrator()
    orch.brightdata = stub(scrape_profile=lambda url: (_ for _ in ()).throw(BrightDataError("blocked")))
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: (_ for _ in ()).throw(ParallelError("blocked")))
    orch.claude = stub(
        search_missing_fields=lambda *a, **kw: calls.__setitem__("websearch", calls["websearch"] + 1)
        or {"Headline": "Voice Artist", "sources_used": ["https://x.com"], "could_not_find_anything": False}
    )

    result = orch.process_lead(_thin_lead())

    assert calls["websearch"] == 1, "a lead with almost nothing enriched must fall through to Stage 6"
    assert result["websearch_fallback"]["called"] is True
    assert result["lead"]["Headline"] == "Voice Artist"
    assert result["field_sources"]["Headline"] == "llm_fallback"
    assert result["field_sources"]["_websearch_fallback"] == "complete"


def test_rich_lead_skips_websearch_entirely():
    """A lead already at or above the ENRICHMENT_COUNT threshold must not
    pay for the most expensive tier -- confirms the cost-control gate
    actually gates, using leads shaped like this session's already-enriched
    ones (e.g. Nicole Boschetti, Alex Anthraper)."""
    calls = {"websearch": 0}
    orch = make_orchestrator()
    field_sources = {
        f: "brightdata"
        for f in ["Country_of_Residence", "Source_Language", "Target_Language", "Services", "Headline", "Current_Title", "About_Snippet"]
    }
    orch.claude = stub(search_missing_fields=lambda *a, **kw: calls.__setitem__("websearch", calls["websearch"] + 1) or {})

    result = orch.process_lead(_rich_lead(), known_field_sources=field_sources)

    assert calls["websearch"] == 0, "an already-enriched lead must not trigger Stage 6"
    assert result["websearch_fallback"] is None


def test_only_contact_fields_missing_also_skips_websearch():
    """Nothing left web search is allowed to try -- it must not be called
    just to chase Email_Address/Contact_Number."""
    calls = {"websearch": 0}
    orch = make_orchestrator()
    lead = _rich_lead()
    del lead["Email_Address"]
    del lead["Contact_Number"]
    field_sources = {
        f: "brightdata"
        for f in ["Country_of_Residence", "Source_Language", "Target_Language", "Services", "Headline", "Current_Title", "About_Snippet"]
    }
    orch.claude = stub(search_missing_fields=lambda *a, **kw: calls.__setitem__("websearch", calls["websearch"] + 1) or {})

    result = orch.process_lead(lead, known_field_sources=field_sources)

    assert calls["websearch"] == 0
    assert result["websearch_fallback"] is None


# --- Orchestrator: re-attempt policy (mirrors the 4 Parallel tests) ------

def test_websearch_empty_result_is_retried_then_capped_at_two_attempts():
    calls = {"n": 0}
    orch = make_orchestrator()
    orch.claude = stub(
        search_missing_fields=lambda *a, **kw: calls.__setitem__("n", calls["n"] + 1)
        or {"could_not_find_anything": True, "sources_used": []}
    )

    r1 = orch.process_lead(_thin_lead())
    assert calls["n"] == 1
    assert r1["field_sources"]["_websearch_fallback"] == "failed_transient:1"

    r2 = orch.process_lead(_thin_lead(), known_field_sources=r1["field_sources"])
    assert calls["n"] == 2, "an empty web-search result must be retried on a later pass"
    assert r2["field_sources"]["_websearch_fallback"] == "failed_transient:2"

    r3 = orch.process_lead(_thin_lead(), known_field_sources=r2["field_sources"])
    assert calls["n"] == 2, "capped at 2 attempts"
    assert r3["websearch_fallback"]["called"] is False


def test_websearch_transient_exception_is_retried_then_capped():
    calls = {"n": 0}
    orch = make_orchestrator()

    def fail(*a, **kw):
        calls["n"] += 1
        raise ClaudeError("timed out after retries")

    orch.claude = stub(search_missing_fields=fail)

    r1 = orch.process_lead(_thin_lead())
    assert r1["field_sources"]["_websearch_fallback"] == "failed_transient:1"
    r2 = orch.process_lead(_thin_lead(), known_field_sources=r1["field_sources"])
    assert calls["n"] == 2
    assert r2["field_sources"]["_websearch_fallback"] == "failed_transient:2"
    r3 = orch.process_lead(_thin_lead(), known_field_sources=r2["field_sources"])
    assert calls["n"] == 2, "capped at 2 attempts even for repeated transient failures"
    assert r3["websearch_fallback"]["called"] is False


def test_websearch_permanent_rejection_is_never_retried():
    calls = {"n": 0}
    orch = make_orchestrator()

    def fail(*a, **kw):
        calls["n"] += 1
        raise ClaudeError("HTTP 400: bad request", permanent=True)

    orch.claude = stub(search_missing_fields=fail)

    r1 = orch.process_lead(_thin_lead())
    assert calls["n"] == 1
    assert r1["field_sources"]["_websearch_fallback"] == "failed_permanent"

    r2 = orch.process_lead(_thin_lead(), known_field_sources=r1["field_sources"])
    assert calls["n"] == 1, "a permanent rejection must never be retried"
    assert r2["websearch_fallback"]["called"] is False


def test_websearch_success_is_never_re_called():
    calls = {"n": 0}
    orch = make_orchestrator()
    orch.claude = stub(
        search_missing_fields=lambda *a, **kw: calls.__setitem__("n", calls["n"] + 1)
        or {"Headline": "Subtitler", "sources_used": ["https://x.com"], "could_not_find_anything": False}
    )

    r1 = orch.process_lead(_thin_lead())
    assert r1["field_sources"]["_websearch_fallback"] == "complete"
    orch.process_lead(_thin_lead(), known_field_sources=r1["field_sources"])
    assert calls["n"] == 1, "a resolved lead must never be re-billed"


# --- End-to-end: the Martin Godart regression this feature was built for --

def test_martin_godart_shaped_lead_reaches_stage_6_websearch():
    """Bright Data returns only bookkeeping keys (Part 0's content-free
    detection), Parallel returns an all-null LeadProfile (Part 0's
    empty-result retry) -- both exhaust their 2-attempt transient budget
    over repeated passes, and Stage 6 web search must still be reachable
    as the backstop, rather than short-circuiting on empty raw_source_text
    the way the old extraction-based Tier 3 would have."""
    orch = make_orchestrator()
    orch.brightdata = stub(scrape_profile=lambda url: [{"input": {"url": url}, "timestamp": "2026-09-07T00:00:00Z"}])

    empty_profile = {
        "headline": None, "current_title": None, "about_snippet": None, "country": None,
        "experience": [], "education": [], "languages": [], "certifications": [],
    }
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: dict(empty_profile))

    websearch_calls = {"n": 0}
    orch.claude = stub(
        search_missing_fields=lambda *a, **kw: websearch_calls.__setitem__("n", websearch_calls["n"] + 1)
        or {
            "Headline": "Senior Localization Engineer",
            "Country_of_Residence": "France",
            "sources_used": ["https://www.google.com/search?q=Martin+Godart+localization"],
            "could_not_find_anything": False,
        }
    )

    lead = {"Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/martin-godart", "Full_Name": "Martin Godart"}

    # Stage 6 fires in the SAME pass as Parallel's first (empty, transient)
    # attempt -- it isn't gated on Parallel's own retry budget being
    # exhausted, only on the lead still being thin overall. This is the
    # actual regression test for the reported bug: the old extraction-based
    # Tier 3 would have short-circuited here on empty raw_source_text (Bright
    # Data returned nothing to extract from), leaving every field "Not
    # found" forever.
    r1 = orch.process_lead(lead)

    assert r1["field_sources"]["_parallel_fallback"] == "failed_transient:1", (
        "Parallel's empty result must be treated as a retryable transient failure (Part 0), not settled as complete"
    )
    assert websearch_calls["n"] == 1, "Stage 6 web search must fire for a lead this thin, in the very first pass"
    assert r1["websearch_fallback"] is not None
    assert r1["websearch_fallback"]["called"] is True
    assert r1["lead"]["Headline"] == "Senior Localization Engineer"
    assert r1["lead"]["Country_of_Residence"] == "France"
    assert "Email_Address" not in (r1["websearch_fallback"].get("data") or {})

    # A second pass (the poller re-visiting this lead) must not re-bill
    # either provider now that both have concluded -- Stage 6 already
    # resolved, and Parallel would still have one transient attempt left,
    # but nothing in this lead's shape asks it to run again inside the
    # SAME process_lead call regardless.
    r2 = orch.process_lead(dict(lead), known_field_sources=r1["field_sources"])
    assert websearch_calls["n"] == 1, "a resolved Stage 6 lead must never be re-billed"
    assert r2["websearch_fallback"]["called"] is False
    assert r2["field_sources"]["_websearch_fallback"] == "complete"


# --- the stage's own time budget ----------------------------------------
#
# Stage 6 fires ONLY for leads every earlier tier came up thin on, so all of
# its latency lands on the rows a recruiter is already watching and calling
# stuck. Measured live 2026-09-08 on two real such leads (Martin Godart,
# Omaima Atef -- both LinkedIn profiles blocked to Bright Data AND to
# Parallel's browsing agent): 8 search rounds hit the 240s request timeout
# both times, then a retry that could never fit the remaining deadline burned
# another 60s. ~5 minutes per lead, zero results, 0 successes ever recorded.
#
# The two knobs were picked independently of the timeout, which is how the
# arithmetic came to not work. These pin the relationship, not the numbers.

def _websearch_call_args():
    """Captures the request body and RetryPolicy search_missing_fields builds,
    without making a call."""
    from llm_fallback.client import ClaudeClient

    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="k", groq_api_key="")
    client = ClaudeClient(cfg)
    captured = {}

    def fake_retry(fn, *, policy, on_retry=None, on_exhausted=None, executor=None):
        captured["policy"] = policy
        # fn closes over the body and timeout; run it against a stub request.
        captured["result"] = fn()
        return captured["result"]

    def fake_request_once(body, timeout=None):
        captured["body"] = body
        captured["timeout"] = timeout
        return {"sources_used": [], "could_not_find_anything": True}

    import llm_fallback.client as client_module

    real_retry, real_request = client_module.retry_with_backoff, client._request_once
    client_module.retry_with_backoff = fake_retry
    client._request_once = fake_request_once
    try:
        client.search_missing_fields(["Headline"], "Someone", "https://example.com/x", "brightdata")
    finally:
        client_module.retry_with_backoff = real_retry
        client._request_once = real_request
    return captured


def test_every_allowed_attempt_fits_inside_the_deadline():
    """The defect this pins: retries=1 with a 240s per-request timeout under a
    300s deadline. Attempt one consumes 240s, retry_with_backoff then STARTS
    attempt two with 60s left and the deadline kills it mid-flight -- 60s
    spent on a call that could not have finished. A retry that cannot
    complete is not a retry, it is latency."""
    c = _websearch_call_args()
    attempts = c["policy"].retries + 1
    budget = c["policy"].deadline_seconds
    per_attempt = c["timeout"]
    assert attempts * per_attempt <= budget, (
        f"{attempts} attempts x {per_attempt}s per attempt exceeds the {budget}s deadline -- "
        f"the last attempt gets started and then killed mid-flight"
    )


def test_search_rounds_can_finish_inside_the_request_timeout():
    """8 rounds timed out on every real call. Budget ~40s per round (the
    observed rate: 240s elapsed with 8 rounds still unfinished), so the round
    count has to leave room to actually return an answer."""
    c = _websearch_call_args()
    max_uses = c["body"]["tools"][0]["max_uses"]
    assert max_uses * 40 <= c["timeout"], (
        f"{max_uses} search rounds at ~40s each cannot finish inside the {c['timeout']}s "
        f"request timeout -- the call times out instead of answering"
    )


def test_a_later_pass_is_what_retries_this_stage():
    """Dropping the in-call retry is only safe because re-attempts live in the
    marker policy instead -- guard against both being removed."""
    assert orchestrator_module.MAX_WEBSEARCH_TRANSIENT_ATTEMPTS >= 2
