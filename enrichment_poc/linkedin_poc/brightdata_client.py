"""Thin, well-behaved client for Bright Data's synchronous LinkedIn scrape API.

Design goals:
  * Build the request exactly as the spec/docs require: ``dataset_id`` and
    ``format`` are URL *query parameters*; the body is a JSON *array*.
  * Turn every documented failure mode into a clear, typed exception with a
    human-readable message, so the batch pipeline can record it per-row.
  * Retry only *transient* failures (HTTP 429 / 5xx / timeouts) with
    exponential backoff, honouring ``Retry-After`` when present.

The client is deliberately stateless apart from a reusable ``requests.Session``,
making it trivial to drop into a larger system (e.g. alongside a Unipile client).
"""

from __future__ import annotations

import time
from typing import Any

import requests

from config import Config
from logger import get_logger
from utils import timed

log = get_logger(__name__)


class EnrichmentError(Exception):
    """A per-profile enrichment failure with a user-facing message.

    The ``message`` is what gets written into the output's ``Enrichment_Error``
    column, so it should be concise and actionable.
    """

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class BrightDataClient:
    """Client for POST /datasets/v3/scrape (one LinkedIn profile per call)."""

    def __init__(self, config: Config, session: requests.Session | None = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
            }
        )

    # -- public API ---------------------------------------------------------

    def enrich_profile(self, url: str) -> Any:
        """Enrich a single LinkedIn profile URL.

        Returns the parsed JSON payload from Bright Data. Per the docs this is
        typically a single dict for a one-URL request, but a one-item list is
        also handled downstream by the parser — this method returns whatever
        Bright Data sends, unmodified.

        Raises:
            EnrichmentError: on any failure (auth, bad request, rate limit
                exhaustion, timeout, empty body, invalid JSON, ...).
        """
        params = {
            "dataset_id": self.config.dataset_id,
            "format": self.config.response_format,
        }
        body = [{"url": url}]  # JSON array, even for a single profile.

        log.debug("Built request payload for %s: params=%s body=%s", url, params, body)

        last_error: EnrichmentError | None = None
        # attempt 0 is the initial try; up to max_retries additional attempts.
        for attempt in range(self.config.max_retries + 1):
            if attempt:
                delay = self._backoff_delay(attempt)
                log.warning(
                    "Retry %d/%d for %s after %.1fs (%s)",
                    attempt,
                    self.config.max_retries,
                    url,
                    delay,
                    last_error.message if last_error else "transient error",
                )
                time.sleep(delay)

            try:
                return self._request_once(url, params, body)
            except _TransientError as exc:
                last_error = EnrichmentError(exc.message, status_code=exc.status_code)
                # Honour Retry-After for rate limiting when provided.
                self._retry_after = exc.retry_after
                continue
            # Non-transient EnrichmentError propagates immediately.

        # Exhausted retries on a transient error.
        assert last_error is not None
        raise EnrichmentError(
            f"{last_error.message} (gave up after {self.config.max_retries} retries)",
            status_code=last_error.status_code,
        )

    # -- internals ----------------------------------------------------------

    _retry_after: float | None = None

    def _request_once(self, url: str, params: dict, body: list) -> Any:
        """Perform one HTTP attempt and classify the outcome."""
        log.info("API request START url=%s dataset_id=%s", url, self.config.dataset_id)
        try:
            with timed() as t:
                resp = self.session.post(
                    self.config.base_url,
                    params=params,
                    json=body,
                    timeout=self.config.request_timeout,
                )
        except requests.exceptions.Timeout as exc:
            raise _TransientError(
                f"Request timed out after {self.config.request_timeout}s"
            ) from exc
        except requests.exceptions.RequestException as exc:
            # DNS errors, connection resets, etc. Treat as transient.
            raise _TransientError(f"Network error: {exc}") from exc

        log.info("API request END url=%s status=%s elapsed=%ss", url, resp.status_code, t.seconds)

        self._raise_for_status(resp)

        # 2xx: validate the body.
        text = (resp.text or "").strip()
        if not text:
            raise EnrichmentError("Empty API response body (2xx with no data)")

        try:
            data = resp.json()
        except ValueError as exc:  # requests raises ValueError/JSONDecodeError
            snippet = text[:200]
            raise EnrichmentError(f"Invalid JSON in response: {snippet!r}") from exc

        if data is None or (isinstance(data, (list, dict)) and len(data) == 0):
            raise EnrichmentError("Empty API response (null / empty JSON)")

        log.info("Enrichment SUCCESS url=%s", url)
        return data

    def _raise_for_status(self, resp: requests.Response) -> None:
        """Map HTTP status codes to typed errors per the spec's error table."""
        code = resp.status_code
        if 200 <= code < 300:
            return

        detail = self._short_body(resp)

        if code == 401:
            raise EnrichmentError(
                f"Authentication failed (401) — check BRIGHTDATA_API_KEY. {detail}",
                status_code=401,
            )
        if code == 403:
            raise EnrichmentError(
                f"Forbidden (403) — invalid/expired token or no dataset access. {detail}",
                status_code=403,
            )
        if code in (400, 404):
            raise EnrichmentError(
                f"Bad request ({code}) — likely wrong DATASET_ID or malformed request. {detail}",
                status_code=code,
            )
        if code == 429:
            retry_after = self._parse_retry_after(resp)
            raise _TransientError(
                f"Rate limited (429). {detail}",
                status_code=429,
                retry_after=retry_after,
            )
        if 500 <= code < 600:
            raise _TransientError(
                f"Server error ({code}) from Bright Data. {detail}",
                status_code=code,
            )

        # Any other non-2xx.
        raise EnrichmentError(f"Unexpected HTTP {code}. {detail}", status_code=code)

    def _backoff_delay(self, attempt: int) -> float:
        """Exponential backoff, capped, preferring server-supplied Retry-After."""
        if self._retry_after is not None:
            delay = self._retry_after
            self._retry_after = None
            return delay
        # base^attempt, capped at 60s.
        return min(self.config.retry_backoff_base ** attempt, 60.0)

    @staticmethod
    def _parse_retry_after(resp: requests.Response) -> float | None:
        raw = resp.headers.get("Retry-After")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None  # HTTP-date form; fall back to exponential backoff.

    @staticmethod
    def _short_body(resp: requests.Response) -> str:
        body = (resp.text or "").strip().replace("\n", " ")
        if not body:
            return ""
        return f"Body: {body[:200]}"


class _TransientError(Exception):
    """Internal signal that a failure is retryable (429 / 5xx / timeout)."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retry_after: float | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after
