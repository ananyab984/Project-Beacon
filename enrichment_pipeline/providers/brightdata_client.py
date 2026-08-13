"""Bright Data client for synchronous LinkedIn profile scraping."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

import requests

from config import Config
from logger import get_logger

log = get_logger(__name__)


class BrightDataError(Exception):
    """Failure during Bright Data API scraping."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class TransientError(Exception):
    """Internal signal for retryable HTTP errors (429, 5xx, timeouts)."""

    def __init__(self, message: str, status_code: Optional[int] = None, retry_after: Optional[float] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


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

    def scrape_profile(self, profile_url: str) -> Any:
        """Scrape a single LinkedIn profile URL with exponential backoff retries."""
        params = {
            "dataset_id": self.config.dataset_id,
            "format": "json",
        }
        body = [{"url": profile_url}]

        last_error: Optional[BrightDataError] = None

        for attempt in range(self.config.max_retries + 1):
            if attempt > 0:
                delay = self.config.retry_backoff_base ** attempt
                log.warning(
                    "Retry %d/%d for Bright Data scrape of %s after %.1fs",
                    attempt,
                    self.config.max_retries,
                    profile_url,
                    delay,
                )
                time.sleep(delay)

            try:
                return self._request_once(profile_url, params, body)
            except TransientError as exc:
                last_error = BrightDataError(exc.message, status_code=exc.status_code)
                if exc.retry_after:
                    time.sleep(exc.retry_after)
                continue
            except BrightDataError as exc:
                raise exc

        assert last_error is not None
        raise last_error

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

        log.info("Bright Data API request SUCCESS url=%s", url)
        return data

    @staticmethod
    def _parse_retry_after(resp: requests.Response) -> Optional[float]:
        raw = resp.headers.get("Retry-After")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None
