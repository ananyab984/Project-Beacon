"""Tests for the ProZ search-snippet parser.

Uses the real captured ProZ snippet payloads from
POC's/proz_poc/proz_raw_content.json (5 real profiles pulled via search
snippets, including one with zero extractable signal) wherever a real
shape is available, plus synthesized inputs for patterns the real fixture
set doesn't happen to exercise (missing primary snippet, malformed
raw_data, the vendor-experience localization phrase).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.proz_parser import ProzParser

REPO_ROOT = Path(__file__).resolve().parents[2]
PROZ_FIXTURE = REPO_ROOT / "POC's" / "proz_poc" / "proz_raw_content.json"

PROFILE_LINK = "https://www.proz.com/profile/999999"


def _load_fixture() -> list:
    with open(PROZ_FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def _by_link_suffix(rows: list, suffix: str) -> dict:
    for row in rows:
        if row["profile_link"].endswith(suffix):
            return row
    raise AssertionError(f"No fixture row ending in {suffix!r}")


def _raw_data(row: dict) -> dict:
    return {"primary_snippet": row.get("primary_snippet"), "other_snippets": row.get("other_snippets", [])}


# ---------------------------------------------------------------------------
# Real fixture cases
# ---------------------------------------------------------------------------

def test_real_fixture_name_via_translator_profile_parenthetical_and_multi_source_pair():
    """profile/913793: full name comes from the "(Translator Profile - X)"
    parenthetical in the primary snippet content, and the title contains two
    "X to Spanish" pairs that must be merged into one source list."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "913793")
    parser = ProzParser()
    result = parser.parse(row["profile_link"], _raw_data(row))

    assert result["Source"] == "ProZ"
    assert result["Full_Name"] == "Maria Rojas Navarrete"
    assert result["First_Name"] == "Maria"
    assert result["Source_Language"] == "English, Italian"
    assert result["Target_Language"] == "Spanish"
    assert "Country_of_Residence" not in result
    assert "Services" not in result


def test_real_fixture_name_via_kudoz_title_country_and_services():
    """profile/108627: full name comes from the "X - KudoZ" title pattern in
    an other_snippet, country from the "I am an American... citizen" clause
    (mapped via nationality), and Services from the explicit "Services X."
    sentence."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "108627")
    parser = ProzParser()
    result = parser.parse(row["profile_link"], _raw_data(row))

    assert result["Full_Name"] == "Lamis Maalouf"
    assert result["Country_of_Residence"] == "United States"
    assert result["Services"] == "Translation, Editing/proofreading, Training"
    assert result["Source_Language"] == "English"
    assert result["Target_Language"] == "Arabic"


def test_real_fixture_multi_source_language_pair_with_and_conjunction():
    """profile/1898441: title reads 'English, German and Italian to
    Croatian' -- the comma/and-separated source list must be split into 3
    distinct source languages against a single target."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "1898441")
    parser = ProzParser()
    result = parser.parse(row["profile_link"], _raw_data(row))

    assert result["Source_Language"] == "English, German, Italian"
    assert result["Target_Language"] == "Croatian"


def test_real_fixture_years_of_exp_and_vendor_experience_localization_phrase():
    """translator/3112043: title has '7+ years' and content has the
    'helping to localize X into Y' vendor-experience phrase."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "3112043")
    parser = ProzParser()
    result = parser.parse(row["profile_link"], _raw_data(row))

    assert result["Years_of_Exp"] == 7
    assert result["Vendor_Experience"] == "ProZ.com (localization)"
    assert "Full_Name" not in result


def test_real_fixture_profile_with_no_extractable_signal_returns_source_and_link_only():
    """profile/1217087 has snippet text with no matching pattern for any
    field -- the parser must not fabricate values."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "1217087")
    parser = ProzParser()
    result = parser.parse(row["profile_link"], _raw_data(row))
    assert result == {"Source": "ProZ", "Profile_Link": row["profile_link"]}


# ---------------------------------------------------------------------------
# Synthetic: missing/malformed raw_data
# ---------------------------------------------------------------------------

def test_raw_data_not_a_dict_returns_source_and_link_only():
    parser = ProzParser()
    result = parser.parse(PROFILE_LINK, "not a dict")
    assert result == {"Source": "ProZ", "Profile_Link": PROFILE_LINK}


def test_raw_data_none_returns_source_and_link_only():
    parser = ProzParser()
    result = parser.parse(PROFILE_LINK, None)
    assert result == {"Source": "ProZ", "Profile_Link": PROFILE_LINK}


def test_missing_primary_snippet_still_scans_other_snippets():
    parser = ProzParser()
    raw_data = {
        "primary_snippet": None,
        "other_snippets": [{"title": "Jane Roe - KudoZ", "content": "Some bio."}],
    }
    result = parser.parse(PROFILE_LINK, raw_data)
    assert result["Full_Name"] == "Jane Roe"


def test_empty_other_snippets_list_default():
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "no match here", "content": "no match either"}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert result == {"Source": "ProZ", "Profile_Link": PROFILE_LINK}


# ---------------------------------------------------------------------------
# Synthetic: services never defaults to "Translation" (regression guard)
# ---------------------------------------------------------------------------

def test_services_never_defaults_to_translation_when_absent():
    """Regression guard: an earlier version of _extract_services defaulted
    to 'Translation' whenever nothing matched -- that made every ProZ lead
    look like something was found even when nothing was. Must stay absent."""
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "Some Translator", "content": "A profile with no Services sentence."}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert "Services" not in result


def test_explicit_services_sentence_is_still_captured():
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "x", "content": "Services Translation, Localization, DTP. More text."}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert result["Services"] == "Translation, Localization, DTP"


# ---------------------------------------------------------------------------
# Synthetic: country / nationality mapping
# ---------------------------------------------------------------------------

def test_country_unmapped_nationality_omits_field():
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "x", "content": "I am a Martian citizen with translation experience."}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert "Country_of_Residence" not in result


def test_country_lebanese_nationality_maps_correctly():
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "x", "content": "I am a Lebanese citizen based abroad."}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert result["Country_of_Residence"] == "Lebanon"


# ---------------------------------------------------------------------------
# Synthetic: full_name extraction fallback order
# ---------------------------------------------------------------------------

def test_full_name_prefers_translator_profile_pattern_over_kudoz_pattern():
    """_extract_full_name scans texts (primary title, primary content, then
    each other_snippet) in order and returns on the first match -- if the
    primary content matches the parenthetical pattern, that wins even if a
    later KudoZ-titled snippet has a different name."""
    parser = ProzParser()
    raw_data = {
        "primary_snippet": {"title": "x", "content": "(Translator Profile - Real Name)"},
        "other_snippets": [{"title": "Other Name - KudoZ", "content": ""}],
    }
    result = parser.parse(PROFILE_LINK, raw_data)
    assert result["Full_Name"] == "Real Name"


def test_no_name_pattern_matches_omits_name_fields():
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "Generic title", "content": "Generic content, no name markers."}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert "Full_Name" not in result
    assert "First_Name" not in result


# ---------------------------------------------------------------------------
# Synthetic: years-of-experience requires literal '+'
# ---------------------------------------------------------------------------

def test_years_of_exp_requires_literal_plus_sign():
    parser = ProzParser()
    raw_data = {"primary_snippet": {"title": "x", "content": "5 years experience, no plus sign here."}}
    result = parser.parse(PROFILE_LINK, raw_data)
    assert "Years_of_Exp" not in result
