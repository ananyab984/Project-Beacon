"""Tests for Bright Data's "technically 200, actually empty" detection.

Confirmed live 2026-09-07: a blocked/inaccessible LinkedIn profile makes
Bright Data's API return `[{"input": {"url": "..."}, "timestamp": "..."}]` --
a list with ONE item, so the pre-existing `len(data) == 0` emptiness check
never fires. That response was accepted as a normal success and never
retried, even though BrightDataClient already has a 5-attempt/15s-deadline
retry loop wired up for exactly this purpose -- it just never engaged, since
no exception was ever raised to trigger it.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_brightdata_client.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from providers.brightdata_client import BrightDataClient, BrightDataError, _is_content_free


def _config() -> Config:
    return Config(brightdata_api_key="test-key", dataset_id="ds", tavily_api_key="", claude_api_key="", groq_api_key="", max_retries=2)


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else str(payload)
        self.headers = {}

    def json(self):
        return self._payload


class _FakeSession:
    """Records every call; returns a fixed sequence of responses in order,
    repeating the last one once exhausted (so a 5-attempt retry loop doesn't
    need 5 distinct canned responses to exercise)."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = 0
        self.headers = {}

    def post(self, *args, **kwargs):
        resp = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        return resp


# --- the emptiness classifier itself -----------------------------------------

def test_content_free_detects_the_real_martin_godart_shape():
    assert _is_content_free([{"input": {"url": "https://www.linkedin.com/in/martin-godart-b15a0b28b/"}, "timestamp": "2026-09-07T10:41:34.075Z"}])


def test_content_free_ignores_bookkeeping_keys_alongside_real_data():
    assert not _is_content_free([{"input": {"url": "..."}, "timestamp": "...", "name": "Test 1", "about": "Something real"}])


def test_content_free_true_for_a_bare_bookkeeping_dict_not_wrapped_in_a_list():
    assert _is_content_free({"input": {"url": "..."}, "timestamp": "..."})


def test_content_free_false_for_an_unexpected_non_dict_item():
    # Not this specific failure mode -- don't misclassify a genuinely
    # different shape as "content-free".
    assert not _is_content_free(["just a string, not a dict"])


# --- the actual retry behavior ------------------------------------------------

def test_content_free_response_is_retried_not_silently_accepted():
    """The core regression: this used to return successfully on the first
    call. It must now raise (via TransientError, caught internally by
    retry_with_backoff) and actually retry the request."""
    bookkeeping_only = _FakeResponse(200, [{"input": {"url": "x"}, "timestamp": "t"}])
    session = _FakeSession([bookkeeping_only])
    client = BrightDataClient(_config(), session=session)

    try:
        client.scrape_profile("https://www.linkedin.com/in/martin-godart-b15a0b28b/")
        assert False, "expected BrightDataError after retries were exhausted"
    except BrightDataError:
        pass

    assert session.calls > 1, f"a content-free response must be retried, got {session.calls} call(s)"


def test_a_real_response_is_accepted_on_the_first_call():
    real = _FakeResponse(200, [{"input": {"url": "x"}, "name": "Jane Doe", "about": "A real bio"}])
    session = _FakeSession([real])
    client = BrightDataClient(_config(), session=session)

    result = client.scrape_profile("https://www.linkedin.com/in/janedoe/")

    assert session.calls == 1, "a genuinely useful response must not be needlessly retried"
    assert result[0]["name"] == "Jane Doe"


def main():
    tests = [
        test_content_free_detects_the_real_martin_godart_shape,
        test_content_free_ignores_bookkeeping_keys_alongside_real_data,
        test_content_free_true_for_a_bare_bookkeeping_dict_not_wrapped_in_a_list,
        test_content_free_false_for_an_unexpected_non_dict_item,
        test_content_free_response_is_retried_not_silently_accepted,
        test_a_real_response_is_accepted_on_the_first_call,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {t.__name__}: {exc}")
    if failed:
        raise SystemExit(f"{failed}/{len(tests)} failed")
    print(f"All {len(tests)} tests passed")


if __name__ == "__main__":
    main()
