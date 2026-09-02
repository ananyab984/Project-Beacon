"""Tests for the ATAA directory parser."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.ataa_parser import AtaaParser

PROFILE_LINK = "https://www.ataa.fr/annuaire/jane-dupont"


def test_full_profile_extracts_name_email_and_phone():
    parser = AtaaParser()
    raw_content = (
        "# Jane Dupont\n\n"
        "Audiovisual translator based in Paris.\n\n"
        "Contact: jane.dupont@example.fr\n"
        "Phone: +33 1 23 45 67 89\n"
    )
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert result["Source"] == "ATAA"
    assert result["Profile_Link"] == PROFILE_LINK
    assert result["Full_Name"] == "Jane Dupont"
    assert result["First_Name"] == "Jane"
    assert result["Email_Address"] == "jane.dupont@example.fr"
    # Quirk: the phone regex's [\s\d-]{7,} is greedy over whitespace, so when
    # the match runs to the end of the content it swallows the trailing
    # newline too -- documented here rather than silently stripped.
    assert result["Contact_Number"] == "+33 1 23 45 67 89\n"


def test_header_mentioning_ataa_is_skipped_in_favor_of_next_header():
    parser = AtaaParser()
    raw_content = "# ATAA Directory\n# Real Name\nSome bio text.\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert result["Full_Name"] == "Real Name"


def test_no_matching_header_omits_name_fields():
    parser = AtaaParser()
    raw_content = "# ATAA Member Page\nNo other heading here."
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert "Full_Name" not in result
    assert "First_Name" not in result


def test_empty_raw_content_returns_source_and_link_only():
    parser = AtaaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": ""})
    assert result == {"Source": "ATAA", "Profile_Link": PROFILE_LINK}


def test_dict_without_raw_content_key():
    parser = AtaaParser()
    result = parser.parse(PROFILE_LINK, {"unrelated": "x"})
    assert result == {"Source": "ATAA", "Profile_Link": PROFILE_LINK}


def test_raw_data_as_plain_string_is_used_directly():
    parser = AtaaParser()
    result = parser.parse(PROFILE_LINK, "# Anna Martin\ncontact anna@example.fr")
    assert result["Full_Name"] == "Anna Martin"
    assert result["Email_Address"] == "anna@example.fr"


def test_single_word_name_first_name_equals_full_name():
    parser = AtaaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Anna\nSome bio."})
    assert result["Full_Name"] == "Anna"
    assert result["First_Name"] == "Anna"


def test_missing_email_and_phone_omit_fields():
    parser = AtaaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Dupont\nNo contact details provided."})
    assert "Email_Address" not in result
    assert "Contact_Number" not in result


def test_name_extraction_only_matches_first_hash_header():
    """The first '# ' line (that doesn't mention 'ataa') wins, even if later
    headers also look like names."""
    parser = AtaaParser()
    raw_content = "# First Person\n# Second Person\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert result["Full_Name"] == "First Person"
