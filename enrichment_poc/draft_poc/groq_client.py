"""Groq chat-completions client (REST, OpenAI-compatible).

A thin wrapper over ``requests`` — no SDK dependency, so the same code runs
anywhere. Handles retries with exponential backoff for transient failures
(HTTP 429 / 5xx / timeouts) and optional strict-JSON responses.

The key never leaves this process; callers pass a :class:`~config.Config`.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import requests

from config import Config
from logger import get_logger

log = get_logger(__name__)


class GroqError(RuntimeError):
    """Raised when the Groq API call ultimately fails."""


@dataclass
class Completion:
    """A single chat completion result plus lightweight telemetry."""

    text: str
    model: str
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int


class GroqClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            }
        )

    def chat(
        self,
        system: str,
        user: str,
        *,
        model: str | None = None,
        temperature: float = 0.5,
        json_mode: bool = False,
        max_tokens: int = 1024,
    ) -> Completion:
        """Run one chat completion. Set ``json_mode`` to force a JSON object."""
        model = model or self.cfg.gen_model
        body: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        last_exc: Exception | None = None
        for attempt in range(1, self.cfg.max_retries + 1):
            started = time.monotonic()
            try:
                resp = self._session.post(
                    self.cfg.base_url, json=body, timeout=self.cfg.request_timeout
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise GroqError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                resp.raise_for_status()
                data = resp.json()
                latency_ms = int((time.monotonic() - started) * 1000)
                choice = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {}) or {}
                return Completion(
                    text=choice,
                    model=data.get("model", model),
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                    latency_ms=latency_ms,
                )
            except (requests.RequestException, GroqError, KeyError, ValueError) as exc:
                last_exc = exc
                if attempt >= self.cfg.max_retries:
                    break
                # Default backoff, but increase delay on 429 rate limit
                delay = self.cfg.retry_backoff_base ** (attempt + 1)
                log.warning(
                    "Groq call failed (attempt %d/%d): %s — retrying in %.1fs",
                    attempt,
                    self.cfg.max_retries,
                    exc,
                    delay,
                )
                time.sleep(delay)

        raise GroqError(f"Groq call failed after {self.cfg.max_retries} attempts: {last_exc}")

    def chat_json(self, system: str, user: str, **kwargs) -> dict:
        """Chat in JSON mode and parse the result into a dict."""
        completion = self.chat(system, user, json_mode=True, **kwargs)
        try:
            return json.loads(completion.text)
        except json.JSONDecodeError as exc:
            # Best-effort salvage: pull the outermost { ... } block.
            text = completion.text
            start, end = text.find("{"), text.rfind("}")
            if 0 <= start < end:
                try:
                    return json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    pass
            raise GroqError(f"Model did not return valid JSON: {exc}\n{text[:300]}") from exc
