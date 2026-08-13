"""Central configuration for the AI Message Drafting Layer."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv(override=False)


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc


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
    """Immutable, validated configuration for a pipeline run."""

    api_key: str
    gen_model: str = _DEFAULT_CLAUDE_MODEL
    base_url: str = "https://api.anthropic.com/v1/messages"
    anthropic_version: str = "2023-06-01"

    gen_temperature: float = 0.5
    request_timeout: int = 60
    max_retries: int = 4
    retry_backoff_base: float = 2.0

    log_level: str = "INFO"
    keepalive_enabled: bool = False
    keepalive_url: str = "http://127.0.0.1:8001"
    keepalive_interval_seconds: int = 600

    def masked_key(self) -> str:
        """Return the API key with the middle redacted, safe for logging."""
        if not self.api_key:
            return "<empty>"
        if len(self.api_key) <= 8:
            return "*" * len(self.api_key)
        return f"{self.api_key[:4]}...{self.api_key[-4:]}"


def load_config(require_api_key: bool = True) -> Config:
    """Build and validate Config from environment variables."""
    api_key = os.getenv("CLAUDE_API_KEY", "").strip()
    if require_api_key and not api_key:
        raise ConfigError(
            "CLAUDE_API_KEY is not set. Add your Claude API key to .env."
        )

    return Config(
        api_key=api_key,
        gen_model=_resolve_claude_model(os.getenv("CLAUDE_MODEL", "")),
        gen_temperature=_get_float("GEN_TEMPERATURE", 0.5),
        request_timeout=_get_int("REQUEST_TIMEOUT", 60),
        max_retries=_get_int("MAX_RETRIES", 4),
        retry_backoff_base=_get_float("RETRY_BACKOFF_BASE", 2.0),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
        keepalive_enabled=(os.getenv("KEEPALIVE_ENABLED", "true" if os.getenv("KEEPALIVE_URL", "").strip() else "false").strip().lower() != "false"),
        keepalive_url=os.getenv("KEEPALIVE_URL", "http://127.0.0.1:8001").strip(),
        keepalive_interval_seconds=_get_int("KEEPALIVE_INTERVAL_SECONDS", 600),
    )
