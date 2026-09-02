"""Tests for verify_against_source -- the "belt-and-suspenders" verbatim
verification pass that nulls out any LLM-extracted value not verifiably
present in the raw source text. Pure function, no network -- no mocking
needed."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from llm_fallback.verifier import verify_against_source


# ---- non-dict / malformed input ----

def test_non_dict_llm_result_returns_empty_dict():
    assert verify_against_source([], "some source text") == {}
    assert verify_against_source("not a dict", "some source text") == {}
    assert verify_against_source(None, "some source text") == {}


def test_empty_llm_result_returns_empty_dict():
    assert verify_against_source({}, "some source text") == {}


# ---- Years_of_Exp (dedicated evidence-quote field) ----

def test_years_of_exp_kept_when_evidence_quote_found_verbatim():
    llm_result = {
        "Years_of_Exp": 5,
        "years_experience_evidence": "5 years of experience",
    }
    src = "I have 5 years of experience in translation."
    verified = verify_against_source(llm_result, src)
    assert verified["Years_of_Exp"] == 5


def test_years_of_exp_evidence_quote_is_case_insensitive():
    llm_result = {"Years_of_Exp": 3, "years_experience_evidence": "THREE YEARS"}
    src = "worked for three years in the field"
    verified = verify_against_source(llm_result, src)
    assert verified["Years_of_Exp"] == 3


def test_years_of_exp_discarded_when_evidence_quote_not_in_source():
    llm_result = {"Years_of_Exp": 10, "years_experience_evidence": "ten years"}
    src = "no mention of experience length here"
    verified = verify_against_source(llm_result, src)
    assert "Years_of_Exp" not in verified


def test_years_of_exp_discarded_when_evidence_quote_missing_entirely():
    llm_result = {"Years_of_Exp": 10}
    src = "10 years of experience"
    verified = verify_against_source(llm_result, src)
    assert "Years_of_Exp" not in verified, "empty evidence quote must not verify"


def test_years_of_exp_discarded_when_evidence_quote_is_empty_string():
    llm_result = {"Years_of_Exp": 10, "years_experience_evidence": ""}
    src = "10 years of experience"
    verified = verify_against_source(llm_result, src)
    assert "Years_of_Exp" not in verified


def test_years_of_exp_non_integer_value_is_dropped_even_with_valid_quote():
    llm_result = {"Years_of_Exp": "not-a-number", "years_experience_evidence": "many years"}
    src = "many years of dedicated service"
    verified = verify_against_source(llm_result, src)
    assert "Years_of_Exp" not in verified


def test_years_of_exp_none_is_skipped_entirely():
    llm_result = {"Years_of_Exp": None, "years_experience_evidence": "5 years"}
    src = "5 years of experience"
    verified = verify_against_source(llm_result, src)
    assert "Years_of_Exp" not in verified


def test_years_of_exp_accepts_numeric_string_and_casts_to_int():
    llm_result = {"Years_of_Exp": "7", "years_experience_evidence": "7 years"}
    src = "has 7 years background"
    verified = verify_against_source(llm_result, src)
    assert verified["Years_of_Exp"] == 7
    assert isinstance(verified["Years_of_Exp"], int)


# ---- Contact_Number (digit-normalized comparison) ----

def test_contact_number_kept_when_digits_match_despite_different_formatting():
    llm_result = {"Contact_Number": "+44 7889 232438"}
    src = "call me at +447889232438 anytime"
    verified = verify_against_source(llm_result, src)
    assert verified["Contact_Number"] == "+44 7889 232438"


def test_contact_number_discarded_when_digits_not_in_source():
    llm_result = {"Contact_Number": "+1 555 000 1111"}
    src = "no phone number mentioned"
    verified = verify_against_source(llm_result, src)
    assert "Contact_Number" not in verified


def test_contact_number_non_string_is_skipped():
    llm_result = {"Contact_Number": 5551234}
    src = "5551234"
    verified = verify_against_source(llm_result, src)
    assert "Contact_Number" not in verified


def test_contact_number_falsy_is_skipped():
    llm_result = {"Contact_Number": ""}
    src = "anything"
    verified = verify_against_source(llm_result, src)
    assert "Contact_Number" not in verified


# ---- LIST_FIELDS (Secondary_Languages, Services) ----

def test_list_field_keeps_only_verbatim_items_and_joins_with_comma():
    llm_result = {"Secondary_Languages": ["French", "German", "Klingon"]}
    src = "She speaks French and German fluently."
    verified = verify_against_source(llm_result, src)
    assert verified["Secondary_Languages"] == "French, German"


def test_list_field_case_insensitive_match():
    llm_result = {"Services": ["translation", "SUBTITLING"]}
    src = "Offers Translation and subtitling services."
    verified = verify_against_source(llm_result, src)
    assert verified["Services"] == "translation, SUBTITLING"


def test_list_field_deduplicates_repeated_items():
    llm_result = {"Services": ["Translation", "Translation"]}
    src = "translation services offered"
    verified = verify_against_source(llm_result, src)
    assert verified["Services"] == "Translation"


def test_list_field_all_items_discarded_key_omitted_entirely():
    llm_result = {"Services": ["Nonexistent Service"]}
    src = "no relevant text here"
    verified = verify_against_source(llm_result, src)
    assert "Services" not in verified


def test_list_field_non_list_value_is_ignored():
    llm_result = {"Services": "Translation"}
    src = "Translation services"
    verified = verify_against_source(llm_result, src)
    assert "Services" not in verified, "a bare string for a LIST_FIELDS key must be ignored, not verified"


def test_list_field_skips_non_string_and_falsy_items():
    llm_result = {"Services": [None, "", 42, "Translation"]}
    src = "translation services"
    verified = verify_against_source(llm_result, src)
    assert verified["Services"] == "Translation"


def test_list_field_empty_list_omits_key():
    llm_result = {"Secondary_Languages": []}
    src = "anything"
    verified = verify_against_source(llm_result, src)
    assert "Secondary_Languages" not in verified


# ---- generic string fields (verbatim, case-insensitive) ----

def test_generic_field_kept_when_verbatim_in_source():
    llm_result = {"Current_Title": "Senior Translator"}
    src = "Works as a Senior Translator at a firm."
    verified = verify_against_source(llm_result, src)
    assert verified["Current_Title"] == "Senior Translator"


def test_generic_field_discarded_when_not_verbatim():
    llm_result = {"Current_Title": "Chief Linguist"}
    src = "Works as a translator."
    verified = verify_against_source(llm_result, src)
    assert "Current_Title" not in verified


def test_generic_field_case_insensitive_and_whitespace_stripped():
    llm_result = {"Email_Address": "  Amara@Example.com  "}
    src = "contact: amara@example.com"
    verified = verify_against_source(llm_result, src)
    assert verified["Email_Address"] == "Amara@Example.com"


def test_generic_field_non_string_value_is_skipped():
    llm_result = {"Some_Number_Field": 42}
    src = "42"
    verified = verify_against_source(llm_result, src)
    assert "Some_Number_Field" not in verified


def test_generic_field_falsy_string_is_skipped():
    llm_result = {"Current_Title": ""}
    src = "anything"
    verified = verify_against_source(llm_result, src)
    assert "Current_Title" not in verified


def test_years_experience_evidence_key_itself_never_leaks_into_output():
    llm_result = {"Years_of_Exp": 5, "years_experience_evidence": "5 years"}
    src = "5 years of solid experience"
    verified = verify_against_source(llm_result, src)
    assert "years_experience_evidence" not in verified


# ---- combined / realistic scenario ----

def test_combined_realistic_extraction_mixed_pass_and_fail():
    llm_result = {
        "Years_of_Exp": 8,
        "years_experience_evidence": "8 years of translation experience",
        "Contact_Number": "+234 803 555 0192",
        "Secondary_Languages": ["French", "Mandarin"],
        "Services": ["Fabricated Service"],
        "Current_Title": "Freelance Translator",
        "Country_of_Residence": "Atlantis",
    }
    src = (
        "Amara has 8 years of translation experience. Reach her at "
        "+234-803-555-0192. She speaks French fluently. "
        "Current role: Freelance Translator based in Nigeria."
    )
    verified = verify_against_source(llm_result, src)
    assert verified["Years_of_Exp"] == 8
    assert verified["Contact_Number"] == "+234 803 555 0192"
    assert verified["Secondary_Languages"] == "French"
    assert "Services" not in verified
    assert verified["Current_Title"] == "Freelance Translator"
    assert "Country_of_Residence" not in verified


def test_none_source_text_treated_as_empty_string_no_crash():
    llm_result = {"Current_Title": "Translator", "Years_of_Exp": 5, "years_experience_evidence": "5 years"}
    verified = verify_against_source(llm_result, None)
    assert verified == {}
