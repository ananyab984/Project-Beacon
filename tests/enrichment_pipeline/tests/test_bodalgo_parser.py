"""Tests for the Bodalgo voiceover/translation profile parser.

Uses real captured Bodalgo profile markdown from
POC's/bodalogo_dataset_poc/bodalgo_raw_content.json (10 real scraped
profiles, including 3 "That page has gone (for good)" dead-profile pages)
wherever real shapes are available, plus synthesized inputs to exercise
patterns the real fixture set doesn't happen to cover (e.g. the "over N
years" / "more than N years" YEARS_OF_EXP_PATTERNS variants, the
"deleted permanently" short-circuit, and the "You are about to flag this
profile" body truncation).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.bodalgo_parser import BodalgoParser

REPO_ROOT = Path(__file__).resolve().parents[2]
BODALGO_FIXTURE = REPO_ROOT / "POC's" / "bodalogo_dataset_poc" / "bodalgo_raw_content.json"

PROFILE_LINK = "https://www.bodalgo.com/en/voice-over-talents/jane-doe"


def _load_fixture() -> list:
    with open(BODALGO_FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def _by_link_suffix(rows: list, suffix: str) -> dict:
    for row in rows:
        if row["profile_link"].endswith(suffix):
            return row
    raise AssertionError(f"No fixture row ending in {suffix!r}")


# ---------------------------------------------------------------------------
# Real fixture: full/complete profiles
# ---------------------------------------------------------------------------

def test_real_fixture_elea_petit_full_profile():
    """Real captured profile with name, mother tongue, voice-usage tags +
    service keywords, and a vendor/clients list -- but no explicit
    'N years experience' phrasing, so Years_of_Exp is legitimately absent."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "elea-petit")
    parser = BodalgoParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})

    assert result["Source"] == "Bodalgo"
    assert result["Full_Name"] == "Elea Petit"
    assert result["First_Name"] == "Elea"
    assert result["Source_Language"] == "French (France)"
    assert "Commercials" in result["Services"]
    assert "Dubbing" in result["Services"]
    assert "Translation" in result["Services"]
    assert result["Vendor_Experience"].startswith("Chanel, Google, Nike")
    assert "Years_of_Exp" not in result


def test_real_fixture_yolanda_widiana_santi_has_years_and_secondary_language():
    rows = _load_fixture()
    row = _by_link_suffix(rows, "yolanda-widiana-santi")
    parser = BodalgoParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})

    assert result["Full_Name"] == "Yolanda Widiana Santi"
    assert result["Source_Language"] == "Indonesian"
    assert result["Secondary_Languages"] == "English"
    assert result["Years_of_Exp"] == 10
    assert "Vendor_Experience" in result


def test_real_fixture_victoria_deanda_fifteen_years():
    rows = _load_fixture()
    row = _by_link_suffix(rows, "victoria-deanda")
    parser = BodalgoParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})
    assert result["Full_Name"] == "Victoria DeAnda"
    assert result["Years_of_Exp"] == 15


# ---------------------------------------------------------------------------
# Real fixture: dead / gone profiles
# ---------------------------------------------------------------------------

def test_real_fixture_gone_profile_yields_source_and_link_only():
    """3 of the 10 real captured profiles are 'That page has gone (for
    good)' dead pages -- the '# ' header filter (excluding lines containing
    'gone') correctly finds no name, and nothing else downstream matches."""
    rows = _load_fixture()
    row = _by_link_suffix(rows, "rebeca-badia")
    assert "# That page has gone (for good)." in row["raw_content"]

    parser = BodalgoParser()
    result = parser.parse(row["profile_link"], {"raw_content": row["raw_content"]})
    assert result == {"Source": "Bodalgo", "Profile_Link": row["profile_link"]}


# ---------------------------------------------------------------------------
# Synthetic: short-circuits and structural edge cases
# ---------------------------------------------------------------------------

def test_empty_raw_content_returns_source_and_link_only():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": ""})
    assert result == {"Source": "Bodalgo", "Profile_Link": PROFILE_LINK}


def test_deleted_permanently_marker_short_circuits():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nThis profile has been deleted permanently."})
    assert result == {"Source": "Bodalgo", "Profile_Link": PROFILE_LINK}


def test_dict_without_raw_content_key_returns_only_source_and_link():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"unrelated": "x"})
    assert result == {"Source": "Bodalgo", "Profile_Link": PROFILE_LINK}


def test_raw_data_as_plain_string_is_used_directly():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, "# Jane Doe\nOver 12 years experience as a voice actor.")
    assert result["Full_Name"] == "Jane Doe"
    assert result["Years_of_Exp"] == 12


def test_flag_profile_boilerplate_excluded_from_vendor_exp_search():
    """_extract_body truncates at 'You are about to flag this profile' so
    that boilerplate never leaks into Vendor_Experience matching."""
    parser = BodalgoParser()
    raw = (
        "# Jane Doe\n"
        "My clients include Acme Corp, Globex.\n"
        "You are about to flag this profile. This means we will investigate."
    )
    result = parser.parse(PROFILE_LINK, {"raw_content": raw})
    assert result["Vendor_Experience"] == "Acme Corp, Globex."
    assert "flag" not in result["Vendor_Experience"].lower()


# ---------------------------------------------------------------------------
# Synthetic: Years_of_Exp pattern variants
# ---------------------------------------------------------------------------

def test_years_pattern_more_than_phrasing():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nMore than 8 years working in the industry."})
    assert result["Years_of_Exp"] == 8


def test_years_pattern_plus_years_of_experience_phrasing():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\n5+ years of experience in voiceover."})
    assert result["Years_of_Exp"] == 5


def test_no_years_mention_omits_field():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nA talented voice actor."})
    assert "Years_of_Exp" not in result


# ---------------------------------------------------------------------------
# Synthetic: services extraction (bracketed voice-usage tags + keyword scan)
# ---------------------------------------------------------------------------

def test_services_combines_bracket_tags_and_keyword_matches_deduped():
    parser = BodalgoParser()
    raw = (
        "# Jane Doe\n"
        "Voice usage[Commercials](url) • [Dubbing](url)Pitch Alto\n"
        "I also offer subtitling and dubbing services with translation experience.\n"
    )
    result = parser.parse(PROFILE_LINK, {"raw_content": raw})
    services = result["Services"].split(", ")
    assert "Commercials" in services
    assert "Dubbing" in services
    # "Dubbing" appears once even though both the bracket tag and the
    # SERVICE_KEYWORDS "dubbing" keyword would otherwise add it twice.
    assert services.count("Dubbing") == 1
    assert "Subtitling" in services
    assert "Translation" in services


def test_no_services_found_omits_field():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nNothing relevant here."})
    assert "Services" not in result


# ---------------------------------------------------------------------------
# Synthetic: mother tongue / foreign language extraction
# ---------------------------------------------------------------------------

def test_mother_tongues_takes_first_bracketed_entry_only():
    parser = BodalgoParser()
    raw = "# Jane Doe\nMother tongues[Spanish (Spain)](url) • [English (neutral)](url)Dialects Madrid\n"
    result = parser.parse(PROFILE_LINK, {"raw_content": raw})
    assert result["Source_Language"] == "Spanish (Spain)"


def test_no_mother_tongues_label_omits_source_language():
    parser = BodalgoParser()
    result = parser.parse(PROFILE_LINK, {"raw_content": "# Jane Doe\nNo language info here."})
    assert "Source_Language" not in result
