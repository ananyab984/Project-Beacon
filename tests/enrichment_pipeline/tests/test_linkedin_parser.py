"""Tests for the LinkedIn (Bright Data) parser -- the largest and most
deeply-nested parser in parsers/, so this file gets the most attention.

Uses real captured Bright Data LinkedIn payloads from
POC's/linkedin_poc/raw_responses.json (10 real profile scrapes, LI01-LI10,
including 2 genuine scrape failures with raw=None and one successful scrape
of a profile with no usable fields at all) for the realistic-input and
missing-data cases -- these real payloads confirm the parser's own comments
that BrightData's LinkedIn dataset frequently omits structured
skills/contact_info sections in production. Synthetic payloads are used to
exercise the deep contact-info search across BrightData's several known
payload shapes, tools/certifications/language-pair free-text mining, and
other helper-function branches the 10 real captures don't happen to cover.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from parsers.linkedin_parser import LinkedInParser

REPO_ROOT = Path(__file__).resolve().parents[2]
LINKEDIN_FIXTURE = REPO_ROOT / "POC's" / "linkedin_poc" / "raw_responses.json"

PROFILE_LINK = "https://www.linkedin.com/in/jane-doe"


def _load_fixture() -> dict:
    with open(LINKEDIN_FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def _by_case_id(case_id: str) -> dict:
    for row in _load_fixture()["results"]:
        if row["case_id"] == case_id:
            return row
    raise AssertionError(f"No fixture row for case {case_id!r}")


# ---------------------------------------------------------------------------
# Real fixture: successful scrapes with sparse data (the common case)
# ---------------------------------------------------------------------------

def test_real_fixture_li01_sparse_profile_country_code_fallback_and_freelance_vendor():
    """LI01 has no about/skills/contact_info at all -- Country_of_Residence
    falls back to country_code, and Vendor_Experience comes from
    current_company.name ('Freelance') alone."""
    row = _by_case_id("LI01")
    parser = LinkedInParser()
    result = parser.parse(row["url"], row["raw"])

    assert result["Source"] == "LinkedIn"
    assert result["Full_Name"] == "Linh Nguyen"
    assert result["First_Name"] == "Linh"
    assert result["Country_of_Residence"] == "VN"
    assert result["Vendor_Experience"] == "Freelance"
    assert "Email_Address" not in result
    assert "Contact_Number" not in result
    assert "Years_of_Exp" not in result


def test_real_fixture_li04_about_snippet_services_and_structured_certifications():
    """LI04 has a real About excerpt (with LinkedIn's own '…' truncation
    already baked in), a 'Spanish to English' headline/about phrasing that
    the language-pair regex picks up, and a structured certifications list."""
    row = _by_case_id("LI04")
    parser = LinkedInParser()
    result = parser.parse(row["url"], row["raw"])

    assert result["Full_Name"] == "Caitlin Mahoney"
    assert result["Country_of_Residence"] == "Stoughton"
    assert result["Vendor_Experience"] == "Caitlin Ackley"
    assert result["Services"] == "Translation"
    assert result["Source_Language"] == "Spanish"
    assert result["Target_Language"] == "English"
    assert "About_Snippet" in result and result["About_Snippet"].startswith("I provide accurate Spanish")


def test_real_fixture_li05_multi_certification_free_text_and_subtitling_service():
    row = _by_case_id("LI05")
    parser = LinkedInParser()
    result = parser.parse(row["url"], row["raw"])

    assert result["Full_Name"] == "Michael Nystrom"
    assert "Subtitling" in result["Services"]
    assert "Translation" in result["Services"]
    assert "TED Translators" in result["Certifications"]


def test_real_fixture_li10_profile_present_but_no_usable_fields():
    """LI10's raw payload is a real BrightData scrape that returned a
    profile dict with only timestamp/input metadata -- no name, no About,
    nothing extractable. Must not crash and must not fabricate a name."""
    row = _by_case_id("LI10")
    parser = LinkedInParser()
    result = parser.parse(row["url"], row["raw"])
    assert result == {"Source": "LinkedIn", "Profile_Link": row["url"]}


# ---------------------------------------------------------------------------
# Real fixture: genuine scrape failures (raw=None)
# ---------------------------------------------------------------------------

def test_real_fixture_li08_li09_failed_scrapes_yield_minimal_record():
    """LI08 and LI09 are real BrightData scrape failures (raw=None) --
    the parser must degrade gracefully to a bare Source+Profile_Link record
    rather than raising."""
    parser = LinkedInParser()
    for case_id in ("LI08", "LI09"):
        row = _by_case_id(case_id)
        assert row["raw"] is None
        result = parser.parse(PROFILE_LINK, row["raw"])
        assert result == {"Source": "LinkedIn", "Profile_Link": PROFILE_LINK}


# ---------------------------------------------------------------------------
# Synthetic: _unwrap variants
# ---------------------------------------------------------------------------

def test_unwrap_dict_passthrough():
    parser = LinkedInParser()
    result = parser.parse(PROFILE_LINK, {"name": "Ann Lee"})
    assert result["Full_Name"] == "Ann Lee"


def test_unwrap_list_of_dict_uses_first_element():
    parser = LinkedInParser()
    result = parser.parse(PROFILE_LINK, [{"name": "Ann Lee"}, {"name": "Someone Else"}])
    assert result["Full_Name"] == "Ann Lee"


def test_unwrap_empty_list_and_non_dict_scalar_yield_minimal_record():
    parser = LinkedInParser()
    assert parser.parse(PROFILE_LINK, []) == {"Source": "LinkedIn", "Profile_Link": PROFILE_LINK}
    assert parser.parse(PROFILE_LINK, "not a profile") == {"Source": "LinkedIn", "Profile_Link": PROFILE_LINK}
    assert parser.parse(PROFILE_LINK, {}) == {"Source": "LinkedIn", "Profile_Link": PROFILE_LINK}


# ---------------------------------------------------------------------------
# Synthetic: deep email/phone contact-info search across known payload shapes
# ---------------------------------------------------------------------------

def test_email_and_phone_from_contact_info_dict_shape():
    profile = {"name": "Jane Doe", "contact_info": {"email": "jane@example.com", "phone": "+33123456789"}}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Email_Address"] == "jane@example.com"
    assert result["Contact_Number"] == "+33123456789"


def test_email_and_phone_from_generic_type_value_contacts_list_shape():
    profile = {
        "name": "Bob Smith",
        "contacts": [{"type": "email", "value": "bob@example.com"}, {"type": "mobile", "value": "+1 555 0100"}],
    }
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Email_Address"] == "bob@example.com"
    assert result["Contact_Number"] == "+1 555 0100"


def test_email_from_plural_emails_list_variant_in_contact_info():
    profile = {"name": "Ann", "contact_info": {"emails": ["first@x.com", "second@x.com"]}}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Email_Address"] == "first@x.com"


def test_phone_from_label_value_generic_contact_shape():
    profile = {"name": "Ann", "contact": [{"label": "Mobile Phone", "value": "+44 20 7946 0958"}]}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Contact_Number"] == "+44 20 7946 0958"


def test_email_falls_back_to_free_text_scan_of_about_when_no_structured_field():
    profile = {"name": "Ann", "about": "Reach me at ann.reach@studio.com for work."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Email_Address"] == "ann.reach@studio.com"


def test_top_level_public_email_takes_priority_over_contact_info_email():
    """_extract_email checks public_email before contact_info.email -- the
    first candidate in the list wins."""
    profile = {"name": "Ann", "public_email": "public@example.com", "contact_info": {"email": "other@example.com"}}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Email_Address"] == "public@example.com"


def test_phone_from_contact_info_dict_with_unrecognized_shape_falls_back_to_str():
    """_stringify's dict branch falls back to str(val) when a contact_info
    dict entry has none of the recognized email/phone/name keys."""
    profile = {"name": "Ann", "phone": {"unrecognized_key": "+1 555 0199"}}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert "+1 555 0199" in result["Contact_Number"]


def test_contact_list_entries_that_are_not_dicts_are_skipped_without_crashing():
    """_contact_info_values silently skips any non-dict entries in a
    contacts/contact list rather than raising -- BrightData has been seen to
    mix in stray non-dict junk in this list."""
    profile = {"name": "Ann", "contacts": ["not a dict", {"type": "email", "value": "ann@example.com"}]}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Email_Address"] == "ann@example.com"


def test_no_email_or_phone_anywhere_omits_both_fields():
    profile = {"name": "Ann", "about": "No contact details in this bio at all."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert "Email_Address" not in result
    assert "Contact_Number" not in result


# ---------------------------------------------------------------------------
# Synthetic: Years_of_Exp across its 3 resolution paths
# ---------------------------------------------------------------------------

def test_years_of_exp_from_explicit_field():
    profile = {"name": "Ann", "years_of_experience": 8}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Years_of_Exp"] == 8


def test_years_of_exp_from_about_text_regex():
    profile = {"name": "Ann", "about": "Freelance translator with 12+ years of experience."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Years_of_Exp"] == 12


def test_years_of_exp_falls_back_to_experience_list_count_estimate():
    """With no explicit field and no regex match, falls back to counting
    experience-array entries at ~2 years per role."""
    profile = {"name": "Ann", "experience": [{"title": "A"}, {"title": "B"}, {"title": "C"}]}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Years_of_Exp"] == 6


def test_years_of_exp_absent_when_no_signal_at_all():
    profile = {"name": "Ann"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert "Years_of_Exp" not in result


# ---------------------------------------------------------------------------
# Synthetic: Tools_Software free-text mining
# ---------------------------------------------------------------------------

def test_tools_software_matched_case_insensitively_from_prose():
    profile = {"name": "Ann", "about": "I am hands-on with ooona and wincaps for subtitling work."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Tools_Software"] == "OOONA, WinCaps"


def test_tools_software_quirk_sdl_trados_and_trados_both_listed():
    """Documents an existing quirk: 'SDL Trados' and the shorter 'Trados'
    are both entries in _KNOWN_TOOLS, and both independently substring-match
    against text containing 'SDL Trados' -- so both appear in Tools_Software
    rather than being deduplicated as the same tool."""
    profile = {"name": "Ann", "about": "Certified in SDL Trados for CAT tool work."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Tools_Software"] == "SDL Trados, Trados"


def test_no_known_tools_mentioned_omits_field():
    profile = {"name": "Ann", "about": "A general translator with no named tools mentioned."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert "Tools_Software" not in result


# ---------------------------------------------------------------------------
# Synthetic: Certifications -- structured takes precedence, free text as fallback
# ---------------------------------------------------------------------------

def test_certifications_structured_field_preferred_over_free_text():
    profile = {
        "name": "Ann",
        "about": "Also OOONA certified.",
        "certifications": [{"title": "ATA Certified Translator"}, {"name": "Cert Two"}],
    }
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Certifications"] == "ATA Certified Translator, Cert Two"


def test_certifications_free_text_fallback_when_no_structured_field():
    profile = {"name": "Ann", "about": "I am memoQ certified and also OOONA certified professional."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Certifications"] == "memoQ Certified, OOONA Certified"


def test_certifications_absent_when_no_structured_or_free_text_signal():
    profile = {"name": "Ann", "about": "No certifications mentioned here."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert "Certifications" not in result


# ---------------------------------------------------------------------------
# Synthetic: language-pair extraction across separator styles
# ---------------------------------------------------------------------------

def test_language_pair_extraction_to_word_separator():
    profile = {"name": "Ann", "headline": "English to Spanish subtitler"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Source_Language"] == "English"
    assert result["Target_Language"] == "Spanish"


def test_language_pair_extraction_dash_separator():
    profile = {"name": "Ann", "headline": "German-English legal translator"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Source_Language"] == "German"
    assert result["Target_Language"] == "English"


def test_language_pair_extraction_never_overrides_structured_skills_services():
    """Source_Language/Target_Language are populated whenever a pair is
    found in free text -- this is independent of Services, which is only
    back-filled from text when no structured skills list is present."""
    profile = {"name": "Ann", "skills": [{"name": "Copywriting"}], "headline": "Japanese to English interpreter"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Services"] == "Copywriting"  # structured skills wins, not overwritten by text scan
    assert result["Source_Language"] == "Japanese"
    assert result["Target_Language"] == "English"


# ---------------------------------------------------------------------------
# Synthetic: Services resolution order (structured skills vs. text fallback)
# ---------------------------------------------------------------------------

def test_services_from_structured_skills_list_of_dicts():
    profile = {"name": "Ann", "skills": [{"name": "Subtitling"}, {"name": "Dubbing"}]}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Services"] == "Subtitling, Dubbing"


def test_services_from_structured_skills_list_of_plain_strings():
    profile = {"name": "Ann", "skills": ["Subtitling", "Voice Over"]}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Services"] == "Subtitling, Voice Over"


def test_services_falls_back_to_text_alias_scan_when_skills_absent():
    """Note: 'closed captioning' independently matches both the 'Closed
    Captioning' and 'Captioning' alias entries (the latter via its
    'captioning' substring alias), so both canonical labels appear -- the
    same non-deduplicating-by-substring quirk seen in Tools_Software."""
    profile = {"name": "Ann", "about": "Experienced in audio description and closed captioning."}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Services"] == "Audio Description, Closed Captioning, Captioning"


# ---------------------------------------------------------------------------
# Synthetic: Current_Title and Vendor_Experience resolution
# ---------------------------------------------------------------------------

def test_current_title_from_current_company_dict():
    profile = {"name": "Ann", "current_company": {"name": "Acme", "title": "Senior Linguist"}}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Current_Title"] == "Senior Linguist"


def test_current_title_falls_back_to_first_experience_entry():
    profile = {"name": "Ann", "experience": [{"title": "Lead Translator"}, {"title": "Junior Translator"}]}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Current_Title"] == "Lead Translator"


def test_vendor_experience_combines_current_company_and_experience_companies_deduped_capped_at_four():
    profile = {
        "name": "Ann",
        "current_company": {"name": "Acme"},
        "experience": [
            {"company": "Acme"},  # duplicate of current_company, must not repeat
            {"company": "Beta"},
            {"company": "Gamma"},
            {"company": "Delta"},
            {"company": "Epsilon"},  # 5th distinct company, must be dropped by the cap
        ],
    }
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    companies = result["Vendor_Experience"].split(", ")
    assert companies == ["Acme", "Beta", "Gamma", "Delta"]


def test_vendor_experience_falls_back_to_plain_company_field():
    profile = {"name": "Ann", "company": "Beta LLC"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Vendor_Experience"] == "Beta LLC"


def test_vendor_experience_current_company_as_plain_string_not_dict():
    """current_company isn't always a {name, title} dict -- BrightData has
    also returned it as a bare company-name string."""
    profile = {"name": "Ann", "current_company": "Acme Inc"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Vendor_Experience"] == "Acme Inc"


def test_services_from_non_list_truthy_skills_scalar():
    """skills is occasionally a bare string rather than a list."""
    profile = {"name": "Ann", "skills": "Translation"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Services"] == "Translation"


def test_language_pair_extraction_normalizes_mismatched_input_casing():
    """_canonical_language maps a match back to _KNOWN_LANGUAGES' canonical
    casing regardless of how the source text was cased."""
    profile = {"name": "Ann", "headline": "ENGLISH to SPANISH translator"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Source_Language"] == "English"
    assert result["Target_Language"] == "Spanish"


# ---------------------------------------------------------------------------
# Synthetic: About_Snippet truncation
# ---------------------------------------------------------------------------

def test_about_snippet_under_max_chars_returned_verbatim_with_whitespace_collapsed():
    profile = {"name": "Ann", "about": "  A   short   bio.  "}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["About_Snippet"] == "A short bio."


def test_about_snippet_over_max_chars_truncated_at_word_boundary_with_ellipsis():
    long_about = ("word " * 100).strip()  # 500 chars, well over the 280 default
    profile = {"name": "Ann", "about": long_about}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    snippet = result["About_Snippet"]
    assert snippet.endswith("...")
    assert len(snippet) <= 283  # 280 + "..."
    assert not snippet[:-3].endswith(" ")  # trailing partial word was dropped at the last space


# ---------------------------------------------------------------------------
# Synthetic: Headline fallback chain and name/first-name handling
# ---------------------------------------------------------------------------

def test_headline_fallback_chain_position_then_title():
    profile = {"name": "Ann", "position": "Staff Interpreter"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Headline"] == "Staff Interpreter"


def test_full_name_key_variant_and_first_name_split():
    profile = {"full_name": "Maria De La Cruz"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert result["Full_Name"] == "Maria De La Cruz"
    assert result["First_Name"] == "Maria"


def test_missing_name_omits_name_fields_but_still_resolves_other_fields():
    profile = {"headline": "Freelance Translator"}
    result = LinkedInParser().parse(PROFILE_LINK, profile)
    assert "Full_Name" not in result
    assert "First_Name" not in result
    assert result["Headline"] == "Freelance Translator"
    assert result["Services"] == "Translation"
