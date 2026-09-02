"""Tests for Config / load_config env-var parsing and validation.

The real .env in this repo carries live API keys, and config.py calls
load_dotenv() at import time -- so by the time this file runs, os.environ
may already hold real secrets. Every test clears the relevant vars first via
an autouse fixture, then sets only what that test needs, to keep results
independent of whatever happens to be in the real environment.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config, ConfigError, load_config

_ENV_VARS = [
    "BRIGHTDATA_API_KEY", "DATASET_ID", "TAVILY_API_KEY", "CLAUDE_API_KEY",
    "GROQ_API_KEY", "CLAY_WEBHOOK_URL", "CLAUDE_MODEL", "GROQ_MODEL",
    "REQUEST_TIMEOUT", "MAX_RETRIES", "LOG_LEVEL", "DEDUP_MATCH_THRESHOLD",
    "KEEPALIVE_URL", "KEEPALIVE_ENABLED", "KEEPALIVE_INTERVAL_SECONDS",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def _set_required_keys(monkeypatch):
    monkeypatch.setenv("BRIGHTDATA_API_KEY", "bd")
    monkeypatch.setenv("TAVILY_API_KEY", "tv")
    monkeypatch.setenv("CLAUDE_API_KEY", "ck")


def test_load_config_defaults_when_nothing_set(monkeypatch):
    _set_required_keys(monkeypatch)
    cfg = load_config()
    assert cfg.dataset_id == "gd_l1viktl72bvl7bjuj0"
    assert cfg.groq_api_key == ""
    assert cfg.clay_webhook_url == ""
    assert cfg.claude_model == "claude-haiku-4-5-20251001"
    assert cfg.groq_model == "llama-3.3-70b-versatile"
    assert cfg.request_timeout == 60
    assert cfg.max_retries == 3
    assert cfg.log_level == "INFO"
    assert cfg.dedup_match_threshold == 0.8
    assert cfg.keepalive_enabled is False
    assert cfg.keepalive_url == "http://127.0.0.1:8000"
    assert cfg.keepalive_interval_seconds == 600


def test_load_config_require_keys_false_never_raises_even_when_all_missing(monkeypatch):
    cfg = load_config(require_keys=False)
    assert cfg.brightdata_api_key == ""
    assert cfg.tavily_api_key == ""
    assert cfg.claude_api_key == ""


def test_load_config_require_keys_true_raises_when_missing(monkeypatch):
    with pytest.raises(ConfigError) as exc_info:
        load_config(require_keys=True)
    msg = str(exc_info.value)
    assert "BRIGHTDATA_API_KEY" in msg
    assert "TAVILY_API_KEY" in msg
    assert "CLAUDE_API_KEY" in msg
    assert "GROQ_API_KEY" not in msg, "Groq key is optional and must never be required"


def test_load_config_require_keys_true_passes_when_all_present(monkeypatch):
    _set_required_keys(monkeypatch)
    cfg = load_config(require_keys=True)
    assert cfg.brightdata_api_key == "bd"
    assert cfg.tavily_api_key == "tv"
    assert cfg.claude_api_key == "ck"


def test_load_config_require_keys_true_reports_only_the_missing_subset(monkeypatch):
    monkeypatch.setenv("BRIGHTDATA_API_KEY", "bd")
    monkeypatch.setenv("TAVILY_API_KEY", "tv")
    # CLAUDE_API_KEY intentionally left unset.
    with pytest.raises(ConfigError) as exc_info:
        load_config(require_keys=True)
    msg = str(exc_info.value)
    assert "CLAUDE_API_KEY" in msg
    assert "BRIGHTDATA_API_KEY" not in msg
    assert "TAVILY_API_KEY" not in msg


@pytest.mark.parametrize("alias,resolved", [
    ("haiku", "claude-haiku-4-5-20251001"),
    ("HAIKU", "claude-haiku-4-5-20251001"),
    ("sonnet", "claude-sonnet-5"),
    ("Opus", "claude-opus-5"),
])
def test_claude_model_alias_resolution(monkeypatch, alias, resolved):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("CLAUDE_MODEL", alias)
    cfg = load_config()
    assert cfg.claude_model == resolved


def test_claude_model_unset_defaults_to_haiku(monkeypatch):
    _set_required_keys(monkeypatch)
    cfg = load_config()
    assert cfg.claude_model == "claude-haiku-4-5-20251001"


def test_claude_model_non_alias_passes_through_verbatim(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("CLAUDE_MODEL", "claude-custom-experimental")
    cfg = load_config()
    assert cfg.claude_model == "claude-custom-experimental"


def test_groq_model_override(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("GROQ_MODEL", "custom-groq-model")
    cfg = load_config()
    assert cfg.groq_model == "custom-groq-model"


def test_request_timeout_and_max_retries_parsed_as_ints(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("REQUEST_TIMEOUT", "120")
    monkeypatch.setenv("MAX_RETRIES", "5")
    cfg = load_config()
    assert cfg.request_timeout == 120
    assert cfg.max_retries == 5


def test_log_level_uppercased(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("LOG_LEVEL", "debug")
    cfg = load_config()
    assert cfg.log_level == "DEBUG"


@pytest.mark.parametrize("raw,expected", [
    ("0.5", 0.5),
    ("0", 0.0),
    ("1", 1.0),
])
def test_dedup_match_threshold_within_range_passes_through(monkeypatch, raw, expected):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("DEDUP_MATCH_THRESHOLD", raw)
    cfg = load_config()
    assert cfg.dedup_match_threshold == expected


def test_dedup_match_threshold_above_one_is_clamped(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("DEDUP_MATCH_THRESHOLD", "1.5")
    cfg = load_config()
    assert cfg.dedup_match_threshold == 1.0


def test_dedup_match_threshold_below_zero_is_clamped(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("DEDUP_MATCH_THRESHOLD", "-0.3")
    cfg = load_config()
    assert cfg.dedup_match_threshold == 0.0


def test_keepalive_disabled_by_default_when_url_unset(monkeypatch):
    _set_required_keys(monkeypatch)
    cfg = load_config()
    assert cfg.keepalive_url == "http://127.0.0.1:8000"
    assert cfg.keepalive_enabled is False


def test_keepalive_enabled_by_default_when_url_is_set(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("KEEPALIVE_URL", "https://example.com/keepalive")
    cfg = load_config()
    assert cfg.keepalive_url == "https://example.com/keepalive"
    assert cfg.keepalive_enabled is True


def test_keepalive_can_be_explicitly_disabled_even_with_url_set(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("KEEPALIVE_URL", "https://example.com/keepalive")
    monkeypatch.setenv("KEEPALIVE_ENABLED", "false")
    cfg = load_config()
    assert cfg.keepalive_enabled is False


def test_keepalive_enabled_flag_is_case_insensitive_for_false(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("KEEPALIVE_URL", "https://example.com/keepalive")
    monkeypatch.setenv("KEEPALIVE_ENABLED", "FALSE")
    cfg = load_config()
    assert cfg.keepalive_enabled is False


def test_keepalive_interval_seconds_override(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("KEEPALIVE_INTERVAL_SECONDS", "30")
    cfg = load_config()
    assert cfg.keepalive_interval_seconds == 30


def test_dataset_id_override(monkeypatch):
    _set_required_keys(monkeypatch)
    monkeypatch.setenv("DATASET_ID", "custom_dataset")
    cfg = load_config()
    assert cfg.dataset_id == "custom_dataset"


def test_masked_key_empty():
    cfg = Config(brightdata_api_key="", dataset_id="d", tavily_api_key="t", claude_api_key="c")
    assert cfg.masked_key("") == "<empty>"


def test_masked_key_short_key_fully_masked():
    cfg = Config(brightdata_api_key="x", dataset_id="d", tavily_api_key="t", claude_api_key="c")
    assert cfg.masked_key("abcdefgh") == "*" * 8


def test_masked_key_long_key_shows_prefix_and_suffix():
    cfg = Config(brightdata_api_key="x", dataset_id="d", tavily_api_key="t", claude_api_key="c")
    assert cfg.masked_key("sk-ant-api03-verylongsecretkey1234") == "sk-a...1234"


def test_config_is_frozen_and_immutable():
    cfg = Config(brightdata_api_key="x", dataset_id="d", tavily_api_key="t", claude_api_key="c")
    with pytest.raises(Exception):
        cfg.brightdata_api_key = "changed"


def test_config_error_is_a_runtime_error():
    assert issubclass(ConfigError, RuntimeError)
