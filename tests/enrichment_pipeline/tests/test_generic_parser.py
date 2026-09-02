"""Tests for the generic fallback regex-heuristic parser."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.generic_parser import GenericParser

PROFILE_LINK = "https://example.com/profile/123"


def test_full_content_extracts_email_phone_and_years():
    parser = GenericParser()
    raw_data = {
        "raw_content": (
            "Freelance translator with 10+ years experience. "
            "Contact me at jane.doe@example.com or +1 415-555-0100."
        )
    }
    result = parser.parse(PROFILE_LINK, raw_data)
    assert result["Profile_Link"] == PROFILE_LINK
    assert result["Email_Address"] == "jane.doe@example.com"
    assert result["Contact_Number"] == "+1 415-555-0100"
    assert result["Years_of_Exp"] == 10


def test_no_source_field_is_ever_set():
    """GenericParser never claims a Source -- unlike every platform-specific parser."""
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "jane@example.com"})
    assert "Source" not in result


def test_raw_data_as_plain_string_is_used_directly():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, "reach me at bob@example.org")
    assert result["Email_Address"] == "bob@example.org"


def test_empty_raw_content_returns_only_profile_link():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": ""})
    assert result == {"Profile_Link": PROFILE_LINK}


def test_dict_without_raw_content_key_returns_only_profile_link():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"other_key": "value"})
    assert result == {"Profile_Link": PROFILE_LINK}


def test_missing_email_omits_field():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "5+ years experience, no contact info here."})
    assert "Email_Address" not in result


def test_missing_phone_omits_field():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "email me at x@y.com"})
    assert "Contact_Number" not in result


def test_years_pattern_requires_a_literal_plus_sign():
    """'_extract_years_of_exp' requires a literal '+' between digits and 'years' --
    plain '5 years experience' (no plus) does not match."""
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "I have 5 years experience translating."})
    assert "Years_of_Exp" not in result


def test_years_pattern_with_of_experience_phrasing():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "8+ years of experience in subtitling."})
    assert result["Years_of_Exp"] == 8


def test_none_raw_data_stringified_and_finds_nothing():
    parser = GenericParser()
    result = parser.parse(PROFILE_LINK, None)
    assert result == {"Profile_Link": PROFILE_LINK}
