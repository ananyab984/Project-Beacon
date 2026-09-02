"""Tests for the Groq REST client used by the dedup/identity-resolution stage.

All HTTP is mocked at the requests.Session boundary -- this must never hit the
real Groq API. All retry/backoff sleeps are mocked -- these tests must never
actually wait.
"""

from __future__ import annotations

import json
import os
import sys

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config
from core.dedup_client import DedupGroqClient, DedupGroqError


def make_config(**overrides) -> Config:
    defaults = dict(
        brightdata_api_key="bd-key",
        dataset_id="ds",
        tavily_api_key="tv-key",
        claude_api_key="claude-key",
        groq_api_key="groq-key",
        max_retries=3,
        retry_backoff_base=2.0,
        request_timeout=60,
    )
    defaults.update(overrides)
    return Config(**defaults)


class FakeResponse:
    """Minimal stand-in for requests.Response."""

    def __init__(self, status_code=200, json_body=None, text=""):
        self.status_code = status_code
        self._json_body = json_body
        self.text = text or json.dumps(json_body) if json_body else text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._json_body


def matches_payload(matches):
    return {"choices": [{"message": {"content": json.dumps({"matches": matches})}}]}


@pytest.fixture(autouse=True)
def no_real_sleep(mocker):
    """Every test in this file must run instantly -- never a real sleep."""
    return mocker.patch("core.dedup_client.time.sleep")


def test_init_sets_authorization_and_content_type_headers():
    cfg = make_config(groq_api_key="secret-groq-key")
    client = DedupGroqClient(cfg)
    assert client.session.headers["Authorization"] == "Bearer secret-groq-key"
    assert client.session.headers["Content-Type"] == "application/json"


def test_find_matches_success_first_try_returns_parsed_matches(mocker):
    cfg = make_config()
    session = requests.Session()
    post = mocker.patch.object(session, "post", return_value=FakeResponse(
        200, matches_payload([{"candidate_index": 0, "confidence": 0.9}])
    ))
    client = DedupGroqClient(cfg, session=session)

    result = client.find_matches({"Full_Name": "Alice"}, [{"Full_Name": "Alicia"}])

    assert result == {"matches": [{"candidate_index": 0, "confidence": 0.9}]}
    assert post.call_count == 1


def test_find_matches_sends_correct_request_body(mocker):
    cfg = make_config(groq_model="llama-test")
    session = requests.Session()
    post = mocker.patch.object(session, "post", return_value=FakeResponse(200, matches_payload([])))
    client = DedupGroqClient(cfg, session=session)

    tested = {"Full_Name": "Alice"}
    candidates = [{"Full_Name": "Bob"}]
    client.find_matches(tested, candidates)

    args, kwargs = post.call_args
    assert args[0] == cfg.groq_base_url
    body = kwargs["json"]
    assert body["model"] == "llama-test"
    assert body["temperature"] == 0.0
    assert body["response_format"] == {"type": "json_object"}
    assert body["max_tokens"] == 2048
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1]["role"] == "user"
    assert kwargs["timeout"] == cfg.request_timeout


def test_retryable_429_then_success_retries_with_backoff_sleep(mocker):
    cfg = make_config(max_retries=3, retry_backoff_base=2.0)
    session = requests.Session()
    post = mocker.patch.object(session, "post", side_effect=[
        FakeResponse(429, text="rate limited"),
        FakeResponse(200, matches_payload([])),
    ])
    sleep = mocker.patch("core.dedup_client.time.sleep")
    client = DedupGroqClient(cfg, session=session)

    result = client.find_matches({"Full_Name": "Alice"}, [])

    assert result == {"matches": []}
    assert post.call_count == 2
    sleep.assert_called_once_with(2.0 ** 1)


def test_retryable_5xx_exhausts_retries_and_raises_dedup_error(mocker):
    cfg = make_config(max_retries=2, retry_backoff_base=2.0)
    session = requests.Session()
    post = mocker.patch.object(session, "post", return_value=FakeResponse(500, text="boom"))
    sleep = mocker.patch("core.dedup_client.time.sleep")
    client = DedupGroqClient(cfg, session=session)

    with pytest.raises(DedupGroqError, match="HTTP 500"):
        client.find_matches({"Full_Name": "Alice"}, [])

    assert post.call_count == 2, "Should attempt exactly max_retries times"
    assert sleep.call_count == 1, "No sleep after the final failed attempt"


def test_non_retryable_http_error_retries_then_raises_dedup_error(mocker):
    """A 404 (not 429/5xx) still falls into the generic exception path via
    raise_for_status() and gets retried like any other failure."""
    cfg = make_config(max_retries=2, retry_backoff_base=2.0)
    session = requests.Session()
    post = mocker.patch.object(session, "post", return_value=FakeResponse(404, text="not found"))
    client = DedupGroqClient(cfg, session=session)

    with pytest.raises(DedupGroqError):
        client.find_matches({"Full_Name": "Alice"}, [])

    assert post.call_count == 2


def test_network_exception_retries_then_succeeds(mocker):
    cfg = make_config(max_retries=3)
    session = requests.Session()
    post = mocker.patch.object(session, "post", side_effect=[
        requests.exceptions.ConnectionError("network down"),
        FakeResponse(200, matches_payload([{"candidate_index": 0, "confidence": 0.5}])),
    ])
    client = DedupGroqClient(cfg, session=session)

    result = client.find_matches({"Full_Name": "Alice"}, [{"Full_Name": "Bob"}])

    assert result == {"matches": [{"candidate_index": 0, "confidence": 0.5}]}
    assert post.call_count == 2


def test_response_missing_matches_key_retries_then_raises(mocker):
    cfg = make_config(max_retries=2)
    session = requests.Session()
    bad_payload = {"choices": [{"message": {"content": json.dumps({"no_matches_here": []})}}]}
    post = mocker.patch.object(session, "post", return_value=FakeResponse(200, bad_payload))
    client = DedupGroqClient(cfg, session=session)

    with pytest.raises(DedupGroqError, match="missing 'matches' key"):
        client.find_matches({"Full_Name": "Alice"}, [])

    assert post.call_count == 2


def test_non_json_content_retries_then_raises(mocker):
    cfg = make_config(max_retries=1)
    session = requests.Session()
    payload = {"choices": [{"message": {"content": "not-json-at-all"}}]}
    post = mocker.patch.object(session, "post", return_value=FakeResponse(200, payload))
    client = DedupGroqClient(cfg, session=session)

    with pytest.raises(DedupGroqError):
        client.find_matches({"Full_Name": "Alice"}, [])

    assert post.call_count == 1


def test_zero_max_retries_raises_without_calling_post(mocker):
    """range(1, 1) is empty -- the loop body never runs, hitting the trailing
    unconditional raise. This is a real (if obscure) code path worth locking in."""
    cfg = make_config(max_retries=0)
    session = requests.Session()
    post = mocker.patch.object(session, "post")
    client = DedupGroqClient(cfg, session=session)

    with pytest.raises(DedupGroqError, match="Dedup Groq call failed"):
        client.find_matches({"Full_Name": "Alice"}, [])

    post.assert_not_called()


def test_default_session_is_created_when_none_provided():
    cfg = make_config()
    client = DedupGroqClient(cfg)
    assert isinstance(client.session, requests.Session)
