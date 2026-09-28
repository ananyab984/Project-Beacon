"""Tests for the Tools_Software / Vendor_Experience fixes.

Both fields were broken in the same two ways before this: (1) the tool list
(`_KNOWN_TOOLS`) had drifted from the recruiter-facing Software Proficiency
dropdown -- missing XL8, Smartcat, Adobe Premiere Pro, DaVinci Resolve, and
others entirely, and misspelling "EZTitle" as "EZTitles" so its own alias
never matched the canonical name; (2) both fields were only ever extracted
by the LinkedIn/BrightData parser -- a Parallel-sourced lead (any non-
LinkedIn source, or LinkedIn itself when the BrightData scrape came back
thin) got neither field at all, mirrored here against
test_parallel_services_extraction.py's existing coverage for Services.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_tools_vendor_extraction.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from orchestrator import EnrichmentOrchestrator
from parsers.linkedin_parser import LinkedInParser
from parsers.tool_aliases import extract_tools_from_text
from parsers.vendor_aliases import extract_vendors_from_text


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


# --- Canonical alias matching now covers the full dropdown list ------------

def test_previously_missing_tools_now_match():
    text = "Experienced with XL8, Smartcat, Adobe Premiere Pro and DaVinci Resolve"
    matched = extract_tools_from_text(text)
    assert "XL8" in matched
    assert "Smartcat" in matched
    assert "Adobe Premiere Pro" in matched
    assert "DaVinci Resolve" in matched


def test_eztitle_alias_spelling_bug_is_fixed():
    # The old list spelled its own entry "EZTitles" -- a profile mentioning
    # the real product name "EZTitle" (no trailing s) never matched it.
    assert extract_tools_from_text("Subtitled using EZTitle for years") == ["EZTitle"]


def test_vendor_aliases_match_known_variants():
    assert extract_vendors_from_text("QC lead at SDI Media for 3 years") == ["SDI"]
    assert extract_vendors_from_text("Worked with Zoo Digital Group and Pixelogic") == ["Pixel Logic", "Zoo Digital"]
    assert extract_vendors_from_text("Just a regular bio with no vendor names") == []


# --- LinkedIn parser: same fixes, end to end -------------------------------

def test_linkedin_parser_matches_full_tool_list():
    profile = {
        "name": "Jane Doe",
        "about": "Localization specialist using XL8 and Smartcat daily.",
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Tools_Software"] == "XL8, Smartcat"


def test_linkedin_parser_vendor_experience_is_canonical_not_raw_employer_blob():
    profile = {
        "name": "Jane Doe",
        "current_company": {"name": "SDI Media"},
        "experience": [{"company": "Some Unrelated Freelance Client"}],
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    # Only the recognized industry vendor is reported -- an unrelated employer
    # name is not invented as a false "vendor experience" dropdown entry.
    assert result["Vendor_Experience"] == "SDI"


# --- Parallel merge path: was LinkedIn-only for both fields, now isn't ------

def test_parallel_merge_extracts_tools_software_from_free_text():
    lead = {"Source": "PROZ", "Tools_Software": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"headline": "Subtitler using Aegisub and MemoQ", "current_title": None, "about_snippet": None},
    )
    assert lead["Tools_Software"] == "MemoQ, Aegisub"


def test_parallel_merge_extracts_vendor_experience_from_structured_history():
    lead = {"Source": "PROZ", "Vendor_Experience": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"experience": [{"company": "BTI Studios", "title": "QC Editor"}]},
    )
    assert lead["Vendor_Experience"] == "BTI"


def test_parallel_merge_no_match_leaves_fields_untouched():
    lead = {"Source": "PROZ", "Tools_Software": None, "Vendor_Experience": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"headline": "Operations at Global3", "current_title": "Business Owner", "about_snippet": None},
    )
    assert lead.get("Tools_Software") is None
    assert lead.get("Vendor_Experience") is None
