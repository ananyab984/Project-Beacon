"""Tavily client for web profile extraction (Tavily Extract) and snippet search (Tavily Search)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests

from config import Config
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)


class TavilyError(Exception):
    """Failure during Tavily API extraction or search."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class TavilyClient:
    """Client for Tavily Extract and Tavily Search APIs."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.tavily_api_key}",
                "Content-Type": "application/json",
            }
        )
        self._policy = RetryPolicy(retries=config.max_retries)

    def extract_url(self, url: str) -> Dict[str, Any]:
        """Extract public page markdown/HTML content via Tavily Extract API."""
        log.info("Tavily Extract request START url=%s", url)
        payload = {
            "urls": [url],
            "extract_depth": "advanced",
        }

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Retry %d/%d for Tavily Extract of %s after %.1fs (%s)",
                attempt + 1, self.config.max_retries, url, delay, exc,
            )

        try:
            data = retry_with_backoff(lambda: self._extract_once(payload), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, TavilyError):
                raise cause from exc
            raise TavilyError(f"Tavily Extract failed for {url}: {cause if cause else exc}") from exc

        results = data.get("results", [])
        raw_content = ""
        if results and isinstance(results, list):
            raw_content = results[0].get("raw_content") or results[0].get("content") or ""

        log.info("Tavily Extract SUCCESS url=%s (content length=%d)", url, len(raw_content))
        return {
            "url": url,
            "raw_content": raw_content,
            "tavily_raw": data,
        }

    def _extract_once(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            resp = self.session.post(
                self.config.tavily_extract_url,
                json=payload,
                timeout=self.config.request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self.config.request_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        if resp.status_code == 429 or resp.status_code >= 500:
            raise TransientError(f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            raise TavilyError(f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code) from exc

        data = resp.json()

        # Raised INSIDE the retried call, not after it, so this provider's
        # existing retry_with_backoff actually engages -- the same reasoning
        # (and the same fix) as brightdata_client.py's content-free guard.
        #
        # Tier 1's non-LinkedIn half had no guard at all: a page that extracted
        # to nothing logged "Tavily Extract SUCCESS ... content length=0",
        # returned `raw_content: ""`, and orchestrator.py's
        # `if raw_scraped_data is not None` merged it as a successful scrape.
        # The lead was then banked with a Tier 1 "success" that contained no
        # text, and never retried -- identical in kind to the LinkedIn-side bug
        # that was fixed, on the platforms where Tavily IS the primary source
        # (ProZ, Bodalgo, ATA/ATAA, personal sites). A retry is worth taking:
        # `extract_depth: "advanced"` on a slow page can simply come back
        # empty once.
        results = data.get("results")
        if not results or not isinstance(results, list):
            raise TransientError("Tavily Extract returned no results for this URL")
        first = results[0] if isinstance(results[0], dict) else {}
        if not str(first.get("raw_content") or first.get("content") or "").strip():
            raise TransientError("Tavily Extract returned a result with no page content")

        return data

    def search_snippets(self, query: str, include_domains: Optional[List[str]] = None) -> Dict[str, Any]:
        """Search public snippets via Tavily Search API (used for ProZ fallback)."""
        log.info("Tavily Search request START query=%r domains=%s", query, include_domains)
        payload: Dict[str, Any] = {
            "query": query,
            "search_depth": "advanced",
            "max_results": 5,
        }
        if include_domains:
            payload["include_domains"] = include_domains

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Retry %d/%d for Tavily Search of %r after %.1fs (%s)",
                attempt + 1, self.config.max_retries, query, delay, exc,
            )

        try:
            data = retry_with_backoff(lambda: self._search_once(payload), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, TavilyError):
                raise cause from exc
            raise TavilyError(f"Tavily Search failed for {query}: {cause if cause else exc}") from exc

        results = data.get("results", [])
        primary_snippet = results[0] if results else None
        other_snippets = results[1:] if len(results) > 1 else []

        log.info("Tavily Search SUCCESS query=%r found %d results", query, len(results))
        return {
            "query": query,
            "primary_snippet": primary_snippet,
            "other_snippets": other_snippets,
            "tavily_raw": data,
        }

    def _search_once(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            resp = self.session.post(
                self.config.tavily_search_url,
                json=payload,
                timeout=self.config.request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self.config.request_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        if resp.status_code == 429 or resp.status_code >= 500:
            raise TransientError(f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            raise TavilyError(f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code) from exc

        data = resp.json()

        # Same guard as _extract_once above, for the search path. A search that
        # matched nothing returned `results: []`, which the caller wrapped as
        # `primary_snippet: None` and handed on as a successful scrape. Retrying
        # is worth it here for a different reason than Extract: the ProZ query
        # is built from the lead's name (`site:proz.com {Full_Name}`), and a
        # transient index miss on a name is exactly the kind of thing a second
        # attempt resolves.
        if not data.get("results"):
            raise TransientError("Tavily Search returned no results for this query")

        return data
