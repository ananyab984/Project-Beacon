"""Offline sanity tests — run without a Bright Data API key or network.

These exercise the parts of the pipeline that don't need the live API:
URL validation, missing-value handling, the parser (dict AND list shapes),
unmapped-key detection, and the dedup cache logic via a stub client.

Run:  python test_offline.py     (exits non-zero if any assertion fails)
"""

from __future__ import annotations

import json

import pandas as pd

from brightdata_client import EnrichmentError
from logger import configure_logging
from main import ERROR_COLUMN, enrich_dataframe
from parser import COL_PREFIX, enrichment_columns, normalize_response, parse_profile
from utils import (
    is_missing,
    is_valid_linkedin_url,
    normalize_url,
)

configure_logging("WARNING")  # keep test output quiet


def check(name: str, condition: bool) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}")
    if not condition:
        raise AssertionError(name)


def test_url_validation() -> None:
    print("URL validation:")
    check("valid /in/ url", is_valid_linkedin_url("https://www.linkedin.com/in/janedoe/"))
    check("valid without trailing slash", is_valid_linkedin_url("https://linkedin.com/in/jane"))
    check("reject company url", not is_valid_linkedin_url("https://www.linkedin.com/company/foo/"))
    check("reject non-linkedin", not is_valid_linkedin_url("https://example.com/in/jane"))
    check("reject empty", not is_valid_linkedin_url(""))
    check("reject [Missing Input]", not is_valid_linkedin_url("[Missing Input]"))


def test_missing() -> None:
    print("Missing-value detection:")
    check("None is missing", is_missing(None))
    check("blank is missing", is_missing("   "))
    check("[Missing Input] is missing", is_missing("[Missing Input]"))
    check("real value not missing", not is_missing("hello"))
    check("nan is missing", is_missing(float("nan")))


def test_normalize_url() -> None:
    print("URL normalization (dedup key):")
    a = normalize_url("https://www.linkedin.com/in/Jane/")
    b = normalize_url("https://www.linkedin.com/in/Jane")
    check("trailing slash normalized equal", a == b)


def test_parser_dict_and_list() -> None:
    print("Parser (dict + list shapes):")
    with open("sample_response.json", encoding="utf-8") as f:
        raw = json.load(f)

    flat_dict = parse_profile(raw)
    flat_list = parse_profile([raw])  # one-item list must behave identically

    check("dict and list parse identically", flat_dict == flat_list)
    check("full name mapped", flat_dict[f"{COL_PREFIX}Full_Name"] == "Jane Recruiter")
    check("nested company name mapped", flat_dict[f"{COL_PREFIX}Current_Company"] == "Globalization Partners")
    check("nested company website mapped",
          flat_dict[f"{COL_PREFIX}Company_Website"] == "https://www.globalization-partners.com")
    check("followers mapped", flat_dict[f"{COL_PREFIX}Followers"] == "1423")
    check("skills joined (incl. dict item)",
          "Talent Acquisition" in flat_dict[f"{COL_PREFIX}Skills"])
    check("experience serialized to JSON", flat_dict[f"{COL_PREFIX}Experience"].startswith("["))
    check("null public_email -> empty string", flat_dict[f"{COL_PREFIX}Public_Email"] == "")
    check("null phone -> empty string", flat_dict[f"{COL_PREFIX}Phone_Number"] == "")
    check("all enrichment columns present", set(flat_dict) == set(enrichment_columns()))


def test_normalize_edge_cases() -> None:
    print("Parser edge cases:")
    check("empty list -> {}", normalize_response([]) == {})
    check("None -> {}", normalize_response(None) == {})
    empty = parse_profile({})
    check("empty response -> all empty columns", all(v == "" for v in empty.values()))


class _StubClient:
    """Stand-in for BrightDataClient to test dedup + error handling offline."""

    def __init__(self, behavior):
        self.behavior = behavior          # url -> "ok" | "fail"
        self.calls: list[str] = []

    def enrich_profile(self, url: str):
        self.calls.append(url)
        if self.behavior.get(url) == "fail":
            raise EnrichmentError("simulated failure")
        return {"name": f"Person for {url}", "url": url}


def test_batch_dedup_and_errors() -> None:
    print("Batch dedup + error handling (stub client):")
    df = pd.DataFrame(
        {
            "Case_ID": ["A", "B", "C", "D", "E"],
            "Profile_Link": [
                "https://www.linkedin.com/in/dup/",     # first fetch
                "https://www.linkedin.com/in/dup",      # dedup -> cache hit
                "[Missing Input]",                       # missing url
                "https://example.com/in/nope",           # invalid url
                "https://www.linkedin.com/in/broken/",  # simulated API failure
            ],
        }
    )
    stub = _StubClient({"https://www.linkedin.com/in/broken/": "fail"})
    result = enrich_dataframe(df, stub)

    # /in/dup should be fetched exactly once despite appearing twice.
    dup_calls = [c for c in stub.calls if "dup" in c]
    check("duplicate url fetched once", len(dup_calls) == 1)
    check("output keeps all 5 rows", len(result) == 5)
    check("missing url row has error", "Missing URL" in result.loc[2, ERROR_COLUMN])
    check("invalid url row has error", "Invalid URL" in result.loc[3, ERROR_COLUMN])
    check("failed enrichment row has error", "simulated failure" in result.loc[4, ERROR_COLUMN])
    check("successful rows have no error", result.loc[0, ERROR_COLUMN] == "")
    check("original columns preserved", "Case_ID" in result.columns)
    check("enrichment columns added", f"{COL_PREFIX}Full_Name" in result.columns)


def main() -> int:
    tests = [
        test_url_validation,
        test_missing,
        test_normalize_url,
        test_parser_dict_and_list,
        test_normalize_edge_cases,
        test_batch_dedup_and_errors,
    ]
    for t in tests:
        t()
    print("\nAll offline tests PASSED ✅")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
