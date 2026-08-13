"""Groq REST client for the LLM-based duplicate/identity-resolution stage."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

import requests

from config import Config
from core.dedup_prompts import build_dedup_system_prompt, build_dedup_user_content
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

        for attempt in range(1, self.config.max_retries + 1):
            try:
                resp = self.session.post(
                    self.config.groq_base_url,
                    json=body,
                    timeout=self.config.request_timeout,
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    log.warning(
                        "Dedup Groq request retryable status=%s attempt=%d/%d",
                        resp.status_code, attempt, self.config.max_retries,
                    )
                    if attempt >= self.config.max_retries:
                        raise DedupGroqError(
                            f"Dedup Groq call failed after {self.config.max_retries} attempts: "
                            f"HTTP {resp.status_code}: {resp.text[:200]}"
                        )
                    time.sleep(self.config.retry_backoff_base ** attempt)
                    continue
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                result = json.loads(content)
                if not isinstance(result, dict) or "matches" not in result:
                    raise ValueError(f"Response missing 'matches' key: {content[:200]!r}")
                log.info("Dedup Groq request SUCCESS matches=%d", len(result.get("matches") or []))
                return result
            except DedupGroqError:
                raise
            except Exception as exc:
                if attempt >= self.config.max_retries:
                    raise DedupGroqError(f"Dedup Groq call failed after {self.config.max_retries} attempts: {exc}") from exc
                time.sleep(self.config.retry_backoff_base ** attempt)

        raise DedupGroqError("Dedup Groq call failed")
