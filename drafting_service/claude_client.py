"""Claude (Anthropic) chat client (REST)."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Optional

import requests

from config import Config
from logger import get_logger

log = get_logger(__name__)


class ClaudeError(RuntimeError):
    """Raised when the Claude API call fails."""


@dataclass
class Completion:
    """A single chat completion result plus lightweight telemetry."""

    text: str
    model: str
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    latency_ms: int


_STRICT_JSON_SUFFIX = (
    "\n\nRespond with ONLY the JSON object. No markdown code fences, no preamble, "
    "no commentary, no explanation before or after it. The response must start "
    "with '{' and end with '}'."
)


def _extract_json_text(text: str) -> str:
    """Best-effort salvage of a JSON object out of stray markdown fences/preamble.

    Anthropic has no `json_mode` flag equivalent to Groq's
    `response_format={"type": "json_object"}`; the strict-JSON guarantee is
    replicated by instructing the model in the prompt (see _STRICT_JSON_SUFFIX)
    and validating the shape here before returning it to the caller, which
    still does its own json.loads() salvage in draft_generator._parse().
    """
    stripped = text.strip()
    try:
        json.loads(stripped)
        return stripped
    except json.JSONDecodeError:
        pass
    start, end = stripped.find("{"), stripped.rfind("}")
    if 0 <= start < end:
        candidate = stripped[start : end + 1]
        json.loads(candidate)  # raises if still not valid; caller/retry loop handles it
        return candidate
    raise json.JSONDecodeError("No JSON object found in model output", stripped, 0)


class ClaudeClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._session = requests.Session()
        self._session.headers.update(
            {
                "x-api-key": cfg.api_key,
                "anthropic-version": cfg.anthropic_version,
                "Content-Type": "application/json",
            }
        )

    def chat(
        self,
        system: str,
        user: str,
        *,
        model: Optional[str] = None,
        temperature: float = 0.5,
        json_mode: bool = False,
        max_tokens: int = 1024,
    ) -> Completion:
        """Run one chat completion. Set json_mode to force a JSON object."""
        model = model or self.cfg.gen_model
        system_prompt = system + _STRICT_JSON_SUFFIX if json_mode else system
        body: dict = {
            "model": model,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        last_exc: Optional[Exception] = None
        for attempt in range(1, self.cfg.max_retries + 1):
            started = time.monotonic()
            try:
                resp = self._session.post(
                    self.cfg.base_url, json=body, timeout=self.cfg.request_timeout
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise ClaudeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                resp.raise_for_status()
                data = resp.json()
                latency_ms = int((time.monotonic() - started) * 1000)
                content_blocks = data.get("content", [])
                text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
                if json_mode:
                    text = _extract_json_text(text)
                usage = data.get("usage", {}) or {}
                return Completion(
                    text=text,
                    model=data.get("model", model),
                    prompt_tokens=usage.get("input_tokens"),
                    completion_tokens=usage.get("output_tokens"),
                    latency_ms=latency_ms,
                )
            except (requests.RequestException, ClaudeError, KeyError, ValueError, json.JSONDecodeError) as exc:
                last_exc = exc
                if attempt >= self.cfg.max_retries:
                    break
                delay = self.cfg.retry_backoff_base ** (attempt + 1)
                log.warning(
                    "Claude call failed (attempt %d/%d): %s — retrying in %.1fs",
                    attempt,
                    self.cfg.max_retries,
                    exc,
                    delay,
                )
                time.sleep(delay)

        raise ClaudeError(f"Claude call failed after {self.cfg.max_retries} attempts: {last_exc}")
