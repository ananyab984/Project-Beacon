"""Tests for the Ada (Audio Description Association UK) directory parser.

Uses real captured Ada directory profile markdown from
POC's/Ada_poc/ada_raw_content.json (13 real scraped profiles) wherever a
real shape is available -- including its Brazil-via-+55-phone-prefix
detection, Canada-via-"based in" detection, and Polish secondary-language
detection -- plus synthesized inputs for patterns the real fixture set
doesn't happen to exercise (the "since YYYY" years-of-experience fallback,
the ALL-CAPS header .title()-casing, and empty/malformed inputs).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.ada_parser import AdaParser

REPO_ROOT = Path(__file__).resolve().parents[2]
ADA_FIXTURE = REPO_ROOT / "POC's" / "Ada_poc" / "ada_raw_content.json"

PROFILE_LINK = "https://www.audiodescription.co.uk/directory-ow-1/jane-doe"


def _load_fixture() -> list:
    with open(ADA_FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def _by_link_suffix(rows: list, suffix: str) -> dict:
    for row in rows:
        if row["profile_link"].endswith(suffix):
            return row
    raise AssertionError(f"No fixture row ending in {suffix!r}")


# ---------------------------------------------------------------------------
# Real fixture cases
# ---------------------------------------------------------------------------

def test_real_fixture_anne_hornsby_full_profile_with_years_and_uk_default():
    rows = _load_fixture()
    row = _by_link_suffix(rows, "anne-hornsby")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})

    assert result["Source"] == "Ada"
    assert result["Full_Name"] == "Anne Hornsby"
    assert result["First_Name"] == "Anne"
    assert result["Email_Address"] == "mindseyedescription@gmail.com"
    assert result["Contact_Number"] == "07889232438"
    assert result["Services"].startswith("Audio Description, Screen")
    assert result["Years_of_Exp"] == 20
    assert result["Country_of_Residence"] == "United Kingdom"
    assert result["Source_Language"] == "English"
    assert result["Target_Language"] == "English"


def test_real_fixture_alicja_tokarska_polish_secondary_language_and_freelance_vendor():
    rows = _load_fixture()
    row = _by_link_suffix(rows, "alicja-tokarska")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})

    assert result["Full_Name"] == "Alicja Tokarska"
    assert result["Vendor_Experience"] == "Freelance"
    assert result["Source_Language"] == "English, Polish"
    assert result["Target_Language"] == "English, Polish"
    assert result["Secondary_Languages"] == "Polish"
    assert "Contact_Number" not in result


def test_real_fixture_ana_clara_brazil_detected_via_phone_prefix():
    """+55 phone prefix drives country detection to Brazil when the 'based
    in' text pattern isn't present -- a real production case, not a
    contrived one."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "ana-clara-teixeira-caribe")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})

    assert result["Full_Name"] == "Ana Clara Teixeira Caribe"
    assert result["Contact_Number"] == "+5571984862907"
    assert result["Country_of_Residence"] == "Brazil"


def test_real_fixture_rebecca_singh_canada_detected_via_based_in_text():
    rows = _load_fixture()
    row = _by_link_suffix(rows, "rebecca-singh")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})
    assert result["Country_of_Residence"] == "Canada"


def test_real_fixture_joanna_myers_phone_with_internal_space():
    """Phone regex fullmatches '[+\\d][\\d\\s]{5,}' -- a UK landline written
    with a space in the middle still matches in full."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "joanna-myers")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})
    assert result["Contact_Number"] == "01844 355263"


def test_real_fixture_sarah_borges_vendor_experience_client_list():
    rows = _load_fixture()
    row = _by_link_suffix(rows, "sarah-borges")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})
    assert result["Vendor_Experience"] == "Netflix, NBC Universal, Turner, Disney, TCM, Apple, and Amazon"


def test_real_fixture_susanna_meese_no_email_field_omitted():
    """One real profile has no mailto link at all -- Email_Address must be
    omitted rather than set to None or an empty string."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "susanna-meese")
    parser = AdaParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})
    assert "Email_Address" not in result
    assert "Contact_Number" not in result


# ---------------------------------------------------------------------------
# Synthetic: structural / empty edge cases
# ---------------------------------------------------------------------------

def test_empty_raw_content_returns_source_and_link_only():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": ""})
    assert result == {"Source": "Ada", "Profile_Link": PROFILE_LINK}


def test_dict_without_raw_content_key_returns_source_and_link_only():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"unrelated": "x"})
    assert result == {"Source": "Ada", "Profile_Link": PROFILE_LINK}


def test_raw_data_as_plain_string_is_used_directly():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, "# Jane Doe\n[jane@example.com](mailto:jane@example.com)\nWorking in AD since 2016.")
    assert result["Full_Name"] == "Jane Doe"
    assert result["Email_Address"] == "jane@example.com"
    assert result["Years_of_Exp"] == 10  # REFERENCE_YEAR (2026) - 2016


# ---------------------------------------------------------------------------
# Synthetic: name casing
# ---------------------------------------------------------------------------

def test_all_caps_header_name_is_title_cased():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# JANE DOE\nSome bio text."})
    assert result["Full_Name"] == "Jane Doe"


def test_mixed_case_header_name_is_kept_verbatim():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane McDoe\nSome bio text."})
    assert result["Full_Name"] == "Jane McDoe"


# ---------------------------------------------------------------------------
# Synthetic: years-of-experience "since YYYY" fallback
# ---------------------------------------------------------------------------

def test_since_year_fallback_computes_years_from_reference_year():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nWorking in audio description since 2010."})
    assert result["Years_of_Exp"] == 16  # 2026 - 2010


def test_explicit_years_pattern_takes_precedence_over_since_year():
    parser = AdaParser()
    raw = "# Jane Doe\nOver 5 years of experience, working in AD since 2010."
    result = parser.parse(PROFILE_LINK, {"raw_content": raw})
    assert result["Years_of_Exp"] == 5


# ---------------------------------------------------------------------------
# Synthetic: vendor experience "freelance" fallback
# ---------------------------------------------------------------------------

def test_freelance_mention_used_as_vendor_experience_fallback():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nI work as a freelance audio describer."})
    assert result["Vendor_Experience"] == "Freelance"


def test_no_vendor_experience_signal_omits_field():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nNo employment history disclosed here."})
    assert "Vendor_Experience" not in result


def test_quirk_freelance_word_boundary_match_ignores_surrounding_negation():
    """Documents an existing quirk: '_extract_vendor_exp' matches the bare
    word 'freelance' anywhere in the body with no negation awareness, so
    text merely mentioning 'freelance' in passing (even inside a phrase
    stating the opposite) still sets Vendor_Experience to 'Freelance'."""
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nNo freelance info provided here."})
    assert result["Vendor_Experience"] == "Freelance", (
        "This asserts the current (arguably undesirable) behavior, not that it is correct."
    )


# ---------------------------------------------------------------------------
# Synthetic: country default and language detection
# ---------------------------------------------------------------------------

def test_country_defaults_to_united_kingdom_with_no_signal():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nNo location text here."})
    assert result["Country_of_Residence"] == "United Kingdom"


def test_language_detection_finds_multiple_foreign_languages():
    parser = AdaParser()
    raw = "# Jane Doe\nFluent in French, German and Italian in addition to English."
    result = parser.parse(PROFILE_LINK, {"raw_content": raw})
    assert result["Source_Language"] == "English, French, German, Italian"
    assert result["Secondary_Languages"] == "French, German, Italian"


def test_no_foreign_language_mention_defaults_to_english_only_no_secondary():
    parser = AdaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nA UK-based audio describer."})
    assert result["Source_Language"] == "English"
    assert result["Target_Language"] == "English"
    assert "Secondary_Languages" not in result
