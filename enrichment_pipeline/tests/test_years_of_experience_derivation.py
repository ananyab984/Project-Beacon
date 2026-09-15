"""Tests for _years_of_experience_from_parallel_entries -- deriving a
years-of-experience figure from Parallel's structured `experience` list
(start_date/end_date/is_current) when nothing more direct was found.

Confirmed live 2026-09-10: a real lead (Divya Shyam) had a full, correctly
extracted Parallel experience history (two roles with real dates, one
current) but Years_of_Exp still showed "Not found -- add manually", because
nothing in the pipeline ever turned that experience list into a number.
Stage 6 (the other path that could fill it) skips leads that already have
several real fields, which is exactly this lead's case.

Deliberately a career-SPAN derivation (earliest start year to latest end
year), never a count-based estimate -- see linkedin_parser.py's own
_extract_years_of_experience docstring for why "count x 2" was rejected
there, and POC/linkedin_poc/async_experiment.py's years_from_experience()
for the reference span-based approach this adapts to Parallel's cleaner,
already-structured fields.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_years_of_experience_derivation.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from orchestrator import EnrichmentOrchestrator


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def test_real_lead_shape_computes_the_correct_span():
    # Mirrors the actual Divya Shyam case: a current role starting 2025-06-01
    # and a past role 2020-10-01 to 2022-05-01. Career span (2020 -> current
    # year), not a sum of the two roles' individual durations.
    from datetime import date

    experience = [
        {"company": "Global3", "title": "Recruiter", "start_date": "2025-06-01", "end_date": None, "is_current": True},
        {"company": "BYJU'S", "title": "Senior Associate - content development", "start_date": "2020-10-01", "end_date": "2022-05-01", "is_current": False},
    ]
    result = _orch()._years_of_experience_from_parallel_entries(experience)
    assert result == date.today().year - 2020


def test_is_current_flag_counts_as_this_year_even_without_present_wording():
    from datetime import date

    experience = [{"start_date": "2018", "end_date": None, "is_current": True}]
    result = _orch()._years_of_experience_from_parallel_entries(experience)
    assert result == date.today().year - 2018


def test_present_wording_in_end_date_also_counts_as_this_year():
    # Defensive: is_current might be False/missing due to model
    # inconsistency even though end_date literally says "Present".
    from datetime import date

    experience = [{"start_date": "2015", "end_date": "Present", "is_current": False}]
    result = _orch()._years_of_experience_from_parallel_entries(experience)
    assert result == date.today().year - 2015


def test_two_closed_roles_use_earliest_start_to_latest_end():
    experience = [
        {"start_date": "2020-10-01", "end_date": "2022-05-01", "is_current": False},
        {"start_date": "2010", "end_date": "2015", "is_current": False},
    ]
    result = _orch()._years_of_experience_from_parallel_entries(experience)
    assert result == 2022 - 2010


def test_verbatim_non_iso_dates_still_extract_a_year():
    # ExperienceEntry's own schema documents dates as verbatim human text,
    # not always ISO -- "Mar 2020", "2020" must work too, not just full dates.
    experience = [{"start_date": "Mar 2020", "end_date": "2020-03", "is_current": False}]
    result = _orch()._years_of_experience_from_parallel_entries(experience)
    assert result == 0  # same year on both ends -- honest zero, not fabricated


def test_no_parseable_dates_returns_none_not_a_fabricated_number():
    experience = [{"company": "Acme", "title": "Something", "start_date": None, "end_date": None}]
    assert _orch()._years_of_experience_from_parallel_entries(experience) is None


def test_empty_or_missing_experience_list_returns_none():
    assert _orch()._years_of_experience_from_parallel_entries([]) is None
    assert _orch()._years_of_experience_from_parallel_entries(None) is None


def test_non_dict_entries_in_the_list_are_skipped_not_crashed_on():
    experience = ["not a dict", {"start_date": "2019", "end_date": "2021", "is_current": False}, 42]
    result = _orch()._years_of_experience_from_parallel_entries(experience)
    assert result == 2
