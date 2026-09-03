"""Claude (Anthropic) REST API client for targeted critical field extraction."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import requests

from config import Config
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)


class ClaudeError(RuntimeError):
    """Failure during Claude API execution."""


def _extract_json_object(text: str) -> Dict[str, Any]:
    """Parse strict-JSON model output, salvaging a JSON object out of stray
    markdown fences or preamble if the model didn't return pure JSON.

    The Anthropic API has no `json_mode` flag equivalent to Groq's
    `response_format={"type": "json_object"}`, so the strict-JSON guarantee
    is replicated by (1) instructing the model explicitly in the prompt to
    return ONLY JSON, and (2) validating/salvaging the response here before
    it ever reaches verifier.py.
    """
    stripped = text.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    start, end = stripped.find("{"), stripped.rfind("}")
    if 0 <= start < end:
        return json.loads(stripped[start : end + 1])

    raise json.JSONDecodeError("No JSON object found in model output", stripped, 0)


class ClaudeClient:
    """Claude (Anthropic Messages API) client for targeted field extraction."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "x-api-key": config.claude_api_key,
                "anthropic-version": config.anthropic_version,
                "Content-Type": "application/json",
            }
        )
        self._policy = RetryPolicy(retries=config.max_retries)

    def extract_critical_fields(self, system_prompt: str, raw_text: str) -> Dict[str, Any]:
        """Run targeted LLM extraction with temperature=0 and an enforced-JSON prompt."""
        strict_json_suffix = (
            "\n\nRespond with ONLY the JSON object. No markdown code fences, no preamble, "
            "no commentary, no explanation before or after it. The response must start "
            "with '{' and end with '}'."
        )
        body = {
            "model": self.config.claude_model,
            "system": system_prompt + strict_json_suffix,
            "messages": [
                {"role": "user", "content": f"RAW SCRAPED PROFILE CONTENT:\n\n{raw_text[:8000]}"},
            ],
            "temperature": 0.0,
            "max_tokens": 1024,
        }

        log.info("Claude LLM request START model=%s", self.config.claude_model)

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Claude LLM request retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            return retry_with_backoff(lambda: self._request_once(body), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ClaudeError):
                raise cause from exc
            raise ClaudeError(f"Claude LLM call failed after retries: {cause if cause else exc}") from exc

    def _request_once(self, body: Dict[str, Any]) -> Dict[str, Any]:
        try:
            resp = self.session.post(
                self.config.claude_base_url,
                json=body,
                timeout=self.config.request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self.config.request_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        if resp.status_code == 429 or resp.status_code >= 500:
            raise TransientError(
                f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code
            )
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            raise ClaudeError(f"Claude LLM call failed: HTTP {resp.status_code}: {resp.text[:200]}") from exc

        data = resp.json()
        content_blocks = data.get("content", [])
        text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
        try:
            result = _extract_json_object(text)
        except json.JSONDecodeError as exc:
            # Malformed JSON from the model is worth one retry (a rare
            # decoding slip, not a hard failure) -- matches the original
            # loop's behavior of catching json.JSONDecodeError as retryable.
            raise TransientError(f"Malformed JSON in Claude response: {exc}") from exc
        log.info("Claude LLM request SUCCESS")
        return result
