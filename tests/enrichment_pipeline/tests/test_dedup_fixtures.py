"""Dedup ("Danny M rule") tests against real fixture data, not idealized
records -- ProZ_Enrichment_Test_Cases_Formatted.xlsx's 10 real test cases,
and explicit cross-source (LinkedIn/ProZ/recruiter-tracker) identity
resolution, since that's what find_duplicate_candidates actually has to
reconcile before a 2,000+ lead import can be trusted.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from core.dedup import find_duplicate_candidates

REPO_ROOT = Path(__file__).resolve().parents[2]
PROZ_FIXTURE = REPO_ROOT / "Documents" / "ProZ_Enrichment_Test_Cases_Formatted.xlsx"


def _load_proz_fixture_rows() -> list[dict]:
    """Loads the real 10 test cases (TC01-TC10) as plain lead dicts, keeping
    only the fields core/dedup.py actually looks at. The fixture uses the
    literal string "[Missing Input]" for every unfilled field -- that's kept
    verbatim (not cleaned up here) since exercising the dedup logic against
    that exact real placeholder text is the point of these tests."""
    wb = openpyxl.load_workbook(PROZ_FIXTURE)
    ws = wb["ProZ_Test_Cases"]
    rows = list(ws.iter_rows(values_only=True))
    headers = rows[0]
    fields = {"First_Name", "Full_Name", "Country_of_Residence", "Source", "Profile_Link",
              "Contact_Number", "Email_Address", "Services", "Source_Language",
              "Target_Language", "Secondary_Languages", "Years_of_Exp", "Vendor_Experience"}
    leads = []
    for row in rows[1:]:
        record = dict(zip(headers, row))
        leads.append({k: v for k, v in record.items() if k in fields})
    return leads


class StubDedupClient:
    """Same stub as test_dedup.py -- records every call, never hits Groq."""

    def __init__(self, stub_response: dict | None = None):
        self.stub_response = stub_response or {"matches": []}
        self.call_count = 0

    def find_matches(self, tested_lead, candidates):
        self.call_count += 1
        return self.stub_response


def test_real_proz_fixture_ten_cases_load_and_run_without_crashing():
    """The real fixture's 10 distinct people (different names/countries/
    services) must never be flagged against each other, and must not crash
    the pipeline despite most fields being the literal "[Missing Input]"
    placeholder rather than empty/None."""
    leads = _load_proz_fixture_rows()
    assert len(leads) == 10, f"Expected 10 real ProZ test cases, got {len(leads)}"

    stub = StubDedupClient()
    res = find_duplicate_candidates(leads, client=stub)
    assert res == [], (
        f"Expected zero duplicates among 10 genuinely distinct ProZ fixture rows, got {res}"
    )
    print("✅ test_real_proz_fixture_ten_cases_load_and_run_without_crashing passed")


def test_placeholder_missing_input_is_not_treated_as_a_real_matching_value():
    """Regression test for the real bug found while building this fixture
    suite: two leads that both simply lack an email/phone (stored as the
    literal "[Missing Input]" string, exactly as the real tracker data does)
    must NOT be exact-matched against each other -- that was a live false
    positive (100% confidence, zero AI review) before core/dedup.py's
    _clean_text_field fix."""
    stub = StubDedupClient()  # would record a call if blocking let this through
    leads = [
        {"Full_Name": "Jens Burgert", "Email_Address": "[Missing Input]", "Contact_Number": "[Missing Input]"},
        {"Full_Name": "Maria Rossi", "Email_Address": "[Missing Input]", "Contact_Number": "[Missing Input]"},
    ]
    res = find_duplicate_candidates(leads, client=stub)
    assert res == [], f"Placeholder text must never produce an exact-match duplicate, got {res}"
    print("✅ test_placeholder_missing_input_is_not_treated_as_a_real_matching_value passed")


def test_placeholder_full_name_does_not_cause_bogus_blocking():
    """Two leads with a literal placeholder Full_Name (e.g. a row where even
    the name is unfilled) must not be blocked-in against each other purely
    because they share the same placeholder text -- that would waste an AI
    call on two records with no real signal in common."""
    stub = StubDedupClient()
    leads = [
        {"Full_Name": "[Missing Input]", "Email_Address": "alice@example.com"},
        {"Full_Name": "[Missing Input]", "Email_Address": "bob@different.com"},
    ]
    res = find_duplicate_candidates(leads, client=stub)
    assert res == [], f"Expected no candidates, got {res}"
    assert stub.call_count == 0, "Placeholder-name-only overlap must not reach the AI stage"
    print("✅ test_placeholder_full_name_does_not_cause_bogus_blocking passed")


def test_cross_source_identity_resolution_linkedin_vs_prozs_vs_recruiter_tracker():
    """The actual scenario this module exists for: the same real person
    entered independently via three different sources (a recruiter's own
    tracker, ProZ, and LinkedIn), each with slightly different formatting,
    must be flagged as a candidate for human review regardless of source."""
    stub_data = {
        "matches": [
            {"candidate_index": 0, "confidence": 0.92, "matched_fields": ["Full_Name", "Country_of_Residence"],
             "reasoning": "Same name, same country, phone formatting differs only by country code."},
            {"candidate_index": 1, "confidence": 0.9, "matched_fields": ["Full_Name", "Country_of_Residence"],
             "reasoning": "Same name, same country."},
        ]
    }
    stub = StubDedupClient(stub_response=stub_data)
    leads = [
        {
            "Full_Name": "Amara Okonkwo", "Source": "Recruiter Tracker",
            "Contact_Number": "+234-803-555-0192", "Country_of_Residence": "Nigeria",
            "Services": "Subtitling",
        },
        {
            "Full_Name": "Amara Okonkwo", "Source": "ProZ",
            "Profile_Link": "https://proz.com/profile/amara-o", "Country_of_Residence": "Nigeria",
            "Services": "Subtitling, Translation",
        },
        {
            "Full_Name": "Amara Okonkwo", "Source": "LinkedIn",
            "Profile_Link": "https://linkedin.com/in/amara-okonkwo", "Country_of_Residence": "Nigeria",
            "Services": "Translation",
        },
    ]
    res = find_duplicate_candidates(leads, threshold=0.8, client=stub)
    # 3 pairwise matches: ProZ-vs-Tracker (lead 1's 1-item shortlist), then
    # LinkedIn-vs-Tracker AND LinkedIn-vs-ProZ (lead 2's 2-item shortlist).
    assert len(res) == 3, f"Expected all 3 cross-source pairs flagged, got {res}"
    sources_involved = {leads[c["lead_a_index"]]["Source"] for c in res} | {leads[c["lead_b_index"]]["Source"] for c in res}
    assert sources_involved == {"Recruiter Tracker", "ProZ", "LinkedIn"}, (
        f"Expected all three sources represented in the flagged pairs, got {sources_involved}"
    )
    print("✅ test_cross_source_identity_resolution_linkedin_vs_prozs_vs_recruiter_tracker passed")


def test_distinct_people_same_source_are_never_flagged():
    """Two genuinely different people submitted through the same source
    (both ProZ, in this case) must not be flagged just because they share a
    source -- source alone is never a matching signal."""
    stub = StubDedupClient()
    leads = [
        {"Full_Name": "Wioletta Kowalski", "Source": "ProZ", "Email_Address": "wioletta@example.com"},
        {"Full_Name": "Marcus Chen", "Source": "ProZ", "Email_Address": "marcus@other.com"},
    ]
    res = find_duplicate_candidates(leads, client=stub)
    assert res == []
    assert stub.call_count == 0
    print("✅ test_distinct_people_same_source_are_never_flagged passed")


if __name__ == "__main__":
    test_real_proz_fixture_ten_cases_load_and_run_without_crashing()
    test_placeholder_missing_input_is_not_treated_as_a_real_matching_value()
    test_placeholder_full_name_does_not_cause_bogus_blocking()
    test_cross_source_identity_resolution_linkedin_vs_prozs_vs_recruiter_tracker()
    test_distinct_people_same_source_are_never_flagged()
