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


def test_bti_alias_does_not_false_positive_on_subtitle():
    # Regression: a plain substring check matched bare "bti" embedded inside
    # "subtitle"/"subtitling"/"subtitler" -- a near-universal word on this
    # exact kind of profile -- reporting BTI as vendor experience on almost
    # every lead regardless of its actual content. Word-boundary matching
    # (extract_vendors_from_text) rejects the embedded match while still
    # catching a real, standalone "BTI" mention.
    assert extract_vendors_from_text("Experienced subtitler and subtitling QA specialist") == []
    assert extract_vendors_from_text("Long-time freelancer for BTI on subtitling projects") == ["BTI"]


def test_avid_bare_alias_removed_does_not_false_positive_on_common_word():
    # "avid" (the tool, via a plain substring check) matched inside the
    # ordinary English adjective "avid" ("an avid translator") -- the bare
    # alias was removed, keeping only the safe, equally matchable full
    # phrase "Avid Media Composer".
    assert extract_tools_from_text("An avid reader and translator") == []
    assert extract_tools_from_text("Editing on Avid Media Composer daily") == ["Avid Media Composer"]


# --- LinkedIn parser: same fixes, end to end -------------------------------

def test_linkedin_parser_matches_full_tool_list():
    profile = {
        "name": "Jane Doe",
        "about": "Localization specialist using XL8 and Smartcat daily.",
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Tools_Software"] == "XL8, Smartcat"


def test_linkedin_parser_vendor_experience_includes_every_real_employer():
    # Every distinct named employer is reported, not only ones matching the
    # 9 known vendors -- confirmed live that restricting to known-vendor-only
    # matches throws away a profile's own real Experience data. A known
    # vendor still gets canonicalized ("SDI Media" -> "SDI"); an unrelated
    # real employer is kept exactly as stated.
    profile = {
        "name": "Jane Doe",
        "current_company": {"name": "SDI Media"},
        "experience": [{"company": "Kinotitles Srls"}],
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Vendor_Experience"] == "SDI, Kinotitles Srls"


def test_linkedin_parser_vendor_experience_drops_employment_status_labels():
    # "Freelancer" is what BrightData puts in current_company for someone
    # describing how they work, not a real company -- must never surface as
    # if it were a vendor.
    profile = {"name": "Jane Doe", "current_company": {"name": "Freelancer"}}
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result.get("Vendor_Experience") is None


def test_linkedin_parser_vendor_experience_catches_a_known_vendor_named_only_in_prose():
    # No structured `company` field names it -- only the About text does.
    # Safe to catch deterministically since it's still the closed 9-name
    # list, not open extraction.
    profile = {"name": "Jane Doe", "about": "I've delivered QC work to Zoo Digital for years."}
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Vendor_Experience"] == "Zoo Digital"


# --- Structured/semi-structured sections beyond Headline/About -------------

def test_linkedin_parser_finds_a_tool_named_only_in_a_certification_title():
    profile = {
        "name": "Jane Doe",
        "certifications": [{"title": "Ooona Certified Subtitler", "subtitle": "Ooona"}],
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Tools_Software"] == "Ooona"


def test_linkedin_parser_finds_a_tool_named_only_in_a_course_title():
    profile = {"name": "Jane Doe", "courses": [{"title": "Advanced Pro Tools Workflow"}]}
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Tools_Software"] == "Pro Tools"


def test_linkedin_parser_finds_a_tool_named_only_in_an_experience_description():
    profile = {
        "name": "Jane Doe",
        "experience": [
            {
                "company": "Some Studio",
                "positions": [{"title": "Editor", "description_html": "<p>Used <b>Adobe Audition</b> daily for cleanup.</p>"}],
            }
        ],
    }
    result = LinkedInParser().parse("https://linkedin.com/in/jane", profile)
    assert result["Tools_Software"] == "Adobe Audition"


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


def test_parallel_merge_finds_a_tool_named_only_in_an_experience_summary():
    lead = {"Source": "PROZ", "Tools_Software": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"experience": [{"company": "Some Studio", "title": "Editor", "summary": "Cut on Pro Tools and DaVinci Resolve daily."}]},
    )
    assert lead["Tools_Software"] == "DaVinci Resolve, Pro Tools"


def test_parallel_merge_catches_a_known_vendor_named_only_in_prose():
    lead = {"Source": "PROZ", "Vendor_Experience": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(
        lead, field_sources, logs,
        {"headline": "Freelance QC lead, regularly staffed onto Deluxe projects"},
    )
    assert lead["Vendor_Experience"] == "Deluxe"


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
