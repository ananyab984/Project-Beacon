"""Tests for the ATA (American Translators Association) directory parser."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.ata_parser import AtaParser

PROFILE_LINK = "https://www.atanet.org/member-directory/john-smith/"


def test_full_profile_extracts_name_email_phone_and_country():
    parser = AtaParser()
    raw_content = (
        "# John Smith\n\n"
        "Certified translator based in the United States.\n\n"
        "Email: john.smith@example.com\n"
        "Phone: +1 512-555-0142\n"
    )
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert result["Source"] == "ATA"
    assert result["Profile_Link"] == PROFILE_LINK
    assert result["Full_Name"] == "John Smith"
    assert result["First_Name"] == "John"
    assert result["Email_Address"] == "john.smith@example.com"
    # Quirk: the phone regex's [\s\d-]{7,} is greedy over whitespace, so when
    # the match runs to the end of the content it swallows the trailing
    # newline too -- documented here rather than silently stripped.
    assert result["Contact_Number"] == "+1 512-555-0142\n"
    assert result["Country_of_Residence"] == "United States"


def test_country_detected_via_usa_abbreviation():
    parser = AtaParser()
    raw_content = "# Jane Roe\nLocated in Austin, TX USA.\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert result["Country_of_Residence"] == "United States"


def test_no_country_mention_omits_field():
    parser = AtaParser()
    raw_content = "# Jane Roe\nCertified Spanish<>English translator.\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert "Country_of_Residence" not in result


def test_country_extraction_never_defaults_unconditionally():
    """Regression guard: an earlier version of _extract_country returned
    'United States' unconditionally regardless of whether the text said so.
    Two branches must produce genuinely different results."""
    parser = AtaParser()
    with_country = parser.parse(PROFILE_LINK, {"raw_content": "# A\nBased in the United States."})
    without_country = parser.parse(PROFILE_LINK, {"raw_content": "# A\nBased in France."})
    assert with_country.get("Country_of_Residence") == "United States"
    assert "Country_of_Residence" not in without_country


def test_header_mentioning_ata_case_insensitive_is_skipped():
    parser = AtaParser()
    raw_content = "# ATA Member Directory\n# Real Name\nBio text.\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert result["Full_Name"] == "Real Name"


def test_quirk_name_containing_ata_substring_is_also_skipped():
    """Documents an existing quirk: the header filter checks for the
    substring 'ata' anywhere in the line (case-insensitive) to avoid
    matching directory-title headers like '# ATA Directory' -- but this
    also incidentally skips any real name that happens to contain 'ata'
    as a substring, e.g. 'Natasha'."""
    parser = AtaParser()
    raw_content = "# Natasha Petrov\nBio text with no other heading.\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw_content})
    assert "Full_Name" not in result, (
        "Natasha' contains the substring 'ata', so the current header filter "
        "skips it -- this test documents that behavior, it is not asserting "
        "it is desirable."
    )


def test_empty_raw_content_returns_source_and_link_only():
    parser = AtaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": ""})
    assert result == {"Source": "ATA", "Profile_Link": PROFILE_LINK}


def test_dict_without_raw_content_key():
    parser = AtaParser()
    result = parser.parse(PROFILE_LINK, {"unrelated": "x"})
    assert result == {"Source": "ATA", "Profile_Link": PROFILE_LINK}


def test_raw_data_as_plain_string_is_used_directly():
    parser = AtaParser()
    result = parser.parse(PROFILE_LINK, "# Mark Lee\nmark@example.com based in the United States")
    assert result["Full_Name"] == "Mark Lee"
    assert result["Email_Address"] == "mark@example.com"
    assert result["Country_of_Residence"] == "United States"


def test_missing_email_and_phone_omit_fields():
    parser = AtaParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Roe\nNo contact info here."})
    assert "Email_Address" not in result
    assert "Contact_Number" not in result
