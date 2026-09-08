"""Bright Data client for synchronous LinkedIn profile scraping."""

from __future__ import annotations

from typing import Any, Dict, Optional

import json

import requests

from config import Config
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)


class BrightDataError(Exception):
    """Failure during Bright Data API scraping."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class BrightDataClient:
    """Client for POST /datasets/v3/scrape (LinkedIn profile scraping)."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.brightdata_api_key}",
                "Content-Type": "application/json",
            }
        )
        self._policy = RetryPolicy(retries=config.max_retries)

    def scrape_profile(self, profile_url: str) -> Any:
        """Scrape a single LinkedIn profile URL with exponential backoff retries."""
        params = {
            "dataset_id": self.config.dataset_id,
            "format": "json",
        }
        body = [{"url": profile_url}]

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Retry %d/%d for Bright Data scrape of %s after %.1fs (%s)",
                attempt + 1, self.config.max_retries, profile_url, delay, exc,
            )

        try:
            return retry_with_backoff(
                lambda: self._request_once(profile_url, params, body),
                policy=self._policy,
                on_retry=on_retry,
            )
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, BrightDataError):
                raise cause from exc
            raise BrightDataError(str(cause) if cause else str(exc)) from exc

    def _request_once(self, url: str, params: Dict[str, str], body: list) -> Any:
        log.info("Bright Data API request START url=%s dataset_id=%s", url, self.config.dataset_id)
        try:
            resp = self.session.post(
                self.config.brightdata_base_url,
                params=params,
                json=body,
                timeout=self.config.request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self.config.request_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        code = resp.status_code
        if code == 429:
            retry_after = self._parse_retry_after(resp)
            raise TransientError("Rate limited (429) by Bright Data", status_code=429, retry_after=retry_after)
        if 500 <= code < 600:
            raise TransientError(f"Server error ({code}) from Bright Data", status_code=code)
        if code != 200:
            raise BrightDataError(f"HTTP {code} error from Bright Data: {resp.text[:200]}", status_code=code)

        text = (resp.text or "").strip()
        if not text:
            raise BrightDataError("Empty API response body from Bright Data")

        try:
            data = resp.json()
        except ValueError as exc:
            raise BrightDataError(f"Invalid JSON in Bright Data response: {text[:200]}") from exc

        if data is None or (isinstance(data, (list, dict)) and len(data) == 0):
            raise BrightDataError("Empty API response payload")

        if _is_content_free(data):
            # Structurally non-empty, but nothing real inside it. Confirmed
            # live (2026-09-07): a blocked/inaccessible LinkedIn profile comes
            # back as `[{"input": {"url": "..."}, "timestamp": "..."}]` --
            # `len(data) == 0` above is False (one item!), so this used to
            # slip through as a normal SUCCESS and never got retried at all,
            # even though Bright Data already has a 5-attempt/15s-deadline
            # retry loop wired up (self._policy) that simply never engaged
            # because no exception was ever raised to trigger it. Raised as
            # TransientError (not the non-retried BrightDataError) so THIS
            # existing retry loop actually gets a chance -- a retry has a
            # real shot at landing on a different residential-proxy IP/
            # session than the one that just got blocked.
            raise TransientError(f"Bright Data returned no real profile content: {json.dumps(data)[:200]}")

        log.info("Bright Data API request SUCCESS url=%s", url)
        return data


# Keys Bright Data's own API uses purely for request bookkeeping, never for
# actual profile content -- a response containing only these (per item, for a
# list response) is the "accepted the request, found nothing" shape, not a
# real scrape result.
_BOOKKEEPING_KEYS = frozenset({"input", "timestamp", "warning", "error", "warning_code"})


def _is_content_free(data: Any) -> bool:
    """True if `data` (Bright Data's parsed JSON response) carries nothing
    but bookkeeping keys -- structurally non-empty, semantically empty."""
    items = data if isinstance(data, list) else [data]
    if not items:
        return True
    for item in items:
        if not isinstance(item, dict):
            return False  # an unexpected shape isn't this specific failure mode
        real_keys = set(item.keys()) - _BOOKKEEPING_KEYS
        if any(item.get(k) for k in real_keys):
            return False  # at least one item has real content somewhere
    return True

    @staticmethod
    def _parse_retry_after(resp: requests.Response) -> Optional[float]:
        raw = resp.headers.get("Retry-After")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None
