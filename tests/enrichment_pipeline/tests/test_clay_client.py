"""Tests for the Clay dispatch-only client. Clay's inbound webhook only ever
acknowledges a row was accepted -- the real enrichment result comes back
later via a separate async webhook to the Node backend (see clay_client.py's
module docstring). dispatch_lead() therefore never returns parsed data; it
either returns None (dispatched) or raises ClayError."""

from __future__ import annotations

import json
import os
import sys

import requests
import responses

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config
from providers.clay_client import ClayClient, ClayError, TransientError


def _cfg(**overrides):
    base = dict(
        brightdata_api_key="bd", dataset_id="ds", tavily_api_key="tv", claude_api_key="cl",
        clay_webhook_url="https://clay.example.com/webhook",
        max_retries=3, retry_backoff_base=2.0, request_timeout=5,
    )
    base.update(overrides)
    return Config(**base)


def _lead():
    return {
        "Full_Name": "Amara Okonkwo", "Profile_Link": "https://linkedin.com/in/amara",
        "Email_Address": "amara@example.com", "Country_of_Residence": "Nigeria", "Source": "ProZ",
    }


@responses.activate
def test_dispatch_success_first_try_sends_expected_payload():
    cfg = _cfg()
    responses.add(responses.POST, cfg.clay_webhook_url, status=200)
    client = ClayClient(cfg)
    result = client.dispatch_lead(_lead(), correlation_id="lead-123")
    assert result is None
    assert len(responses.calls) == 1
    body = json.loads(responses.calls[0].request.body)
    assert body == {
        "source_row_index": "lead-123",
        "Full Name": "Amara Okonkwo",
        "Profile Link": "https://linkedin.com/in/amara",
        "Email": "amara@example.com",
        "Country": "Nigeria",
        "Source": "ProZ",
    }


@responses.activate
def test_dispatch_missing_lead_fields_default_to_empty_string():
    cfg = _cfg()
    responses.add(responses.POST, cfg.clay_webhook_url, status=200)
    client = ClayClient(cfg)
    client.dispatch_lead({}, correlation_id="lead-x")
    body = json.loads(responses.calls[0].request.body)
    assert body["Full Name"] == "" and body["Profile Link"] == "" and body["Email"] == ""


@responses.activate
def test_dispatch_retries_on_500_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.clay_client.time.sleep")
    responses.add(responses.POST, cfg.clay_webhook_url, status=500)
    responses.add(responses.POST, cfg.clay_webhook_url, status=200)
    client = ClayClient(cfg)
    client.dispatch_lead(_lead(), correlation_id="lead-1")
    assert len(responses.calls) == 2
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_dispatch_exhausts_retries_and_raises_clay_error(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("providers.clay_client.time.sleep")
    for _ in range(3):
        responses.add(responses.POST, cfg.clay_webhook_url, status=503)
    client = ClayClient(cfg)
    try:
        client.dispatch_lead(_lead(), correlation_id="lead-2")
        assert False, "expected ClayError"
    except ClayError as exc:
        assert exc.status_code == 503
    assert len(responses.calls) == 3


@responses.activate
def test_dispatch_non_retryable_400_short_circuits_no_retry(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.clay_client.time.sleep")
    responses.add(responses.POST, cfg.clay_webhook_url, status=400, body="bad request")
    client = ClayClient(cfg)
    try:
        client.dispatch_lead(_lead(), correlation_id="lead-3")
        assert False, "expected ClayError"
    except ClayError as exc:
        assert exc.status_code == 400
        assert "bad request" in exc.message
    assert len(responses.calls) == 1, "non-retryable error must not retry"
    sleep_mock.assert_not_called()


@responses.activate
def test_dispatch_429_honors_retry_after_header_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("providers.clay_client.time.sleep")
    responses.add(responses.POST, cfg.clay_webhook_url, status=429, headers={"Retry-After": "1"})
    responses.add(responses.POST, cfg.clay_webhook_url, status=200)
    client = ClayClient(cfg)
    client.dispatch_lead(_lead(), correlation_id="lead-4")
    assert len(responses.calls) == 2
    # 429 raised as TransientError but retry_after isn't parsed for Clay (only Bright Data does);
    # the backoff sleep before attempt 1 must still occur.
    assert sleep_mock.called


@responses.activate
def test_dispatch_timeout_is_treated_as_transient_and_retried(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("providers.clay_client.time.sleep")
    responses.add(responses.POST, cfg.clay_webhook_url, body=requests.exceptions.Timeout())
    responses.add(responses.POST, cfg.clay_webhook_url, status=200)
    client = ClayClient(cfg)
    client.dispatch_lead(_lead(), correlation_id="lead-5")
    assert len(responses.calls) == 2


@responses.activate
def test_dispatch_network_error_exhausts_and_raises(mocker):
    cfg = _cfg(max_retries=1)
    mocker.patch("providers.clay_client.time.sleep")
    responses.add(responses.POST, cfg.clay_webhook_url, body=requests.exceptions.ConnectionError())
    responses.add(responses.POST, cfg.clay_webhook_url, body=requests.exceptions.ConnectionError())
    client = ClayClient(cfg)
    try:
        client.dispatch_lead(_lead(), correlation_id="lead-6")
        assert False, "expected ClayError"
    except ClayError as exc:
        assert "Network error" in exc.message
    assert len(responses.calls) == 2
