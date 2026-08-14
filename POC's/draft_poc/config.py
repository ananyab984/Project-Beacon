"""Central configuration for the AI draft-messages POC.

All settings load from environment variables (via a ``.env`` file) so no
secrets ever live in source. Import :data:`config` for a ready-to-use,
validated singleton, or call :func:`load_config` to build one explicitly.
Mirrors the config style used across the other enrichment POCs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

# Load variables from a local .env file (if present). Existing environment
# variables are NOT overridden, so CI/prod values win.
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


@dataclass(frozen=True)
class Config:
    """Immutable, validated configuration for a pipeline run."""

    api_key: str
    gen_model: str = "llama-3.3-70b-versatile"
    judge_model: str = "llama-3.3-70b-versatile"

    # Groq is OpenAI-compatible; this is the chat-completions endpoint.
    base_url: str = "https://api.groq.com/openai/v1/chat/completions"

    gen_temperature: float = 0.5
    request_timeout: int = 60
    max_retries: int = 4
    retry_backoff_base: float = 2.0

    input_path: str = "../Ada_poc/ada_projectbeacon_output.json"
    output_dir: str = "output"

    log_level: str = "INFO"

    def masked_key(self) -> str:
        """Return the API key with the middle redacted, safe for logging."""
        if not self.api_key:
            return "<empty>"
        if len(self.api_key) <= 8:
            return "*" * len(self.api_key)
        return f"{self.api_key[:4]}...{self.api_key[-4:]}"


def load_config(require_api_key: bool = True) -> Config:
    """Build and validate a :class:`Config` from the environment."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if require_api_key and not api_key:
        raise ConfigError(
            "GROQ_API_KEY is not set. Copy .env.example to .env and add your "
            "Groq API key (https://console.groq.com/keys)."
        )

    return Config(
        api_key=api_key,
        gen_model=os.getenv("GROQ_MODEL", "").strip() or "llama-3.3-70b-versatile",
        judge_model=os.getenv("JUDGE_MODEL", "").strip() or "llama-3.3-70b-versatile",
        gen_temperature=_get_float("GEN_TEMPERATURE", 0.5),
        request_timeout=_get_int("REQUEST_TIMEOUT", 60),
        max_retries=_get_int("MAX_RETRIES", 4),
        retry_backoff_base=_get_float("RETRY_BACKOFF_BASE", 2.0),
        input_path=os.getenv("INPUT_PATH", "").strip()
        or "../Ada_poc/ada_projectbeacon_output.json",
        output_dir=os.getenv("OUTPUT_DIR", "").strip() or "output",
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO",
    )
