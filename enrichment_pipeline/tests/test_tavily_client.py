"""Tests for Tavily's "technically 200, actually empty" detection.

Tier 1's non-LinkedIn half had NO guard at all, while the LinkedIn half had
one. A page that extracted to nothing logged "Tavily Extract SUCCESS ...
content length=0", returned `raw_content: ""`, and orchestrator.py's
`if raw_scraped_data is not None` merged it as a successful scrape -- so the
lead was banked with a Tier 1 success containing no text, and never retried.
Identical in kind to the Bright Data bug that was fixed (see
test_brightdata_client.py), on the platforms where Tavily IS the primary
source: ProZ, Bodalgo, ATA/ATAA and personal sites.

Both guards now raise INSIDE the retried call, so each client's existing
retry_with_backoff actually engages instead of sitting unused.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_tavily_client.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from config import Config
from providers.tavily_client import TavilyClient, TavilyError


def _config() -> Config:
    return Config(
        brightdata_api_key="", dataset_id="", tavily_api_key="test-key",
        claude_api_key="", groq_api_key="", max_retries=2,
    )


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else str(payload)
        self.headers = {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class _FakeSession:
    """Returns a fixed sequence of responses, repeating the last once
    exhausted -- same helper shape as the Bright Data tests."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = 0
        self.headers = {}

    def post(self, *args, **kwargs):
        resp = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        return resp


# --- extract ----------------------------------------------------------------

def test_an_extract_with_no_page_content_is_retried_not_accepted():
    """The exact shape that used to be banked as a success."""
    empty = _FakeResponse(200, {"results": [{"url": "https://proz.com/profile/1", "raw_content": ""}]})
    real = _FakeResponse(200, {"results": [{"url": "https://proz.com/profile/1", "raw_content": "A real bio"}]})
    session = _FakeSession([empty, real])
    client = TavilyClient(_config(), session=session)

    out = client.extract_url("https://proz.com/profile/1")
    assert out["raw_content"] == "A real bio"
    assert session.calls == 2, "the empty extract must consume one attempt and then be retried"


def test_an_extract_with_no_results_at_all_is_retried():
    empty = _FakeResponse(200, {"results": []})
    real = _FakeResponse(200, {"results": [{"raw_content": "A real bio"}]})
    session = _FakeSession([empty, real])
    client = TavilyClient(_config(), session=session)

    assert client.extract_url("https://proz.com/profile/1")["raw_content"] == "A real bio"
    assert session.calls == 2


def test_a_persistently_empty_extract_ends_as_an_error_not_a_success():
    """Exhausting the retries must surface as TavilyError so the orchestrator
    logs a scraping warning, rather than merging an empty payload."""
    session = _FakeSession([_FakeResponse(200, {"results": [{"raw_content": ""}]})])
    client = TavilyClient(_config(), session=session)

    with pytest.raises(TavilyError):
        client.extract_url("https://proz.com/profile/1")
    assert session.calls > 1, "it should have retried before giving up"


def test_a_real_extract_is_accepted_on_the_first_call():
    session = _FakeSession([_FakeResponse(200, {"results": [{"raw_content": "Native Portuguese speaker"}]})])
    client = TavilyClient(_config(), session=session)

    out = client.extract_url("https://proz.com/profile/1")
    assert out["raw_content"] == "Native Portuguese speaker"
    assert session.calls == 1, "a good response must not be retried"


def test_content_key_is_accepted_when_raw_content_is_absent():
    """Tavily returns `content` instead of `raw_content` on some responses;
    the guard must not reject a result that has one but not the other."""
    session = _FakeSession([_FakeResponse(200, {"results": [{"content": "A real bio"}]})])
    client = TavilyClient(_config(), session=session)

    assert client.extract_url("https://proz.com/profile/1")["raw_content"] == "A real bio"
    assert session.calls == 1


# --- search -----------------------------------------------------------------

def test_a_search_with_no_results_is_retried():
    """The ProZ query is built from the lead's name (`site:proz.com {name}`),
    so a transient index miss is exactly what a second attempt resolves."""
    empty = _FakeResponse(200, {"results": []})
    real = _FakeResponse(200, {"results": [{"title": "Nadia Morais", "url": "https://proz.com/profile/68960"}]})
    session = _FakeSession([empty, real])
    client = TavilyClient(_config(), session=session)

    out = client.search_snippets("site:proz.com Nadia Morais", include_domains=["proz.com"])
    assert out["primary_snippet"]["title"] == "Nadia Morais"
    assert session.calls == 2


def test_a_real_search_is_accepted_on_the_first_call():
    session = _FakeSession([_FakeResponse(200, {"results": [{"title": "x"}, {"title": "y"}]})])
    client = TavilyClient(_config(), session=session)

    out = client.search_snippets("site:proz.com Someone")
    assert out["primary_snippet"]["title"] == "x"
    assert len(out["other_snippets"]) == 1
    assert session.calls == 1
