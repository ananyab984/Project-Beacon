"""Tests for parsers/language_filter.py's looks_non_english_token, and its
wiring into linkedin_parser.py's Services extraction and orchestrator.py's
_merge_parallel_fields Services path.

Confirmed live: a real profile's BrightData `skills` list held both an
English tag and its own-language duplicate side by side ("Teamwork" and
"Trabalho em equipe"), and unlike Parallel's Services path (translated via
orchestrator.py's _normalize_parallel_language before it's read),
BrightData's structured `skills` list had no language normalization at all
-- both were joined straight into Services.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_language_filter.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from orchestrator import EnrichmentOrchestrator
from parsers.language_filter import looks_non_english_token
from parsers.linkedin_parser import LinkedInParser


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def test_looks_non_english_token_catches_european_language_marker_words():
    assert looks_non_english_token("Trabalho em equipe") is True
    assert looks_non_english_token("Tłumaczenie") is True
    assert looks_non_english_token("Teamwork") is False
    assert looks_non_english_token("Translation") is False


def test_looks_non_english_token_catches_non_latin_script():
    assert looks_non_english_token("翻訳") is True
    assert looks_non_english_token("Перевод") is True
    assert looks_non_english_token("Adobe Premiere Pro") is False


def test_linkedin_parser_drops_non_english_skill_but_keeps_english_duplicate():
    profile = {
        "name": "Jane Doe",
        "skills": [{"name": "Teamwork"}, {"name": "Trabalho em equipe"}, {"name": "Translation"}],
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Services"] == "Teamwork, Translation"


def test_parallel_merge_drops_non_english_skill_as_defensive_backstop():
    lead = {"Source": "PROZ", "Services": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"skills": ["Subtitling", "Traduction et sous-titrage"]},
    )
    assert lead["Services"] == "Subtitling"
