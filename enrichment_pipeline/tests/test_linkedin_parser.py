"""Tests for the Bright Data LinkedIn parser, against the payload shape the
dataset ACTUALLY returns.

The parser was written against a different revision than the one being served,
and three of its mappings were wrong in ways that produced confidently wrong
data rather than missing data. Every fixture below is a verbatim shape from a
real stored payload.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_linkedin_parser.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parsers.linkedin_parser import (
    LinkedInParser,
    _clean_text,
    _extract_country,
    _extract_years_of_experience,
)


# --- Years_of_Exp was fabricated from a row count ---------------------------
#
# The parser ended with `return len(exp_list) * 2  # Estimate ~2 yrs per role`.
# That number reaches Lead.yearsOfExperience and becomes the drafting grounding
# fact `years_of_experience: "N years"`, quoted back to a real candidate in an
# outreach email. It was the only place in the pipeline that turned
# structurally-empty data into a positive factual claim.

def test_experience_shells_do_not_become_a_years_number():
    """During the empty-schema period this produced "6 years" from three
    objects containing nothing at all."""
    assert _extract_years_of_experience({"experience": [{}, {}, {}]}) is None


def test_real_roles_still_do_not_become_a_years_number():
    """Even with genuine roles, a count is not a duration -- 5 roles is not
    10 years, and the profile never said it was."""
    assert (
        _extract_years_of_experience(
            {"experience": [{"title": "Translator", "company": "Freelance"} for _ in range(5)]}
        )
        is None
    )


def test_an_explicitly_stated_number_is_still_read():
    assert _extract_years_of_experience({"years_of_experience": "8"}) == 8


def test_a_number_stated_in_the_about_text_is_still_read():
    """This path reads something the profile actually claims, so it stays."""
    p = {"about": "Process-oriented senior project manager with 7+ years of experience managing teams"}
    assert _extract_years_of_experience(p) == 7
    assert _extract_years_of_experience({"about": "over 12 years of experience in subtitling"}) == 12


# --- Country held a CITY ----------------------------------------------------
#
# `country or location or country_code` fell through to `location`, which is a
# city in this dataset ("Cairo", "San Francisco"). Country is a recruiter
# filter, so a city in it silently removes the lead from every correct country
# search while looking perfectly populated. Two real rows held "Cairo" and
# "Bengaluru".

def test_country_comes_from_the_city_hierarchy_not_the_city_name():
    for payload, expected in [
        ({"city": "Cairo, Cairo, Egypt", "location": "Cairo", "country_code": "EG"}, "Egypt"),
        ({"city": "San Francisco, California, United States", "location": "San Francisco", "country_code": "US"}, "United States"),
        ({"city": "Bengaluru, Karnataka, India", "location": "Bengaluru", "country_code": "IN"}, "India"),
    ]:
        assert _extract_country(payload) == expected


def test_country_code_is_the_fallback_never_the_city():
    """No `city` to split: a bare country code is at least unambiguously a
    country, where `location` would be a city mislabelled as one."""
    assert _extract_country({"location": "Cairo", "country_code": "EG"}) == "EG"


def test_no_reliable_country_yields_none_rather_than_a_city():
    """An empty field is correctable; a wrong one is not, because it looks
    populated. Parallel supplies a real country name for most leads anyway."""
    assert _extract_country({"location": "Paris"}) is None


# --- HTML entities were never decoded ---------------------------------------

def test_html_entities_are_decoded():
    """A real stored About read "Classical Greek &amp; Latin graduate".
    Drafting quotes these strings back to the candidate, so an undecoded
    entity is a visible defect in a message to a real person."""
    assert _clean_text("Classical Greek &amp; Latin graduate") == "Classical Greek & Latin graduate"
    assert _clean_text("-&gt; driven by curiosity") == "-> driven by curiosity"
    assert _clean_text("it&#39;s") == "it's"
    assert _clean_text(None) is None
    assert _clean_text("   ") is None


# --- end to end on the real payload shape -----------------------------------

OMAIMA = [
    {
        "name": "Omaima Atef",
        "city": "Cairo, Cairo, Egypt",
        "location": "Cairo",
        "country_code": "EG",
        "about": "Classical Greek &amp; Latin graduate with hands-on experience in customer service",
        "position": "",
        "experience": None,
        "education": [{"title": "Cairo University", "start_year": "2021-09", "end_year": "2025-09"}],
        "languages": [{"title": "Arabic", "subtitle": "Native or bilingual proficiency"}],
    }
]


def test_parses_the_real_shape_without_corrupting_country_or_about():
    out = LinkedInParser().parse("https://www.linkedin.com/in/omaima-atef/", OMAIMA)
    assert out["Country_of_Residence"] == "Egypt"
    assert out["About_Snippet"].startswith("Classical Greek & Latin graduate")
    assert "&amp;" not in out["About_Snippet"]
    assert out["Full_Name"] == "Omaima Atef"
    assert "Years_of_Exp" not in out, "no stated number on this profile, so none should be claimed"


def test_headline_is_absent_rather_than_wrong_on_this_dataset():
    """Documented so the next person does not re-debug it: this dataset
    revision has no `headline` key and returns `position` as "", so Bright
    Data legitimately cannot supply Headline. Parallel fills it -- a headline
    is part of the public preview LinkedIn serves without a login."""
    out = LinkedInParser().parse("https://www.linkedin.com/in/omaima-atef/", OMAIMA)
    assert out.get("Headline") is None
