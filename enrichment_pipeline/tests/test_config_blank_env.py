"""A blank env line (`GROQ_MODEL=` in a compose env_file, which is how
.env.docker.example ships these) must read as unset, not as "". Before the
fix, blank MAX_RETRIES/REQUEST_TIMEOUT crashed the service at boot on int(""),
and blank GROQ_MODEL/DATASET_ID became an empty model/dataset that every
provider call was rejected with.

Run: cd enrichment_pipeline && .venv/bin/python -m pytest tests/test_config_blank_env.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import load_config

BLANK_IN_DOCKER_TEMPLATE = [
    "DATASET_ID", "CLAUDE_MODEL", "GROQ_MODEL", "REQUEST_TIMEOUT", "MAX_RETRIES",
    "PARALLEL_PROCESSOR", "PARALLEL_DEADLINE_SECONDS", "KEEPALIVE_URL",
]


def test_blank_values_fall_back_to_defaults(monkeypatch):
    for name in BLANK_IN_DOCKER_TEMPLATE:
        monkeypatch.setenv(name, "")
    cfg = load_config()
    assert cfg.groq_model == "openai/gpt-oss-120b"
    assert cfg.dataset_id == "gd_l1viktl72bvl7bjuj0"
    assert cfg.max_retries == 4 and cfg.request_timeout == 10
    assert cfg.parallel_processor == "core"


def test_a_real_value_still_wins(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "  some/model  ")
    monkeypatch.setenv("MAX_RETRIES", "2")
    cfg = load_config()
    assert cfg.groq_model == "some/model" and cfg.max_retries == 2
