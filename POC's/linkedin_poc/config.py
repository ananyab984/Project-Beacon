"""Central configuration for the Bright Data enrichment pipeline.

All settings are loaded from environment variables (via a ``.env`` file) so that
no secrets ever live in source code. Import :data:`config` for a ready-to-use,
validated singleton, or call :func:`load_config` to build one explicitly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

# Load variables from a local .env file (if present) into the environment.
# Existing environment variables are NOT overridden, so CI/prod values win.
load_dotenv(override=False)


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _get_int(name: str, default: int) -> int:
    """Read an int env var, falling back to ``default`` when unset/blank."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


@dataclass(frozen=True)
class Config:
    """Immutable, validated configuration for a pipeline run."""

    api_key: str
    dataset_id: str

    # Bright Data synchronous scrape endpoint. dataset_id / format are attached
    # as *query parameters* (see brightdata_client), never as body fields.
    base_url: str = "https://api.brightdata.com/datasets/v3/scrape"
    response_format: str = "json"

    request_timeout: int = 60
    max_retries: int = 3
    retry_backoff_base: float = 2.0

    input_path: str = "LinkedIn_Enrichment_Test_Cases.xlsx"
    output_path: str = "enriched_output.xlsx"

    log_level: str = "INFO"

    def masked_key(self) -> str:
        """Return the API key with the middle redacted, safe for logging."""
        if not self.api_key:
            return "<empty>"
        if len(self.api_key) <= 8:
            return "*" * len(self.api_key)
        return f"{self.api_key[:4]}...{self.api_key[-4:]}"


def load_config(require_api_key: bool = True) -> Config:
    """Build and validate a :class:`Config` from the environment.

    Args:
        require_api_key: When True (the default) a missing API key raises
            :class:`ConfigError`. Set False for offline tooling (e.g. parser
            unit tests) that never touches the network.
    """
    api_key = os.getenv("BRIGHTDATA_API_KEY", "").strip()
    dataset_id = os.getenv("DATASET_ID", "").strip()

    if require_api_key and not api_key:
        raise ConfigError(
            "BRIGHTDATA_API_KEY is not set. Copy .env.example to .env and add "
            "your Bright Data API key."
        )
    if not dataset_id:
        raise ConfigError(
            "DATASET_ID is not set. It should be present in .env "
            "(default: gd_l1viktl72bvl7bjuj0)."
        )

    return Config(
        api_key=api_key,
        dataset_id=dataset_id,
        request_timeout=_get_int("REQUEST_TIMEOUT", 60),
        max_retries=_get_int("MAX_RETRIES", 3),
        retry_backoff_base=float(os.getenv("RETRY_BACKOFF_BASE", "2") or 2),
        input_path=os.getenv("INPUT_PATH", "").strip()
        or "LinkedIn_Enrichment_Test_Cases.xlsx",
        output_path=os.getenv("OUTPUT_PATH", "").strip() or "enriched_output.xlsx",
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO",
    )
