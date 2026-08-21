"""Claude (Anthropic) REST API client for targeted critical field extraction."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

import requests

from config import Config
from llm_fallback.prompt_builder import build_web_search_prompt
from logger import get_logger

log = get_logger(__name__)

# search_missing_fields always uses this model regardless of config.claude_model
# (which defaults to Haiku 4.5 for cost reasons on the plain extraction path):
# the web_search_20260209 tool type requires Opus 5/4.8/4.7/4.6, Sonnet 5, or
# Sonnet 4.6 -- Haiku 4.5 isn't supported for it.
_WEB_SEARCH_MODEL = "claude-sonnet-5"


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

    def search_missing_fields(
        self, missing_fields: List[str], full_name: str, profile_link: str
    ) -> Dict[str, Any]:
        """Ask Claude to use its web_search server tool to find specific
        missing fields about a named person -- used when Bright Data's own
        scrape left them empty, so extract_critical_fields would have no
        source text to mine. No `system` field or output_config.format here:
        combining a strict JSON schema with server tool use in the same call
        was confirmed (in this project's own testing) to make the model skip
        calling the tool entirely and hallucinate a schema-shaped answer
        instead -- the JSON instruction lives in the prompt text, and the
        result is salvaged from the final text block the same way
        extract_critical_fields does.

        Response times run well past extract_critical_fields' usual latency
        (multiple real searches per call), so this uses its own longer
        timeout rather than self.config.request_timeout.
        """
        system_prompt = build_web_search_prompt(missing_fields, full_name, profile_link)
        body = {
            "model": _WEB_SEARCH_MODEL,
            "max_tokens": 4096,
            "tools": [{"type": "web_search_20260209", "name": "web_search", "max_uses": 8}],
            "messages": [{"role": "user", "content": system_prompt}],
        }

        log.info("Claude web_search fallback START name=%r", full_name)
        try:
            resp = self.session.post(
                self.config.claude_base_url,
                json=body,
                timeout=max(self.config.request_timeout, 240),
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            raise ClaudeError(f"Claude web_search fallback failed: {exc}") from exc

        text_blocks = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
        if not text_blocks:
            raise ClaudeError("Claude web_search fallback returned no text content")

        try:
            result = _extract_json_object(text_blocks[-1])
        except json.JSONDecodeError as exc:
            raise ClaudeError(f"Claude web_search fallback returned non-JSON output: {exc}") from exc

        log.info("Claude web_search fallback SUCCESS name=%r sources=%s", full_name, result.get("sources_used"))
        return result
