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
    # Optional -- Tier 2 enrichment (Stage 3.5), a synchronous Parallel Task
    # Run call (replaces Clay's async webhook dispatch in this exact waterfall
    # position). Runs for EVERY platform, not just LinkedIn: Clay's version of
    # this stage was LinkedIn-gated because Clay rejected any other identifier,
    # and Parallel has no such limitation (its PoC covered ProZ, Bodalgo,
    # ATA/ATAA and Freelancer.com URLs). If this is unset, that stage is a
    # no-op rather than a hard failure, so Parallel is never a required
    # dependency -- same posture Clay had.
    parallel_api_key: str = ""
    # Confirm the exact processor tier name against Parallel's current docs
    # before this ever goes live -- "core" is a placeholder default, inert
    # while parallel_api_key is unset.
    parallel_processor: str = "core"
    # Whole retry+backoff sequence deadline for ONE Parallel call (see
    # core/resilience.py's RetryPolicy -- this bounds retry_with_backoff's
    # OUTER wait via Future.result(timeout=...), on top of whatever
    # parallel_client.py's underlying SDK call itself does). Deliberately NOT
    # tuned to a guessed "typical" Parallel latency anymore -- confirmed live
    # (2026-09-07) that a real "core"-processor Task Run for a LinkedIn
    # profile routinely takes ~150-170s, and TWO successive guesses at "long
    # enough" (150s, then 240s) both still cut the call off right as the real
    # result was landing server-side: the task was genuinely succeeding, our
    # own client-side number just wasn't waiting for it. providers/
    # parallel_client.py's `_run_once` now deliberately omits `timeout=` on
    # the SDK call entirely, deferring to the SDK's own well-engineered
    # default (`parallel.lib._time.DEFAULT_EXECUTE_TIMEOUT_SECONDS` = 3600s,
    # genuinely polls for up to an hour) instead of re-guessing a shorter one
    # -- this OUTER deadline must stay comfortably ABOVE that 3600s ceiling or
    # it would just reintroduce the exact same bug one layer up (abandoning a
    # thread that's still correctly waiting on a call that hasn't actually
    # failed). Kept below orchestrator.py's LEAD_LEVEL_TIMEOUT_SECONDS (3800s)
    # with headroom for Bright Data (15s) + the LLM fallback (15s) in the same
    # lead's pass: 3700s + 15s + 15s = 3730s worst case < 3800s ceiling. In
    # practice, real calls still resolve in ~150-170s -- this ceiling only
    # matters for a genuine outlier, not the expected case.
    parallel_deadline_seconds: float = 3700.0

    # Whole retry+backoff sequence deadline for ONE Tier 3 web-search call
    # (llm_fallback/client.py's search_missing_fields). A single call can run
    # up to 8 server-side search rounds and legitimately takes minutes, so
    # this deliberately isn't the default 15s RetryPolicy -- but unlike
    # Parallel's deadline, there's no SDK-managed poll to defer to here, so
    # 300s is a real, chosen ceiling (not a placeholder pending a better
    # number): comfortably above the multi-round search budget, comfortably
    # below orchestrator.py's LEAD_LEVEL_TIMEOUT_SECONDS headroom for this
    # stage (see that constant's own comment for the full budget math).
    claude_websearch_deadline_seconds: float = 300.0

    # Stage 6 (Claude web search, Tier 3) defaults OFF. Measured across every
    # production run captured in logs: it fired for 28 of 32 leads (88%) --
    # because its gate was measuring a 10-field metric that includes
    # Profile_Link (enriched exactly 0 times ever, it's the input) and
    # Email_Address/Contact_Number (which Stage 6 is itself forbidden from
    # filling, see WEBSEARCH_EXCLUDED_FIELDS) -- and recorded ZERO successes,
    # while costing 91-486s per lead it ran on. The gating metric is fixed
    # (core/enrichment_count.py's count_stage6_fillable_fields), but this stays
    # off by default until it has recorded at least one real success under the
    # corrected gate; flip it on deliberately, not by inheriting a default that
    # was never actually earned.
    stage6_websearch_enabled: bool = False

    brightdata_base_url: str = "https://api.brightdata.com/datasets/v3/scrape"
    tavily_extract_url: str = "https://api.tavily.com/extract"
    tavily_search_url: str = "https://api.tavily.com/search"
    claude_base_url: str = "https://api.anthropic.com/v1/messages"
    anthropic_version: str = "2023-06-01"
    groq_base_url: str = "https://api.groq.com/openai/v1/chat/completions"

    claude_model: str = _DEFAULT_CLAUDE_MODEL
    # Used by the duplicate/identity-resolution stage (core/dedup.py) and by
    # GroqMappingClient's local-text mapping stages (Services classification,
    # remaining-fields fill-only extraction) -- Claude stays reserved for
    # live web search and English normalization, which need its tool support.
    # llama-3.3-70b-versatile was retired from Groq's catalog; confirmed live
    # against the /models endpoint that this one is currently served.
    groq_model: str = "openai/gpt-oss-120b"

    # Per-HTTP-request socket timeout (connect+read). Kept comfortably under
    # the 15s wall-clock deadline enforced in core/resilience.py so it can
    # still act as a real backstop rather than being dead weight -- that
    # 15s ceiling always fires first otherwise, since it bounds the whole
    # attempt+backoff sequence, not just one request.
    request_timeout: int = 10
    # Attempts AFTER the first (4 -> 5 total), matching the retry contract in
    # server/src/lib/retryWithBackoff.ts for system-wide consistency.
    max_retries: int = 4
    log_level: str = "INFO"

    # Bright Data gets its OWN request timeout and wall-clock deadline, because
    # the shared 10s/15s pair above made its retries unreachable: one 10s
    # attempt plus a 1s backoff leaves ~4s of a 15s budget for an attempt that
    # needs 10s, so retry_with_backoff started it and the deadline killed it
    # mid-flight. It effectively got one attempt no matter what max_retries
    # said -- silently defeating the retry that providers/brightdata_client.py's
    # content-free guard explicitly relies on to land on a different
    # residential-proxy session.
    #
    # 30s/60s is sized off measured latency, not guessed: real PoC scrapes ran
    # 5.0-13.5s, four of ten over the old 10s ceiling. 60s leaves room for two
    # full 30s attempts plus backoff. A defended synchronous page scrape is a
    # different animal from a fast JSON API and should not share its budget.
    brightdata_request_timeout: int = 30
    brightdata_deadline_seconds: float = 60.0

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
    parallel_api_key = os.getenv("PARALLEL_API_KEY", "").strip()
    parallel_processor = os.getenv("PARALLEL_PROCESSOR", "core").strip()
    parallel_deadline_seconds = float(os.getenv("PARALLEL_DEADLINE_SECONDS", "3700.0"))
    claude_websearch_deadline_seconds = float(os.getenv("CLAUDE_WEBSEARCH_DEADLINE_SECONDS", "300.0"))

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
        parallel_api_key=parallel_api_key,
        parallel_processor=parallel_processor,
        parallel_deadline_seconds=parallel_deadline_seconds,
        claude_websearch_deadline_seconds=claude_websearch_deadline_seconds,
        stage6_websearch_enabled=(os.getenv("STAGE6_WEBSEARCH_ENABLED", "false").strip().lower() == "true"),
        groq_model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip(),
        request_timeout=int(os.getenv("REQUEST_TIMEOUT", "10")),
        brightdata_request_timeout=int(os.getenv("BRIGHTDATA_REQUEST_TIMEOUT", "30")),
        brightdata_deadline_seconds=float(os.getenv("BRIGHTDATA_DEADLINE_SECONDS", "60.0")),
        max_retries=int(os.getenv("MAX_RETRIES", "4")),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
        dedup_match_threshold=dedup_match_threshold,
        keepalive_enabled=keepalive_enabled,
        keepalive_url=keepalive_url or "http://127.0.0.1:8000",
        keepalive_interval_seconds=keepalive_interval_seconds,
    )
