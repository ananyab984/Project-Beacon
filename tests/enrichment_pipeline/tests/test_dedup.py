"""Tests for the LLM-based duplicate & identity-resolution stage (Danny M rule)."""

from __future__ import annotations

import json
import os
import sys

# Add parent directory to path so imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

from config import Config, load_config
from core.dedup import find_duplicate_candidates
from core.dedup_client import DedupGroqClient, DedupGroqError


class StubDedupClient:
    """In-memory stub client for testing dedup logic without network calls."""

    def __init__(self, stub_response: dict = None, raise_error: bool = False):
        self.stub_response = stub_response or {"matches": []}
        self.raise_error = raise_error
        self.call_count = 0
        self.history = []

    def find_matches(self, tested_lead: dict, candidates: list[dict]) -> dict:
        self.call_count += 1
        self.history.append((tested_lead, list(candidates)))
        if self.raise_error:
            raise DedupGroqError("Stub error simulating network failure")
        return self.stub_response


def test_missing_groq_key_skips_dedup():
    """Verify that absent GROQ_API_KEY gracefully skips duplicate detection (for leads
    that survive blocking and would otherwise reach the AI stage)."""
    cfg = Config(
        brightdata_api_key="test", dataset_id="test", tavily_api_key="test",
        claude_api_key="test", groq_api_key=""
    )
    leads = [{"Full_Name": "Alice"}, {"Full_Name": "Alice"}]
    res = find_duplicate_candidates(leads, config=cfg)
    assert res == [], f"Expected empty list when key missing, got {res}"
    print("✅ test_missing_groq_key_skips_dedup passed")


def test_exact_email_match_skips_ai_entirely():
    """Step 1: an exact (normalized) email match is flagged immediately -- no AI call."""
    stub = StubDedupClient()  # would raise/record if ever called
    leads = [
        {"Full_Name": "Jordan Lee", "Email_Address": "Jordan.Lee@Example.com"},
        {"Full_Name": "J. Lee", "Email_Address": "jordan.lee@example.com"},  # same email, different case
    ]
    res = find_duplicate_candidates(leads, client=stub)
    assert len(res) == 1, f"Expected exactly 1 exact-match candidate, got {res}"
    assert res[0]["match_reason"] == "exact_match"
    assert res[0]["match_score"] == 1.0
    assert res[0]["matched_fields"] == ["Email_Address"]
    assert stub.call_count == 0, "Exact match must not spend an AI call"
    print("✅ test_exact_email_match_skips_ai_entirely passed")


def test_exact_phone_match_skips_ai_entirely():
    """Step 1: an exact (digits-normalized) phone match is flagged immediately -- no AI call."""
    stub = StubDedupClient()
    leads = [
        {"Full_Name": "Priya Nair", "Contact_Number": "+44 7889 232438"},
        {"Full_Name": "P. Nair", "Contact_Number": "+447889232438"},  # same digits, different spacing
    ]
    res = find_duplicate_candidates(leads, client=stub)
    assert len(res) == 1
    assert res[0]["match_reason"] == "exact_match"
    assert res[0]["matched_fields"] == ["Contact_Number"]
    assert stub.call_count == 0
    print("✅ test_exact_phone_match_skips_ai_entirely passed")


def test_blocking_excludes_unrelated_names_no_ai_call():
    """Step 2: a candidate sharing nothing (no name/email/phone overlap) never reaches the AI."""
    stub = StubDedupClient()
    leads = [
        {"Full_Name": "Wioletta Kowalski", "Email_Address": "wioletta@example.com"},
        {"Full_Name": "Marcus Chen", "Email_Address": "marcus@other.com"},
    ]
    res = find_duplicate_candidates(leads, client=stub)
    assert res == [], f"Expected no candidates for unrelated names, got {res}"
    assert stub.call_count == 0, "Unrelated names should be blocked out before any AI call"
    print("✅ test_blocking_excludes_unrelated_names_no_ai_call passed")


def test_blocked_shortlist_reaches_ai_and_maps_index_correctly():
    """Steps 2-4: a name-blocked (but not exact-match) candidate reaches the AI, and the
    shortlist-relative candidate_index the model returns is correctly mapped back to the
    real batch index."""
    stub_data = {"matches": [{"candidate_index": 0, "confidence": 0.9,
                               "matched_fields": ["Full_Name"], "reasoning": "Same name."}]}
    stub = StubDedupClient(stub_response=stub_data)
    leads = [
        {"Full_Name": "Anastasia Volkov", "Email_Address": "a.volkov@example.com"},
        {"Full_Name": "Anastasia Volkova", "Email_Address": "anastasia.v@different.com"},
    ]
    res = find_duplicate_candidates(leads, threshold=0.8, client=stub)
    assert stub.call_count == 1, "Blocked-in candidate should reach exactly one AI call"
    assert len(res) == 1
    assert res[0]["lead_a_index"] == 1
    assert res[0]["lead_b_index"] == 0, "shortlist position 0 must map back to real batch index 0"
    assert res[0]["match_reason"] == "llm_judgment"
    print("✅ test_blocked_shortlist_reaches_ai_and_maps_index_correctly passed")


def test_threshold_filtering():
    """Verify that matches below threshold are filtered out."""
    stub_data = {
        "matches": [
            {
                "candidate_index": 0,
                "confidence": 0.85,
                "matched_fields": ["Full_Name"],
                "reasoning": "Matching full name.",
            }
        ]
    }
    stub = StubDedupClient(stub_response=stub_data)
    leads = [{"Full_Name": "Alex"}, {"Full_Name": "Alex"}]

    # At threshold 0.80 -> 0.85 passes
    res_80 = find_duplicate_candidates(leads, threshold=0.80, client=stub)
    assert len(res_80) == 1, f"Expected 1 match at threshold 0.80, got {len(res_80)}"
    assert res_80[0]["match_score"] == 0.85
    assert res_80[0]["flagged_for_review"] is True

    # At threshold 0.90 -> 0.85 is filtered
    res_90 = find_duplicate_candidates(leads, threshold=0.90, client=stub)
    assert len(res_90) == 0, f"Expected 0 matches at threshold 0.90, got {len(res_90)}"
    print("✅ test_threshold_filtering passed")


def test_o_n_complexity_call_count():
    """Verify that N leads sharing the same name result in exactly N-1 AI calls (O(n)),
    each seeing only its (blocked+narrowed) shortlist of prior leads."""
    stub = StubDedupClient(stub_response={"matches": []})
    leads = [{"Full_Name": "Taylor Morgan", "Email_Address": f"taylor{i}@example.com"} for i in range(4)]

    find_duplicate_candidates(leads, client=stub)
    assert stub.call_count == 3, f"Expected 3 calls for 4 same-name leads, got {stub.call_count}"

    # Verify candidates list growth: call 0 sees 1 candidate, call 1 sees 2, call 2 sees 3
    assert len(stub.history[0][1]) == 1
    assert len(stub.history[1][1]) == 2
    assert len(stub.history[2][1]) == 3
    print("✅ test_o_n_complexity_call_count passed")


def test_resilience_to_groq_error():
    """Verify that a name-blocked pair reaching the AI stage, whose call then raises
    DedupGroqError, logs a warning and continues without crashing (and without being
    flagged, since no verdict was ever obtained)."""
    stub = StubDedupClient(raise_error=True)
    leads = [{"Full_Name": "Diego Fernandez"}, {"Full_Name": "Diego Fernandez"}]

    res = find_duplicate_candidates(leads, client=stub)
    assert res == [], f"Expected empty result on error, got {res}"
    assert stub.call_count == 1, "The blocked pair should have actually reached the AI call before it errored"
    print("✅ test_resilience_to_groq_error passed")


def run_live_smoke_test():
    """Run live smoke test against Groq API if key is present in environment.

    Uses a similar-but-not-identical name/email pair so the pair must survive blocking +
    narrowing and be judged by the AI (Step 4) rather than being resolved by the Step 1
    exact-match short-circuit -- this is the case that actually exercises the full
    pipeline end to end.
    """
    cfg = load_config(require_keys=False)
    if not cfg.groq_api_key:
        print("⏩ Skipping live Groq smoke test (GROQ_API_KEY not configured)")
        return

    print("🚀 Running live Groq smoke test...")
    leads = [
        {
            "Full_Name": "Danny Miller",
            "Contact_Number": "+1-555-0142",  # no exact-string phone match (see below), but
            "Source": "LinkedIn",             # same person once the AI reasons about formatting
            "Profile_Link": "https://linkedin.com/in/danny-m",
            "Country_of_Residence": "United States",
            "Services": "Translation",
        },
        {
            "Full_Name": "Danny Miller",
            "Contact_Number": "555-0142",  # same number, missing country code -- Step 1's
            "Source": "Bodalgo",           # exact digit-equality check will NOT match this
            "Profile_Link": "https://bodalgo.com/profiles/danny-m",
            "Country_of_Residence": "United States",
            "Services": "Voiceover",
        },
        {
            "Full_Name": "Sarah Connor",
            "Email_Address": "sarah@cyberdyne.com",
            "Source": "ProZ",
            "Profile_Link": "https://proz.com/profile/sarah-c",
            "Services": "Subtitling",
        },
    ]

    client = DedupGroqClient(cfg)
    matches = find_duplicate_candidates(leads, threshold=0.80, client=client)
    print(f"Live Test Output: {len(matches)} duplicate candidate(s) flagged")
    for m in matches:
        print(f"  - Lead [{m['lead_a_index']}] vs [{m['lead_b_index']}]: "
              f"Score={m['match_score']} Reason={m['reasoning']} ({m['match_reason']})")
    assert len(matches) >= 1, "Expected live test to flag the Danny Miller pair"
    assert any(m["match_reason"] == "llm_judgment" for m in matches), \
        "Expected the Danny Miller pair to be resolved by the AI stage, not an exact-field short-circuit"
    flagged_pairs = {(m["lead_a_index"], m["lead_b_index"]) for m in matches}
    assert (2, 0) not in flagged_pairs and (2, 1) not in flagged_pairs, \
        "Sarah Connor must not be flagged against either Danny Miller record"
    print("✅ Live Groq smoke test passed!")


if __name__ == "__main__":
    test_missing_groq_key_skips_dedup()
    test_exact_email_match_skips_ai_entirely()
    test_exact_phone_match_skips_ai_entirely()
    test_blocking_excludes_unrelated_names_no_ai_call()
    test_blocked_shortlist_reaches_ai_and_maps_index_correctly()
    test_threshold_filtering()
    test_o_n_complexity_call_count()
    test_resilience_to_groq_error()
    run_live_smoke_test()
