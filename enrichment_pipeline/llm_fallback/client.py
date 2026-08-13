"""Claude (Anthropic) REST API client for targeted critical field extraction."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

import requests

from config import Config
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

        for attempt in range(1, self.config.max_retries + 1):
            try:
                resp = self.session.post(
                    self.config.claude_base_url,
                    json=body,
                    timeout=self.config.request_timeout,
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    log.warning(
                        "Claude LLM request retryable status=%s attempt=%d/%d",
                        resp.status_code, attempt, self.config.max_retries,
                    )
                    if attempt >= self.config.max_retries:
                        raise ClaudeError(
                            f"Claude LLM call failed after {self.config.max_retries} attempts: "
                            f"HTTP {resp.status_code}: {resp.text[:200]}"
                        )
                    time.sleep(self.config.retry_backoff_base ** attempt)
                    continue
                resp.raise_for_status()
                data = resp.json()
                content_blocks = data.get("content", [])
                text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
                result = _extract_json_object(text)
                log.info("Claude LLM request SUCCESS")
                return result
            except ClaudeError:
                raise
            except Exception as exc:
                if attempt >= self.config.max_retries:
                    raise ClaudeError(f"Claude LLM call failed after {self.config.max_retries} attempts: {exc}") from exc
                time.sleep(self.config.retry_backoff_base ** attempt)

        raise ClaudeError("Claude LLM call failed")
