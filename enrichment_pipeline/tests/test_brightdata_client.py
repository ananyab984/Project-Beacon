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


# --- the 429 path, which used to crash rather than retry ---------------------
#
# `_parse_retry_after` was defined at module level, indented as if it were a
# method, sitting after an unconditional `return True` inside
# `_is_content_free` -- unreachable dead code AND not an attribute of the
# class. `hasattr(BrightDataClient, "_parse_retry_after")` was False, so the
# `self._parse_retry_after(resp)` call in the 429 branch raised AttributeError
# on every rate-limited response. AttributeError is not a TransientError, so
# retry_with_backoff re-raised immediately: the branch whose whole purpose is
# to feed `retry_after` into the backoff instead crashed the call and skipped
# the retry loop. There was no test for this path, which is why it shipped.

def test_parse_retry_after_is_actually_a_method_on_the_class():
    """The regression guard proper: the bug was one of BINDING, not logic."""
    assert hasattr(BrightDataClient, "_parse_retry_after"), (
        "_parse_retry_after is not bound to the class -- the 429 branch will raise AttributeError"
    )


def test_retry_after_header_is_parsed_and_a_missing_one_is_tolerated():
    class _R:
        headers = {"Retry-After": "12"}

    class _NoHeader:
        headers = {}

    class _Garbage:
        headers = {"Retry-After": "soon"}

    assert BrightDataClient._parse_retry_after(_R()) == 12.0
    assert BrightDataClient._parse_retry_after(_NoHeader()) is None
    assert BrightDataClient._parse_retry_after(_Garbage()) is None


def test_a_429_is_retried_rather_than_crashing():
    """End to end through the real retry loop: a 429 then a good response must
    yield the good response, not an AttributeError."""
    rate_limited = _FakeResponse(429, None)
    rate_limited.headers = {"Retry-After": "0"}
    real = _FakeResponse(200, [{"input": {"url": "x"}, "name": "Jane Doe", "about": "A real bio"}])
    session = _FakeSession([rate_limited, real])
    client = BrightDataClient(_config(), session=session)

    data = client.scrape_profile("https://www.linkedin.com/in/jane/")
    assert data[0]["name"] == "Jane Doe"
    assert session.calls == 2, "the 429 must consume one attempt and then be retried"


# --- the guard now recognises echoes and defaults, not just bookkeeping -----

def test_input_echoes_and_per_record_defaults_are_not_content():
    """A completely empty scrape still carries half a dozen truthy keys that
    are either derived from the URL we sent (`id`, `url`, `input_url`,
    `linkedin_id`) or stamped on every record regardless of what was found
    (`default_avatar`, `influencer`, `memorialized_account`). Counting them as
    content let an empty result pass as a real one."""
    assert _is_content_free(
        [
            {
                "input": {"url": "https://www.linkedin.com/in/x/"},
                "timestamp": "t",
                "id": "x",
                "url": "https://www.linkedin.com/in/x",
                "input_url": "https://www.linkedin.com/in/x/",
                "linkedin_id": "x",
                "linkedin_num_id": "12345",
                "default_avatar": "true",
                "influencer": "false",
                "memorialized_account": "false",
            }
        ]
    )


def test_shell_sections_are_not_content():
    """`experience: [{}]` is the empty-schema signature -- structurally
    non-empty, semantically nothing. The old one-level truthiness check
    accepted it."""
    assert _is_content_free([{"id": "x", "experience": [{}], "education": [{}], "languages": [{}]}])


def test_one_real_field_among_the_echoes_is_still_content():
    assert not _is_content_free(
        [{"id": "x", "url": "u", "default_avatar": "true", "languages": [{"title": "Spanish"}]}]
    )


# --- the retry budget that made all of the above reachable ------------------

def test_brightdata_has_a_budget_that_permits_more_than_one_attempt():
    """`RetryPolicy(retries=N)` inherited the shared 15s deadline against a 10s
    request timeout, so attempt one could consume 10s, the backoff 1s, and the
    second attempt got ~4s of the budget it needed 10s for -- started, then
    killed mid-flight. Bright Data got ONE real attempt no matter what
    `max_retries` said, silently defeating the retry the content-free guard
    explicitly reasons about."""
    client = BrightDataClient(_config())
    assert client._policy.deadline_seconds / client._request_timeout >= 2, (
        f"deadline {client._policy.deadline_seconds}s / timeout {client._request_timeout}s leaves no "
        f"room for a second full attempt"
    )
