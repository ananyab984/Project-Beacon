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

    def translate_to_english(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Translate an enrichment payload's free text into English, keeping
        its shape and every detail it carries.

        A separate step from extraction on purpose. Asking Parallel to
        extract-and-translate in one pass made it do two jobs at once and
        quietly cost detail -- a phrase awkward to render in English came back
        flattened or missing, with no way to tell afterwards that anything had
        gone. So Parallel extracts faithfully in the profile's own language
        (see providers/parallel_client.py's LeadProfile) and this turns the
        result into English afterwards, which also leaves the original intact
        for the caller to keep alongside.

        Returns the same keys it was given. Raises ClaudeError, which the
        caller treats as "keep the untranslated payload" rather than as a
        failed enrichment -- source-language data is worth much more than no
        data.
        """
        system = (
            "You translate freelance-linguist profile data into English for an English-speaking "
            "recruiting team.\n\n"
            "RULES:\n"
            "- Return a JSON object with EXACTLY the same keys and the same structure as the input. "
            "Same array lengths, same nested object keys. Translate only the human-readable values.\n"
            "- Translate every piece of free text into natural English, preserving ALL detail: every "
            "named client, production, tool, number, date and claim survives the translation. Losing "
            "detail is the one unacceptable outcome -- if a phrase is hard to render, translate it "
            "plainly rather than dropping or summarising it.\n"
            "- Add nothing. Never introduce a fact, a qualifier or an achievement that isn't in the input.\n"
            "- Leave proper nouns exactly as written: company, school, production, brand and product "
            "names are not translated ('Televisió de Catalunya' stays 'Televisió de Catalunya'). "
            "Keep a credential's official name, and add a short English gloss in parentheses only if "
            "the original name alone would be meaningless to an English reader.\n"
            "- Country and language names DO become English ('España' -> 'Spain', 'Español' -> 'Spanish').\n"
            "- Text already in English is returned unchanged, character for character.\n"
            "- Preserve nulls as null and empty arrays as empty arrays. Never fill a gap."
        )
        strict_json_suffix = (
            "\n\nRespond with ONLY the JSON object. No markdown code fences, no preamble, "
            "no commentary. The response must start with '{' and end with '}'."
        )
        body = {
            "model": self.config.claude_model,
            "system": system + strict_json_suffix,
            "messages": [
                {
                    "role": "user",
                    "content": "PROFILE DATA TO TRANSLATE:\n\n"
                    + json.dumps(payload, ensure_ascii=False)[:12000],
                }
            ],
            "temperature": 0.0,
            "max_tokens": 2048,
        }

        log.info("Claude translation request START model=%s", self.config.claude_model)

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Claude translation retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            return retry_with_backoff(lambda: self._request_once(body), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ClaudeError):
                raise cause from exc
            raise ClaudeError(f"Claude translation failed after retries: {cause if cause else exc}") from exc

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
