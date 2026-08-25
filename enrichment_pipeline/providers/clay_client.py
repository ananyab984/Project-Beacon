"""Clay client -- LinkedIn-only fallback for leads Bright Data returns nothing for.

Unlike BrightDataClient/TavilyClient, this is NOT a scrape-and-parse call: Clay's
inbound webhook only ever acknowledges that a row was accepted. Its waterfall
enrichment runs asynchronously (its own outbound webhook fires results back to
the Node backend's /api/webhooks/clay route minutes later -- see
server/src/routes/webhooks.routes.ts), so `dispatch_lead()` never returns
enriched data. It exists purely to hand the lead to Clay and mark that a Clay
result is pending; the orchestrator does not, and must not, block waiting for it.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

import requests

from config import Config
from logger import get_logger

log = get_logger(__name__)


class ClayError(Exception):
    """Failure dispatching a lead to Clay's inbound webhook."""

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


class ClayClient:
    """Client for Clay's inbound webhook -- dispatch only, no response data."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    def dispatch_lead(self, lead: Dict[str, Any], correlation_id: str) -> None:
        """POST a lead into Clay's inbound webhook.

        `correlation_id` MUST be the Lead's own primary key (server/prisma
        schema.prisma Lead.id) -- it's the only thing that lets
        /api/webhooks/clay match Clay's later, asynchronous result back to
        the right row. Raises ClayError on failure; the caller (orchestrator)
        should log and continue rather than fail the whole enrichment run
        over a Clay dispatch failure -- Bright Data's (partial or empty)
        result still stands either way.
        """
        payload = {
            "source_row_index": correlation_id,
            "Full Name": lead.get("Full_Name") or "",
            "Profile Link": lead.get("Profile_Link") or "",
            "Email": lead.get("Email_Address") or "",
            "Country": lead.get("Country_of_Residence") or "",
            "Source": lead.get("Source") or "",
        }

        last_error: Optional[ClayError] = None
        for attempt in range(self.config.max_retries + 1):
            if attempt > 0:
                delay = self.config.retry_backoff_base ** attempt
                log.warning("Retry %d/%d dispatching lead %s to Clay after %.1fs",
                            attempt, self.config.max_retries, correlation_id, delay)
                time.sleep(delay)
            try:
                self._post_once(payload)
                log.info("Dispatched lead %s to Clay (Bright Data returned nothing)", correlation_id)
                return
            except TransientError as exc:
                last_error = ClayError(exc.message, status_code=exc.status_code)
                if exc.retry_after:
                    time.sleep(exc.retry_after)
                continue
            except ClayError as exc:
                raise exc

        assert last_error is not None
        raise last_error

    def _post_once(self, payload: Dict[str, Any]) -> None:
        try:
            resp = self.session.post(
                self.config.clay_webhook_url,
                json=payload,
                timeout=self.config.request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self.config.request_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        code = resp.status_code
        if code == 429:
            raise TransientError("Rate limited (429) by Clay", status_code=429)
        if 500 <= code < 600:
            raise TransientError(f"Server error ({code}) from Clay", status_code=code)
        if not (200 <= code < 300):
            raise ClayError(f"HTTP {code} from Clay webhook: {resp.text[:200]}", status_code=code)
