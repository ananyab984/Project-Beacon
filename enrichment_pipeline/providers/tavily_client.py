"""Tavily client for web profile extraction (Tavily Extract) and snippet search (Tavily Search)."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import requests

from config import Config
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

    def extract_url(self, url: str) -> Dict[str, Any]:
        """Extract public page markdown/HTML content via Tavily Extract API."""
        log.info("Tavily Extract request START url=%s", url)
        payload = {
            "urls": [url],
            "extract_depth": "advanced",
        }

        for attempt in range(self.config.max_retries + 1):
            if attempt > 0:
                time.sleep(self.config.retry_backoff_base ** attempt)
            try:
                resp = self.session.post(
                    self.config.tavily_extract_url,
                    json=payload,
                    timeout=self.config.request_timeout,
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    continue
                resp.raise_for_status()
                data = resp.json()

                # Extract raw_content from results list if available
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
            except Exception as exc:
                if attempt == self.config.max_retries:
                    raise TavilyError(f"Tavily Extract failed for {url}: {exc}") from exc

        raise TavilyError(f"Tavily Extract exhausted retries for {url}")

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

        for attempt in range(self.config.max_retries + 1):
            if attempt > 0:
                time.sleep(self.config.retry_backoff_base ** attempt)
            try:
                resp = self.session.post(
                    self.config.tavily_search_url,
                    json=payload,
                    timeout=self.config.request_timeout,
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    continue
                resp.raise_for_status()
                data = resp.json()
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
            except Exception as exc:
                if attempt == self.config.max_retries:
                    raise TavilyError(f"Tavily Search failed for {query}: {exc}") from exc

        raise TavilyError(f"Tavily Search exhausted retries for {query}")
