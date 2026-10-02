"""Tests for the per-lead identity check (the "Danny M" case) and the
Years_of_Exp confidence signal.

Both fill schema columns that existed and were never written by anything:
Lead.linkedinMatchConfidence (labelled "Danny M case" in
server/prisma/schema.prisma) and Lead.yoeConfidence.

Run: cd enrichment_pipeline && .venv/bin/python -m pytest tests/test_identity_match.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.dedup import (
    IDENTITY_AMBIGUOUS,
    IDENTITY_CONFIRMED,
    IDENTITY_DIVERGENT,
    IDENTITY_UNKNOWN,
    score_identity_match,
)
from orchestrator import YOE_CONFIDENCE_DERIVED, YOE_CONFIDENCE_STATED, _yoe_confidence


def test_the_danny_m_case_is_ambiguous_not_confirmed():
    """The case the schema column is named for: an initial expands. Compatible
    with the right person AND with a different one, so a human decides."""
    r = score_identity_match("Danny M", "Danny Miller")
    assert r["verdict"] == IDENTITY_AMBIGUOUS
    assert r["confidence"] < 1.0


def test_a_single_name_token_can_never_confirm():
    # "Divya" -> "Divya Shyam" is a real shape in this dataset. One token is
    # far too common to establish identity, however exactly it matches.
    r = score_identity_match("Divya", "Divya Shyam")
    assert r["verdict"] == IDENTITY_AMBIGUOUS
    assert r["confidence"] < 1.0


def test_an_exact_full_name_is_confirmed():
    r = score_identity_match("Marie-Anne HAASSER", "Marie Anne Haasser")
    assert r["verdict"] == IDENTITY_CONFIRMED
    assert r["confidence"] == 1.0


def test_accents_and_case_do_not_break_a_real_match():
    r = score_identity_match("Nádia Morais", "Nadia Morais")
    assert r["verdict"] == IDENTITY_CONFIRMED


def test_a_parenthesised_nickname_is_not_treated_as_a_different_person():
    """Real shapes in this dataset: "Avik (Teddy) Chakraborty", "Enrica
    (Kiki) Di Landro". A raw character-ratio scores the first against "Avik
    Chakraborty" at ~0.79 and would flag a correct match for review."""
    for submitted, resolved in [
        ("Avik (Teddy) Chakraborty", "Avik Chakraborty"),
        ("Enrica (Kiki) Di Landro", "Enrica Di Landro"),
    ]:
        assert score_identity_match(submitted, resolved)["verdict"] == IDENTITY_CONFIRMED, submitted


def test_a_different_person_is_divergent():
    r = score_identity_match("Danny M", "Sarah Chen")
    assert r["verdict"] == IDENTITY_DIVERGENT
    assert r["confidence"] < 1.0


def test_token_reordering_still_matches():
    assert score_identity_match("Haasser Marie", "Marie Haasser")["verdict"] == IDENTITY_CONFIRMED


def test_extra_middle_names_on_the_resolved_side_still_confirm():
    assert score_identity_match("Marie Haasser", "Marie Anne Haasser")["verdict"] == IDENTITY_CONFIRMED


def test_no_name_on_either_side_is_unknown_not_a_failure():
    """A lead nothing identified is already reported by enrichment_status --
    it must not ALSO be reported as an identity mismatch, which would send a
    human to adjudicate a comparison that was never made."""
    for submitted, resolved in [(None, None), ("", ""), ("Alex Anthraper", None), (None, "Alex Anthraper")]:
        r = score_identity_match(submitted, resolved)
        assert r["verdict"] == IDENTITY_UNKNOWN, (submitted, resolved)
        assert r["confidence"] is None


def test_confirmed_is_the_only_verdict_that_scores_a_full_match():
    """The server branches on `verdict`, but the stored confidence must stay
    consistent with it -- nothing short of `confirmed` may score 1.0."""
    for submitted, resolved in [
        ("Danny M", "Danny Miller"),
        ("Divya", "Divya Shyam"),
        ("Danny M", "Sarah Chen"),
        ("Alex Anthraper", "Totally Different"),
    ]:
        r = score_identity_match(submitted, resolved)
        assert r["verdict"] != IDENTITY_CONFIRMED, (submitted, resolved)
        assert r["confidence"] < 1.0, (submitted, resolved)


# --- Years_of_Exp confidence --------------------------------------------

def test_a_number_the_profile_states_out_loud_is_high_confidence():
    lead = {"Years_of_Exp": "30", "About_Snippet": "I have over 30 years of experience in subtitling."}
    assert _yoe_confidence({"Years_of_Exp": "llm_fallback"}, lead) == YOE_CONFIDENCE_STATED


def test_a_number_nothing_states_was_derived_and_is_lower_confidence():
    # Computed from experience date spans: defensible, but career gaps and
    # unrelated roles are both counted in full.
    lead = {"Years_of_Exp": "14", "About_Snippet": "Freelance translator and voice artist."}
    assert _yoe_confidence({"Years_of_Exp": "parallel"}, lead) == YOE_CONFIDENCE_DERIVED


def test_a_different_number_in_the_text_does_not_count_as_stating_this_one():
    lead = {"Years_of_Exp": "14", "About_Snippet": "Worked with 3 years of broadcast experience early on."}
    assert _yoe_confidence({"Years_of_Exp": "parallel"}, lead) == YOE_CONFIDENCE_DERIVED


def test_no_value_resolved_means_no_claim():
    assert _yoe_confidence({}, {"Years_of_Exp": None}) is None
    assert _yoe_confidence({}, {}) is None


def test_a_value_the_lead_arrived_with_is_not_this_runs_claim():
    """`existing` means it came in with the lead and nothing here established
    it -- reporting a confidence would assert something this run never did."""
    lead = {"Years_of_Exp": "12", "About_Snippet": "12 years of experience"}
    assert _yoe_confidence({"Years_of_Exp": "existing"}, lead) is None


def test_an_unparseable_value_yields_no_confidence_rather_than_crashing():
    assert _yoe_confidence({"Years_of_Exp": "parallel"}, {"Years_of_Exp": "lots"}) is None
