"""Tests for ClaudeClient (Anthropic Messages API) targeted field extraction.

Retry mechanism (from llm_fallback/client.py): for attempt in range(1,
max_retries+1) -- on a 429/5xx status, if attempt >= max_retries it raises
ClaudeError immediately (no sleep before raising); otherwise it sleeps
retry_backoff_base**attempt and loops again. Any other exception (network
error, invalid JSON) is caught by a broad `except Exception`: same
exhaust-or-sleep-and-continue shape. A raised ClaudeError itself is
re-raised without modification (`except ClaudeError: raise`).
"""

from __future__ import annotations

import json
import os
import sys

import requests
import responses

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config
from llm_fallback.client import ClaudeClient, ClaudeError, _extract_json_object


def _cfg(**overrides):
    base = dict(
        brightdata_api_key="bd", dataset_id="ds", tavily_api_key="tv", claude_api_key="cl-key",
        claude_base_url="https://api.anthropic.com/v1/messages",
        claude_model="claude-haiku-4-5-20251001",
        max_retries=3, retry_backoff_base=2.0, request_timeout=5,
    )
    base.update(overrides)
    return Config(**base)


def _anthropic_response(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


# ---- _extract_json_object (pure helper) ----

def test_extract_json_object_parses_pure_json():
    assert _extract_json_object('{"a": 1}') == {"a": 1}


def test_extract_json_object_salvages_from_markdown_fence_and_preamble():
    text = 'Here is the result:\n```json\n{"a": 1, "b": "x"}\n```\nThanks.'
    assert _extract_json_object(text) == {"a": 1, "b": "x"}


def test_extract_json_object_strips_surrounding_whitespace():
    assert _extract_json_object('  \n  {"a": 1}  \n  ') == {"a": 1}


def test_extract_json_object_raises_when_no_braces_present():
    import pytest
    with pytest.raises(json.JSONDecodeError):
        _extract_json_object("no json here at all")


# ---- extract_critical_fields: success paths ----

@responses.activate
def test_extract_success_first_try_returns_parsed_json():
    cfg = _cfg()
    responses.add(
        responses.POST, cfg.claude_base_url, status=200,
        json=_anthropic_response('{"Current_Title": "Translator"}'),
    )
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("system prompt", "raw text")
    assert result == {"Current_Title": "Translator"}
    assert len(responses.calls) == 1


@responses.activate
def test_extract_sends_expected_request_body_and_headers():
    cfg = _cfg()
    responses.add(
        responses.POST, cfg.claude_base_url, status=200,
        json=_anthropic_response('{}'),
    )
    client = ClaudeClient(cfg)
    client.extract_critical_fields("Extract fields X, Y", "RAW TEXT HERE")
    req = responses.calls[0].request
    assert req.headers["x-api-key"] == "cl-key"
    assert req.headers["anthropic-version"] == cfg.anthropic_version
    body = json.loads(req.body)
    assert body["model"] == cfg.claude_model
    assert body["temperature"] == 0.0
    assert "Extract fields X, Y" in body["system"]
    assert "No markdown code fences" in body["system"]
    assert "RAW TEXT HERE" in body["messages"][0]["content"]


@responses.activate
def test_extract_truncates_raw_text_to_8000_chars():
    cfg = _cfg()
    responses.add(
        responses.POST, cfg.claude_base_url, status=200,
        json=_anthropic_response('{}'),
    )
    client = ClaudeClient(cfg)
    long_text = "x" * 9000
    client.extract_critical_fields("sys", long_text)
    body = json.loads(responses.calls[0].request.body)
    content = body["messages"][0]["content"]
    # Only the first 8000 chars of raw_text should appear.
    assert content.count("x") == 8000


@responses.activate
def test_extract_salvages_json_from_markdown_fenced_response():
    cfg = _cfg()
    responses.add(
        responses.POST, cfg.claude_base_url, status=200,
        json=_anthropic_response('```json\n{"Email_Address": "a@b.com"}\n```'),
    )
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"Email_Address": "a@b.com"}


@responses.activate
def test_extract_joins_multiple_text_content_blocks():
    cfg = _cfg()
    resp = {"content": [
        {"type": "text", "text": '{"a":'},
        {"type": "text", "text": ' 1}'},
    ]}
    responses.add(responses.POST, cfg.claude_base_url, status=200, json=resp)
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"a": 1}


@responses.activate
def test_extract_ignores_non_text_content_blocks():
    cfg = _cfg()
    resp = {"content": [
        {"type": "other", "text": "should be ignored"},
        {"type": "text", "text": '{"ok": true}'},
    ]}
    responses.add(responses.POST, cfg.claude_base_url, status=200, json=resp)
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"ok": True}


# ---- retry-then-succeed ----

@responses.activate
def test_extract_retries_on_500_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("llm_fallback.client.time.sleep")
    responses.add(responses.POST, cfg.claude_base_url, status=500)
    responses.add(responses.POST, cfg.claude_base_url, status=200,
                  json=_anthropic_response('{"ok": true}'))
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"ok": True}
    assert len(responses.calls) == 2
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_extract_retries_on_429_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("llm_fallback.client.time.sleep")
    responses.add(responses.POST, cfg.claude_base_url, status=429)
    responses.add(responses.POST, cfg.claude_base_url, status=200,
                  json=_anthropic_response('{"ok": true}'))
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"ok": True}
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_extract_retries_on_invalid_json_then_succeeds(mocker):
    """A non-2xx-triggering exception path: bad JSON in the model's text
    output is caught by the broad `except Exception` and retried."""
    cfg = _cfg(max_retries=3)
    sleep_mock = mocker.patch("llm_fallback.client.time.sleep")
    responses.add(responses.POST, cfg.claude_base_url, status=200,
                  json=_anthropic_response('not valid json at all no braces'))
    responses.add(responses.POST, cfg.claude_base_url, status=200,
                  json=_anthropic_response('{"ok": true}'))
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"ok": True}
    assert len(responses.calls) == 2
    sleep_mock.assert_called_once_with(cfg.retry_backoff_base ** 1)


@responses.activate
def test_extract_retries_on_network_error_then_succeeds(mocker):
    cfg = _cfg(max_retries=3)
    mocker.patch("llm_fallback.client.time.sleep")
    responses.add(responses.POST, cfg.claude_base_url, body=requests.exceptions.ConnectionError())
    responses.add(responses.POST, cfg.claude_base_url, status=200,
                  json=_anthropic_response('{"ok": true}'))
    client = ClaudeClient(cfg)
    result = client.extract_critical_fields("sys", "raw")
    assert result == {"ok": True}
    assert len(responses.calls) == 2


# ---- exhaustion paths ----

@responses.activate
def test_extract_exhausts_retries_on_repeated_500_raises_claude_error(mocker):
    cfg = _cfg(max_retries=3)
    mocker.patch("llm_fallback.client.time.sleep")
    for _ in range(3):
        responses.add(responses.POST, cfg.claude_base_url, status=500, body="server exploded")
    client = ClaudeClient(cfg)
    try:
        client.extract_critical_fields("sys", "raw")
        assert False, "expected ClaudeError"
    except ClaudeError as exc:
        assert "3 attempts" in str(exc)
        assert "500" in str(exc)
    assert len(responses.calls) == 3


@responses.activate
def test_extract_exhausts_retries_on_repeated_429_raises_claude_error(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("llm_fallback.client.time.sleep")
    for _ in range(2):
        responses.add(responses.POST, cfg.claude_base_url, status=429)
    client = ClaudeClient(cfg)
    try:
        client.extract_critical_fields("sys", "raw")
        assert False, "expected ClaudeError"
    except ClaudeError as exc:
        assert "2 attempts" in str(exc)
    assert len(responses.calls) == 2


@responses.activate
def test_extract_max_retries_one_fails_immediately_without_sleep(mocker):
    """With max_retries=1, attempt=1 is already >= max_retries on the first
    failure, so ClaudeError raises immediately with a single HTTP call and
    no sleep at all."""
    cfg = _cfg(max_retries=1)
    sleep_mock = mocker.patch("llm_fallback.client.time.sleep")
    responses.add(responses.POST, cfg.claude_base_url, status=500)
    client = ClaudeClient(cfg)
    try:
        client.extract_critical_fields("sys", "raw")
        assert False, "expected ClaudeError"
    except ClaudeError:
        pass
    assert len(responses.calls) == 1
    sleep_mock.assert_not_called()


@responses.activate
def test_extract_exhausts_on_persistent_invalid_json_raises_claude_error(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("llm_fallback.client.time.sleep")
    for _ in range(2):
        responses.add(responses.POST, cfg.claude_base_url, status=200,
                      json=_anthropic_response('still not json'))
    client = ClaudeClient(cfg)
    try:
        client.extract_critical_fields("sys", "raw")
        assert False, "expected ClaudeError"
    except ClaudeError as exc:
        assert "2 attempts" in str(exc)
    assert len(responses.calls) == 2


@responses.activate
def test_extract_exhausts_on_persistent_network_error_raises_claude_error(mocker):
    cfg = _cfg(max_retries=2)
    mocker.patch("llm_fallback.client.time.sleep")
    for _ in range(2):
        responses.add(responses.POST, cfg.claude_base_url, body=requests.exceptions.ConnectionError())
    client = ClaudeClient(cfg)
    try:
        client.extract_critical_fields("sys", "raw")
        assert False, "expected ClaudeError"
    except ClaudeError as exc:
        assert "2 attempts" in str(exc)
    assert len(responses.calls) == 2


@responses.activate
def test_extract_non_retryable_4xx_still_goes_through_retry_loop_via_raise_for_status(mocker):
    """A 400 isn't special-cased (only 429/5xx are) -- it falls through to
    resp.raise_for_status(), which raises HTTPError, caught by the broad
    `except Exception` and retried like any other exception until
    exhaustion."""
    cfg = _cfg(max_retries=2)
    mocker.patch("llm_fallback.client.time.sleep")
    for _ in range(2):
        responses.add(responses.POST, cfg.claude_base_url, status=400, body="bad request")
    client = ClaudeClient(cfg)
    try:
        client.extract_critical_fields("sys", "raw")
        assert False, "expected ClaudeError"
    except ClaudeError as exc:
        assert "2 attempts" in str(exc)
    assert len(responses.calls) == 2
