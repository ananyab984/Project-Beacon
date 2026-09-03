"""Groq REST client for the LLM-based duplicate/identity-resolution stage."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import requests

from config import Config
from core.dedup_prompts import build_dedup_system_prompt, build_dedup_user_content
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)


class DedupGroqError(RuntimeError):
    """Failure during a Groq duplicate-matching call."""


class DedupGroqClient:
    """Groq chat-completions client dedicated to the duplicate-detection stage."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.groq_api_key}",
                "Content-Type": "application/json",
            }
        )
        self._policy = RetryPolicy(retries=config.max_retries)

    def find_matches(self, tested_lead: Dict[str, Any], candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Ask the model whether `tested_lead` is the same person as any of `candidates`.

        Returns the parsed `{"matches": [...]}` JSON exactly as the model produced it --
        no scoring, filtering, or verification is applied here or by any caller.
        """
        body = {
            "model": self.config.groq_model,
            "messages": [
                {"role": "system", "content": build_dedup_system_prompt()},
                {"role": "user", "content": build_dedup_user_content(tested_lead, candidates)},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "max_tokens": 2048,
        }

        log.info("Dedup Groq request START model=%s candidates=%d", self.config.groq_model, len(candidates))

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Dedup Groq request retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            return retry_with_backoff(lambda: self._request_once(body), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, DedupGroqError):
                raise cause from exc
            raise DedupGroqError(f"Dedup Groq call failed after retries: {cause if cause else exc}") from exc

    def _request_once(self, body: Dict[str, Any]) -> Dict[str, Any]:
        try:
            resp = self.session.post(
                self.config.groq_base_url,
                json=body,
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
            raise DedupGroqError(f"Dedup Groq call failed: HTTP {resp.status_code}: {resp.text[:200]}") from exc

        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        try:
            result = json.loads(content)
        except json.JSONDecodeError as exc:
            raise TransientError(f"Malformed JSON in Groq response: {exc}") from exc
        if not isinstance(result, dict) or "matches" not in result:
            raise TransientError(f"Response missing 'matches' key: {content[:200]!r}")
        log.info("Dedup Groq request SUCCESS matches=%d", len(result.get("matches") or []))
        return result
