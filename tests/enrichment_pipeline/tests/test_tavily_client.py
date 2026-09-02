"""Tests for TavilyClient (Tavily Extract + Tavily Search).

Note on the Tavily "empty page" case: extract_url does NOT distinguish a
page with no extractable content from a hard failure -- an empty/missing
`results` list still returns normally with raw_content="" (see
tavily_client.py lines 61-71). There's no separate "no result" exception
type in this file, so we test that as the success path it actually is
rather than inventing a distinct failure mode.

Note on retry mechanics: on a 429/5xx status code the loop does a bare
`continue` (no exception raised), so if the LAST attempt also gets 429/5xx
the loop just ends and TavilyError is raised AFTER the loop with the
"exhausted retries" message -- a different message than the "failed for
{x}: {exc}" message raised when a real exception (e.g. invalid JSON) hits
on the last attempt. Both paths are covered below.
"""

from __future__ import annotations

import os
import sys

import requests
import responses

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config
from providers.tavily_client import TavilyClient, TavilyError


def _cfg(**overrides):
    base = dict(
        brightdata_api_key="bd", dataset_id="ds", tavily_api_key="tv-key", claude_api_key="cl",
        tavily_extract_url="https://api.tavily.com/extract",
        tavily_search_url="https://api.tavily.com/search",
        max_retries=3, retry_backoff_base=2.0, request_timeout=5,
    )
    base.update(overrides)
    return Config(**base)


# ---- extract_url ----

@responses.activate
def test_extract_success_returns_raw_content_from_results():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_extract_url, status=200,
                  json={"results": [{"raw_content": "full page text"}]})
    client = TavilyClient(cfg)
    result = client.extract_url("https://proz.com/profile/x")
    assert result["url"] == "https://proz.com/profile/x"
    assert result["raw_content"] == "full page text"
    assert result["tavily_raw"]["results"][0]["raw_content"] == "full page text"


@responses.activate
def test_extract_falls_back_to_content_field_when_raw_content_absent():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_extract_url, status=200,
                  json={"results": [{"content": "shorter text"}]})
    client = TavilyClient(cfg)
    result = client.extract_url("https://proz.com/profile/x")
    assert result["raw_content"] == "shorter text"


@responses.activate
def test_extract_empty_results_is_a_success_with_empty_content_not_an_error():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_extract_url, status=200, json={"results": []})
    client = TavilyClient(cfg)
    result = client.extract_url("https://proz.com/profile/gone")
    assert result["raw_content"] == ""
    assert result["url"] == "https://proz.com/profile/gone"


@responses.activate
def test_extract_missing_results_key_is_also_a_success_with_empty_content():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_extract_url, status=200, json={})
    client = TavilyClient(cfg)
    result = client.extract_url("https://proz.com/profile/gone")
    assert result["raw_content"] == ""


@responses.activate
def test_extract_retries_on_500_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.tavily_client.time.sleep")
    responses.add(responses.POST, cfg.tavily_extract_url, status=500)
    responses.add(responses.POST, cfg.tavily_extract_url, status=200, json={"results": [{"raw_content": "ok"}]})
    client = TavilyClient(cfg)
    result = client.extract_url("https://proz.com/profile/x")
    assert result["raw_content"] == "ok"
    assert len(responses.calls) == 2
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_extract_exhausts_via_repeated_429_raises_exhausted_retries_message(mocker):
    """All attempts return 429 (no exception raised) -- loop falls through and
    raises the post-loop 'exhausted retries' TavilyError."""
    cfg = _cfg(max_retries=2)
    mocker.patch("providers.tavily_client.time.sleep")
    for _ in range(3):
        responses.add(responses.POST, cfg.tavily_extract_url, status=429)
    client = TavilyClient(cfg)
    try:
        client.extract_url("https://proz.com/profile/x")
        assert False, "expected TavilyError"
    except TavilyError as exc:
        assert "exhausted retries" in str(exc)
    assert len(responses.calls) == 3


@responses.activate
def test_extract_exhausts_via_exception_raises_failed_message(mocker):
    """An actual exception (invalid JSON) on the last attempt raises the
    'failed for {url}: {exc}' message, distinct from the status-code path."""
    cfg = _cfg(max_retries=1)
    mocker.patch("providers.tavily_client.time.sleep")
    responses.add(responses.POST, cfg.tavily_extract_url, status=200, body="not json")
    responses.add(responses.POST, cfg.tavily_extract_url, status=200, body="not json")
    client = TavilyClient(cfg)
    try:
        client.extract_url("https://proz.com/profile/x")
        assert False, "expected TavilyError"
    except TavilyError as exc:
        assert "Tavily Extract failed for" in str(exc)
    assert len(responses.calls) == 2


@responses.activate
def test_extract_network_error_retried_then_succeeds(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("providers.tavily_client.time.sleep")
    responses.add(responses.POST, cfg.tavily_extract_url, body=requests.exceptions.ConnectionError())
    responses.add(responses.POST, cfg.tavily_extract_url, status=200, json={"results": [{"raw_content": "ok"}]})
    client = TavilyClient(cfg)
    result = client.extract_url("https://proz.com/profile/x")
    assert result["raw_content"] == "ok"
    assert len(responses.calls) == 2


# ---- search_snippets ----

@responses.activate
def test_search_success_splits_primary_and_other_snippets():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_search_url, status=200,
                  json={"results": [{"content": "first"}, {"content": "second"}]})
    client = TavilyClient(cfg)
    result = client.search_snippets("Amara Okonkwo translator")
    assert result["primary_snippet"] == {"content": "first"}
    assert result["other_snippets"] == [{"content": "second"}]


@responses.activate
def test_search_empty_results_returns_none_primary_and_empty_others():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_search_url, status=200, json={"results": []})
    client = TavilyClient(cfg)
    result = client.search_snippets("nobody findable")
    assert result["primary_snippet"] is None
    assert result["other_snippets"] == []


@responses.activate
def test_search_includes_domains_in_payload_when_provided():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_search_url, status=200, json={"results": []})
    client = TavilyClient(cfg)
    client.search_snippets("Amara Okonkwo", include_domains=["proz.com"])
    import json as _json
    body = _json.loads(responses.calls[0].request.body)
    assert body["include_domains"] == ["proz.com"]


@responses.activate
def test_search_omits_include_domains_when_not_provided():
    cfg = _cfg()
    responses.add(responses.POST, cfg.tavily_search_url, status=200, json={"results": []})
    client = TavilyClient(cfg)
    client.search_snippets("Amara Okonkwo")
    import json as _json
    body = _json.loads(responses.calls[0].request.body)
    assert "include_domains" not in body


@responses.activate
def test_search_retries_on_503_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.tavily_client.time.sleep")
    responses.add(responses.POST, cfg.tavily_search_url, status=503)
    responses.add(responses.POST, cfg.tavily_search_url, status=200, json={"results": [{"content": "x"}]})
    client = TavilyClient(cfg)
    result = client.search_snippets("q")
    assert result["primary_snippet"] == {"content": "x"}
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_search_exhausts_via_repeated_500_raises_exhausted_message(mocker):
    cfg = _cfg(max_retries=1)
    mocker.patch("providers.tavily_client.time.sleep")
    responses.add(responses.POST, cfg.tavily_search_url, status=500)
    responses.add(responses.POST, cfg.tavily_search_url, status=500)
    client = TavilyClient(cfg)
    try:
        client.search_snippets("q")
        assert False, "expected TavilyError"
    except TavilyError as exc:
        assert "exhausted retries" in str(exc)


@responses.activate
def test_search_exhausts_via_exception_raises_failed_message(mocker):
    """Mirrors extract_url's equivalent case: an actual exception (invalid
    JSON) on the last attempt raises the 'failed for {query}: {exc}'
    message via search_snippets' own except-Exception branch, distinct
    from the status-code-driven 'exhausted retries' path above."""
    cfg = _cfg(max_retries=1)
    mocker.patch("providers.tavily_client.time.sleep")
    responses.add(responses.POST, cfg.tavily_search_url, status=200, body="not json")
    responses.add(responses.POST, cfg.tavily_search_url, status=200, body="not json")
    client = TavilyClient(cfg)
    try:
        client.search_snippets("q")
        assert False, "expected TavilyError"
    except TavilyError as exc:
        assert "Tavily Search failed for" in str(exc)
    assert len(responses.calls) == 2
