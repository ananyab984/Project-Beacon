"""Central configuration for the Production Enrichment Pipeline."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv

load_dotenv(override=False)

log = logging.getLogger(__name__)


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


# Friendly-name aliases accepted in CLAUDE_MODEL, mapped to real Anthropic model IDs.
_CLAUDE_MODEL_ALIASES = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-5",
    "opus": "claude-opus-5",
}
_DEFAULT_CLAUDE_MODEL = _CLAUDE_MODEL_ALIASES["haiku"]


def _resolve_claude_model(raw: str) -> str:
    """Map a friendly alias (e.g. 'Haiku') to a real Anthropic model ID; pass through anything else."""
    key = (raw or "").strip().lower()
    if not key:
        return _DEFAULT_CLAUDE_MODEL
    return _CLAUDE_MODEL_ALIASES.get(key, raw.strip())


@dataclass(frozen=True)
class Config:
    """Immutable configuration container for pipeline execution."""

    brightdata_api_key: str
    dataset_id: str
    tavily_api_key: str
    claude_api_key: str
    groq_api_key: str = ""
    # Optional -- LinkedIn-only fallback (Stage 3.5). Leads route to Clay only
    # when Bright Data returns nothing at all; if this is unset, that stage is
    # a no-op rather than a hard failure, so Clay is never a required dependency.
    clay_webhook_url: str = ""

    brightdata_base_url: str = "https://api.brightdata.com/datasets/v3/scrape"
    tavily_extract_url: str = "https://api.tavily.com/extract"
    tavily_search_url: str = "https://api.tavily.com/search"
    claude_base_url: str = "https://api.anthropic.com/v1/messages"
    anthropic_version: str = "2023-06-01"
    groq_base_url: str = "https://api.groq.com/openai/v1/chat/completions"

    claude_model: str = _DEFAULT_CLAUDE_MODEL
    # Used only by the duplicate/identity-resolution stage (core/dedup.py) -- a separate
    # provider choice from the rest of the pipeline, which runs on Claude.
    groq_model: str = "llama-3.3-70b-versatile"

    request_timeout: int = 60
    max_retries: int = 3
    retry_backoff_base: float = 2.0
    log_level: str = "INFO"

    # Duplicate/identity-resolution stage ("Danny M rule") -- pairs scoring >= this are
    # flagged for human review, never auto-merged.
    dedup_match_threshold: float = 0.8
    keepalive_enabled: bool = False
    keepalive_url: str = "http://127.0.0.1:8000"
    keepalive_interval_seconds: int = 600

    def masked_key(self, key: str) -> str:
        if not key:
            return "<empty>"
        if len(key) <= 8:
            return "*" * len(key)
        return f"{key[:4]}...{key[-4:]}"


def load_config(require_keys: bool = False) -> Config:
    """Build and validate Config from environment variables."""
    bd_key = os.getenv("BRIGHTDATA_API_KEY", "").strip()
    dataset_id = os.getenv("DATASET_ID", "gd_l1viktl72bvl7bjuj0").strip()
    tavily_key = os.getenv("TAVILY_API_KEY", "").strip()
    claude_key = os.getenv("CLAUDE_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    clay_webhook_url = os.getenv("CLAY_WEBHOOK_URL", "").strip()

    if require_keys:
        missing = []
        if not bd_key:
            missing.append("BRIGHTDATA_API_KEY")
        if not tavily_key:
            missing.append("TAVILY_API_KEY")
        if not claude_key:
            missing.append("CLAUDE_API_KEY")
        if missing:
            raise ConfigError(f"Missing required env vars: {', '.join(missing)}")

    raw_threshold = float(os.getenv("DEDUP_MATCH_THRESHOLD", "0.8"))
    dedup_match_threshold = max(0.0, min(1.0, raw_threshold))
    if dedup_match_threshold != raw_threshold:
        log.warning(
            "DEDUP_MATCH_THRESHOLD=%.4f out of [0,1], clamped to %.4f",
            raw_threshold, dedup_match_threshold,
        )

    keepalive_url = os.getenv("KEEPALIVE_URL", "").strip()
    keepalive_enabled = (os.getenv("KEEPALIVE_ENABLED", "true" if keepalive_url else "false").strip().lower() != "false")
    keepalive_interval_seconds = int(os.getenv("KEEPALIVE_INTERVAL_SECONDS", "600"))

    return Config(
        brightdata_api_key=bd_key,
        dataset_id=dataset_id,
        tavily_api_key=tavily_key,
        claude_api_key=claude_key,
        claude_model=_resolve_claude_model(os.getenv("CLAUDE_MODEL", "")),
        groq_api_key=groq_key,
        clay_webhook_url=clay_webhook_url,
        groq_model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip(),
        request_timeout=int(os.getenv("REQUEST_TIMEOUT", "60")),
        max_retries=int(os.getenv("MAX_RETRIES", "3")),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
        dedup_match_threshold=dedup_match_threshold,
        keepalive_enabled=keepalive_enabled,
        keepalive_url=keepalive_url or "http://127.0.0.1:8000",
        keepalive_interval_seconds=keepalive_interval_seconds,
    )
