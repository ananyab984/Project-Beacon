"""Tests for build_targeted_prompt -- pure string templating, no mocking needed."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from llm_fallback.prompt_builder import LIST_FIELDS, build_targeted_prompt


def test_field_targets_lists_all_missing_fields():
    prompt = build_targeted_prompt(["Email_Address", "Current_Title"])
    assert "Email_Address, Current_Title" in prompt


def test_years_of_exp_gets_dedicated_evidence_schema_lines():
    # Years_of_Exp requested alone -> years_experience_evidence is the last
    # schema line, so build_targeted_prompt's trailing rstrip(",") strips
    # only its comma; Years_of_Exp's own line (not last) keeps its comma.
    prompt = build_targeted_prompt(["Years_of_Exp"])
    assert '"Years_of_Exp": <integer or null>,' in prompt
    assert '"years_experience_evidence": <exact verbatim quote from the text, or null>' in prompt


def test_years_of_exp_absent_from_schema_when_not_requested():
    # NOTE: the literal string "Years_of_Exp" always appears in the static
    # STRICT RULES boilerplate (rule 4) regardless of whether it was
    # requested -- so we scope the assertion to the JSON schema block only.
    prompt = build_targeted_prompt(["Email_Address"])
    schema_start = prompt.index("{\n")
    schema_end = prompt.index("\n}")
    schema_body = prompt[schema_start:schema_end]
    assert "Years_of_Exp" not in schema_body
    assert "years_experience_evidence" not in schema_body


def test_list_fields_get_array_schema_entries():
    # Each requested alone -> it's the only/last schema line, so its
    # trailing comma is stripped by build_targeted_prompt's rstrip(",").
    for field in LIST_FIELDS:
        prompt = build_targeted_prompt([field])
        assert f'"{field}": [<verbatim substrings from the text>] (empty array if none)' in prompt


def test_plain_field_gets_string_or_null_schema_entry():
    # Only/last field -> trailing comma stripped.
    prompt = build_targeted_prompt(["Current_Title"])
    assert '"Current_Title": <string or null>' in prompt


def test_schema_body_has_no_trailing_comma():
    prompt = build_targeted_prompt(["Current_Title"])
    schema_start = prompt.index("{\n")
    schema_end = prompt.index("\n}")
    schema_body = prompt[schema_start + 2 : schema_end]
    assert not schema_body.rstrip().endswith(","), schema_body


def test_combination_of_years_list_and_plain_fields_all_present():
    fields = ["Years_of_Exp", "Secondary_Languages", "Current_Title"]
    prompt = build_targeted_prompt(fields)
    assert '"Years_of_Exp": <integer or null>,' in prompt
    assert '"Secondary_Languages": [<verbatim substrings from the text>] (empty array if none),' in prompt
    # Current_Title is the last field here, so its trailing comma is stripped.
    assert '"Current_Title": <string or null>' in prompt


def test_years_of_exp_ordered_first_in_schema_regardless_of_input_order():
    prompt = build_targeted_prompt(["Current_Title", "Years_of_Exp"])
    years_pos = prompt.index('"Years_of_Exp":')
    title_pos = prompt.index('"Current_Title":')
    assert years_pos < title_pos


def test_empty_missing_fields_produces_empty_targets_and_schema():
    prompt = build_targeted_prompt([])
    assert "missing target fields if and only if they are EXPLICITLY present in the text: ." in prompt
    assert "{\n\n}" in prompt


def test_prompt_contains_strict_rules_and_json_schema_markers():
    prompt = build_targeted_prompt(["Email_Address"])
    assert "STRICT information-extraction system" in prompt
    assert "Respond with STRICT JSON exactly matching this schema:" in prompt
    assert prompt.strip().endswith("}")
