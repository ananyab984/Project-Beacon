"""Tools_Software is extracted from what a profile actually lists, not from
a fixed list, and tools never sit in Services. Every skills list a provider
returns used to be copied wholesale into Services, so "Pro Tools" / "SDL
Trados" were stored as services and Tools_Software stayed empty. Also pins
the two confirmed free-text false matches ("resolve", "audition").

Run: cd enrichment_pipeline && .venv/bin/python -m pytest tests/test_tools_services_sorting.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from orchestrator import EnrichmentOrchestrator, _grounding_text
from parsers.tool_aliases import extract_tools_from_text

sort = EnrichmentOrchestrator._sort_tools_out_of_services


def _orch():
    return EnrichmentOrchestrator(Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key=""))


def test_a_skills_list_is_sorted_into_services_and_tools_end_to_end():
    orch = _orch()
    orch.parallel = type("Stub", (), {"enrich_profile": staticmethod(lambda lead, link, processor=None: {
        "headline": "Voice Actor", "skills": ["Voice Over", "Pro Tools", "SDL Trados", "Translation"],
    })})()
    result = orch.process_lead({"Source": "ProZ", "Profile_Link": "https://www.proz.com/profile/1", "Full_Name": "Jane Doe"})
    assert result["lead"]["Services"] == "Voice Over, Translation"
    assert result["lead"]["Tools_Software"] == "Pro Tools, SDL Trados Studio"


def test_an_unlisted_tool_moves_when_groq_classified_it_as_one():
    lead, sources = {"Services": "Subtitling, Matecat"}, {"Services": "parallel"}
    sort(lead, sources, [], {_grounding_text("Matecat")})
    assert lead["Services"] == "Subtitling"
    assert lead["Tools_Software"] == "Matecat"
    assert sources["Tools_Software"] == "parallel"


def test_recruiter_entered_services_are_never_touched():
    for source in ("existing", "manual"):
        lead = {"Services": "Voice Over, Pro Tools"}
        sort(lead, {"Services": source}, [], set())
        assert lead == {"Services": "Voice Over, Pro Tools"}


def test_nothing_moves_when_tools_is_a_manual_entry():
    lead = {"Services": "Voice Over, Pro Tools", "Tools_Software": "Audacity"}
    sort(lead, {"Services": "brightdata", "Tools_Software": "manual"}, [], set())
    assert lead["Services"] == "Voice Over, Pro Tools" and lead["Tools_Software"] == "Audacity"


def test_all_tools_services_empties_with_the_source_node_applies():
    lead, sources = {"Services": "Pro Tools, Reaper"}, {"Services": "brightdata"}
    sort(lead, sources, [], set())
    assert lead["Services"] == "" and sources["Services"] == "llm_fallback"
    assert lead["Tools_Software"] == "Pro Tools, Reaper"


def test_ordinary_words_are_not_tools_in_free_text():
    assert extract_tools_from_text("Assistance to people to resolve common troubles") == []
    assert extract_tools_from_text("Booked from a self-taped audition, swift turnaround") == []
    assert extract_tools_from_text("Edited in DaVinci Resolve, cleaned in Adobe Audition") == ["Adobe Audition", "DaVinci Resolve"]
