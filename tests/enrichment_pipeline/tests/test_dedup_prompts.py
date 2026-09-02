"""Tests for the dedup LLM prompt builders (pure string construction)."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from core.dedup_prompts import build_dedup_system_prompt, build_dedup_user_content
from core.schema import CANONICAL_FIELDS


def test_build_dedup_system_prompt_is_static_and_mentions_strict_json():
    prompt = build_dedup_system_prompt()
    assert prompt == build_dedup_system_prompt(), "System prompt must be deterministic/static"
    assert "STRICT" in prompt
    assert '"matches"' in prompt
    assert "candidate_index" in prompt


def test_build_dedup_user_content_no_candidates_marks_first_lead_in_batch():
    tested = {"Full_Name": "Alice"}
    content = build_dedup_user_content(tested, [])
    assert "TESTED LEAD:" in content
    assert "CANDIDATES: (none -- this is the first lead in the batch)" in content
    assert "Full_Name: Alice" in content


def test_build_dedup_user_content_renders_every_canonical_field_for_tested_lead():
    tested = {"Full_Name": "Alice"}
    content = build_dedup_user_content(tested, [])
    for field in CANONICAL_FIELDS:
        assert f"  {field}:" in content


def test_build_dedup_user_content_missing_fields_render_as_empty_marker():
    tested = {"Full_Name": "Alice"}
    content = build_dedup_user_content(tested, [])
    assert "Email_Address: (empty)" in content


def test_build_dedup_user_content_empty_string_value_renders_as_empty_marker():
    tested = {"Full_Name": "Alice", "Email_Address": ""}
    content = build_dedup_user_content(tested, [])
    assert "Email_Address: (empty)" in content


def test_build_dedup_user_content_falsy_but_present_values_are_not_treated_as_empty():
    """0 is a real value distinct from None/"" -- must render literally, not as (empty)."""
    tested = {"Full_Name": "Alice", "Years_of_Exp": 0}
    content = build_dedup_user_content(tested, [])
    assert "Years_of_Exp: 0" in content
    assert "Years_of_Exp: (empty)" not in content


def test_build_dedup_user_content_indexes_candidates_starting_at_zero():
    tested = {"Full_Name": "Alice"}
    candidates = [{"Full_Name": "Bob"}, {"Full_Name": "Carol"}]
    content = build_dedup_user_content(tested, candidates)
    assert "CANDIDATES:" in content
    assert "[0]" in content
    assert "[1]" in content
    assert "Full_Name: Bob" in content
    assert "Full_Name: Carol" in content
    # Candidate ordering preserved: Bob's block must precede Carol's.
    assert content.index("Bob") < content.index("Carol")


def test_build_dedup_user_content_exact_output_for_known_input():
    tested = {"Full_Name": "Alice"}
    candidates = [{"Full_Name": "Bob"}]
    content = build_dedup_user_content(tested, candidates)

    expected_lines = ["TESTED LEAD:"]
    for field in CANONICAL_FIELDS:
        value = tested.get(field)
        expected_lines.append(f"  {field}: {value if value not in (None, '') else '(empty)'}")
    expected_lines.append("")
    expected_lines.append("CANDIDATES:")
    expected_lines.append("\n[0]")
    for field in CANONICAL_FIELDS:
        value = candidates[0].get(field)
        expected_lines.append(f"  {field}: {value if value not in (None, '') else '(empty)'}")
    expected = "\n".join(expected_lines)

    assert content == expected
