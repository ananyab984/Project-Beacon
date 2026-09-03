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

        return resp.json()

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

        return resp.json()
