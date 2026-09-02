"""Tests for the synchronous Bright Data LinkedIn scraping client."""

from __future__ import annotations

import os
import sys

import requests
import responses

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config
from providers.brightdata_client import BrightDataClient, BrightDataError


def _cfg(**overrides):
    base = dict(
        brightdata_api_key="bd", dataset_id="gd_test", tavily_api_key="tv", claude_api_key="cl",
        brightdata_base_url="https://api.brightdata.com/datasets/v3/scrape",
        max_retries=3, retry_backoff_base=2.0, request_timeout=5,
    )
    base.update(overrides)
    return Config(**base)


@responses.activate
def test_scrape_success_returns_parsed_json():
    cfg = _cfg()
    responses.add(responses.POST, cfg.brightdata_base_url, json=[{"name": "Amara"}], status=200)
    client = BrightDataClient(cfg)
    data = client.scrape_profile("https://linkedin.com/in/amara")
    assert data == [{"name": "Amara"}]
    assert len(responses.calls) == 1
    assert responses.calls[0].request.params.get("dataset_id") == "gd_test"


@responses.activate
def test_scrape_retries_on_503_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.brightdata_client.time.sleep")
    responses.add(responses.POST, cfg.brightdata_base_url, status=503)
    responses.add(responses.POST, cfg.brightdata_base_url, json=[{"ok": True}], status=200)
    client = BrightDataClient(cfg)
    data = client.scrape_profile("https://linkedin.com/in/x")
    assert data == [{"ok": True}]
    assert len(responses.calls) == 2
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_scrape_exhausts_retries_on_500_raises_brightdata_error(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("providers.brightdata_client.time.sleep")
    for _ in range(3):
        responses.add(responses.POST, cfg.brightdata_base_url, status=500)
    client = BrightDataClient(cfg)
    try:
        client.scrape_profile("https://linkedin.com/in/x")
        assert False, "expected BrightDataError"
    except BrightDataError as exc:
        assert exc.status_code == 500
    assert len(responses.calls) == 3


@responses.activate
def test_scrape_429_parses_retry_after_header_and_sleeps(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.brightdata_client.time.sleep")
    responses.add(responses.POST, cfg.brightdata_base_url, status=429, headers={"Retry-After": "3"})
    responses.add(responses.POST, cfg.brightdata_base_url, json=[{"ok": True}], status=200)
    client = BrightDataClient(cfg)
    client.scrape_profile("https://linkedin.com/in/x")
    assert len(responses.calls) == 2
    # retry_after=3.0 sleep plus the backoff-before-next-attempt sleep (2**1=2.0)
    sleep_mock.assert_any_call(3.0)
    sleep_mock.assert_any_call(2.0)


@responses.activate
def test_scrape_429_without_retry_after_header_still_retries(mocker):
    cfg = _cfg(max_retries=2)
    sleep_mock = mocker.patch("providers.brightdata_client.time.sleep")
    responses.add(responses.POST, cfg.brightdata_base_url, status=429)
    responses.add(responses.POST, cfg.brightdata_base_url, json=[{"ok": True}], status=200)
    client = BrightDataClient(cfg)
    client.scrape_profile("https://linkedin.com/in/x")
    assert len(responses.calls) == 2
    sleep_mock.assert_called_once_with(2.0)


@responses.activate
def test_scrape_empty_body_is_non_retryable_brightdata_error():
    cfg = _cfg(max_retries=3)
    responses.add(responses.POST, cfg.brightdata_base_url, body="", status=200)
    client = BrightDataClient(cfg)
    try:
        client.scrape_profile("https://linkedin.com/in/x")
        assert False, "expected BrightDataError"
    except BrightDataError as exc:
        assert "Empty API response body" in exc.message
    assert len(responses.calls) == 1, "malformed non-transient response must not retry"


@responses.activate
def test_scrape_invalid_json_is_non_retryable_brightdata_error():
    cfg = _cfg(max_retries=3)
    responses.add(responses.POST, cfg.brightdata_base_url, body="not json{{{", status=200,
                  content_type="application/json")
    client = BrightDataClient(cfg)
    try:
        client.scrape_profile("https://linkedin.com/in/x")
        assert False, "expected BrightDataError"
    except BrightDataError as exc:
        assert "Invalid JSON" in exc.message
    assert len(responses.calls) == 1


@responses.activate
def test_scrape_empty_list_payload_is_non_retryable_brightdata_error():
    cfg = _cfg(max_retries=3)
    responses.add(responses.POST, cfg.brightdata_base_url, json=[], status=200)
    client = BrightDataClient(cfg)
    try:
        client.scrape_profile("https://linkedin.com/in/x")
        assert False, "expected BrightDataError"
    except BrightDataError as exc:
        assert "Empty API response payload" in exc.message
    assert len(responses.calls) == 1


@responses.activate
def test_scrape_404_is_non_retryable_brightdata_error(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.brightdata_client.time.sleep")
    responses.add(responses.POST, cfg.brightdata_base_url, status=404, body="not found")
    client = BrightDataClient(cfg)
    try:
        client.scrape_profile("https://linkedin.com/in/x")
        assert False, "expected BrightDataError"
    except BrightDataError as exc:
        assert exc.status_code == 404
    assert len(responses.calls) == 1
    sleep_mock.assert_not_called()


@responses.activate
def test_scrape_timeout_is_transient_and_exhausts(mocker):
    cfg = _cfg(max_retries=1)
    mocker.patch("providers.brightdata_client.time.sleep")
    responses.add(responses.POST, cfg.brightdata_base_url, body=requests.exceptions.Timeout())
    responses.add(responses.POST, cfg.brightdata_base_url, body=requests.exceptions.Timeout())
    client = BrightDataClient(cfg)
    try:
        client.scrape_profile("https://linkedin.com/in/x")
        assert False, "expected BrightDataError"
    except BrightDataError as exc:
        assert "timed out" in exc.message
    assert len(responses.calls) == 2


@responses.activate
def test_scrape_generic_connection_error_is_transient_and_retried(mocker):
    """Distinct from Timeout: a bare requests.exceptions.RequestException
    subclass (e.g. ConnectionError) hits the separate generic
    `except requests.exceptions.RequestException` branch."""
    cfg = _cfg(max_retries=2)
    mocker.patch("providers.brightdata_client.time.sleep")
    responses.add(responses.POST, cfg.brightdata_base_url, body=requests.exceptions.ConnectionError("refused"))
    responses.add(responses.POST, cfg.brightdata_base_url, json=[{"ok": True}], status=200)
    client = BrightDataClient(cfg)
    data = client.scrape_profile("https://linkedin.com/in/x")
    assert data == [{"ok": True}]
    assert len(responses.calls) == 2


def test_parse_retry_after_returns_none_for_missing_or_invalid_header():
    resp_missing = requests.Response()
    assert BrightDataClient._parse_retry_after(resp_missing) is None

    resp_invalid = requests.Response()
    resp_invalid.headers["Retry-After"] = "not-a-number"
    assert BrightDataClient._parse_retry_after(resp_invalid) is None

    resp_valid = requests.Response()
    resp_valid.headers["Retry-After"] = "5.5"
    assert BrightDataClient._parse_retry_after(resp_valid) == 5.5
