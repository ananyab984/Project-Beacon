"""Tests for the contract we send Parallel as its output schema, and for the
separate step that turns its result into English.

The schema's field descriptions ARE the instructions -- they're what
`task_run.execute(output=LeadProfile)` transmits, so a description quietly
edited away is a silent behaviour change with no other symptom.

The division of labour pinned here matters and was arrived at the wrong way
round first: an earlier version told Parallel to extract AND translate in one
pass, which makes the model do two jobs at once and quietly costs detail --
a phrase awkward to render in English comes back flattened or dropped, with
nothing afterwards to show that anything went missing. Extraction is now
faithful and complete in the profile's own language; translation is its own
step, and it refuses a result that lost a field.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_parallel_output_schema.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import orchestrator as orchestrator_module
from config import Config
from llm_fallback.client import ClaudeError
from orchestrator import EnrichmentOrchestrator, _looks_non_english
from providers.parallel_client import LeadProfile

SCHEMA = LeadProfile.model_json_schema()
FIELDS = SCHEMA["properties"]


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def stub(**methods):
    return type("Stub", (), {name: staticmethod(fn) for name, fn in methods.items()})()


# --- extraction stays in the source language ---------------------------------

def test_extraction_does_not_ask_for_translation():
    """Translating at extraction time is what loses detail -- the schema has
    to say so, or a well-meaning edit will put it back."""
    assert "do NOT translate here" in (SCHEMA.get("description") or "")
    for name in ["headline", "current_title", "about_snippet"]:
        desc = (FIELDS[name].get("description") or "").lower()
        assert "own language" in desc, f"{name} no longer asks for the page's own language"


def test_about_snippet_puts_completeness_above_language():
    desc = (FIELDS["about_snippet"].get("description") or "").lower()
    assert "never abridge" in desc, "the 'don't shorten it because translating is awkward' rule went missing"


def test_list_fields_forbid_absence_prose():
    """Confirmed live 2026-09-07: Parallel put "No certifications are listed
    in the available profile evidence." INSIDE `certifications` for 2 of 7
    leads, which reached Lead.certifications and would have been quoted back
    to the lead as a fact. An empty list is how "not present" is said."""
    for name in ["certifications", "experience", "education", "languages"]:
        desc = (FIELDS[name].get("description") or "").lower()
        assert "empty list" in desc, f"{name} no longer states that empty means 'none found'"
    assert "never a sentence" in (FIELDS["certifications"].get("description") or "").lower()


# --- the language sniff ------------------------------------------------------

def test_language_sniff_spots_the_real_spanish_payloads():
    """Both of these are verbatim from real Bodalgo leads."""
    assert _looks_non_english(
        {
            "headline": "Cálida, dinámica, impactante, cómica y personal.",
            "about_snippet": "tengo una voz medio rasgada y personal, aunque también otro tipo de "
            "registros como voz de viejecito, joven o para dibujos animados.",
        }
    )
    assert _looks_non_english(
        {
            "headline": "Cálida, grave, galán y con varios registros. Versátil en tonos.",
            "about_snippet": "Tono muy agradable de escuchar, con versatilidad en distintos registros "
            "de voz. Aptitudes para todo tipo de locuciones: publicidad, corporativos.",
        }
    )


def test_language_sniff_leaves_english_payloads_alone():
    """A false positive only costs a wasted call, but it shouldn't be routine."""
    assert not _looks_non_english(
        {
            "headline": "EN,FR,ES>PT Translation & subtitling",
            "about_snippet": "Native Portuguese speaker with over 15 years of experience in translating, "
            "proofreading, transcreating, subtitling and editing in English, French and Spanish.",
            "current_title": "Freelance translator and/or interpreter",
        }
    )
    assert not _looks_non_english(
        {"headline": "Voice & Dubbing Artist Punjabi Hindi", "about_snippet": "Looking job in Direction and Edit Work"}
    )


def test_language_sniff_does_not_guess_from_a_handful_of_words():
    assert not _looks_non_english({"headline": "Translator"})


# --- normalisation ------------------------------------------------------------

SPANISH = {"headline": "Cálida, dinámica, impactante y personal.", "about_snippet": "tengo una voz medio rasgada y personal, con varios registros", "certifications": []}


def test_normalisation_translates_and_keeps_the_original():
    orch = _orch()
    orch.claude = stub(
        translate_to_english=lambda payload: {
            "headline": "Warm, dynamic, striking and personal.",
            "about_snippet": "I have a slightly husky, distinctive voice with several registers",
            "certifications": [],
        }
    )
    logs: list[str] = []
    out = orch._normalize_parallel_language(SPANISH, logs)

    assert out["headline"] == "Warm, dynamic, striking and personal."
    assert out["_original_language"] == SPANISH, "the pre-translation payload must survive"
    assert any("normalised to English" in line for line in logs)


def test_already_english_is_not_sent_for_translation():
    orch = _orch()
    called = {"n": 0}
    orch.claude = stub(translate_to_english=lambda payload: called.__setitem__("n", called["n"] + 1) or payload)
    english = {
        "headline": "EN,FR,ES>PT Translation & subtitling",
        "about_snippet": "Native Portuguese speaker with over 15 years of experience in translating and subtitling.",
    }
    out = orch._normalize_parallel_language(english, [])
    assert called["n"] == 0, "an English payload must not pay for a translation call"
    assert out == english
    assert "_original_language" not in out


def test_translation_that_drops_a_field_is_rejected_wholesale():
    """Losing information is the one unacceptable outcome -- the whole reason
    translation is a separate step. A result missing a field that had content
    is discarded in favour of the original."""
    orch = _orch()
    orch.claude = stub(translate_to_english=lambda payload: {"headline": "Warm, dynamic.", "about_snippet": None})
    logs: list[str] = []
    out = orch._normalize_parallel_language(SPANISH, logs)
    assert out == SPANISH, "a lossy translation must not replace the original"
    assert any("dropped" in line for line in logs)


def test_translation_failure_keeps_the_source_language_data():
    """Source-language data is worth far more than no data, so a failed
    translation must never look like a failed enrichment."""
    orch = _orch()

    def boom(payload):
        raise ClaudeError("api down")

    orch.claude = stub(translate_to_english=boom)
    logs: list[str] = []
    out = orch._normalize_parallel_language(SPANISH, logs)
    assert out == SPANISH
    assert any("keeping the original-language data" in line for line in logs)


def test_no_claude_key_keeps_the_source_language_data():
    orch = _orch()
    orch.claude = None
    logs: list[str] = []
    assert orch._normalize_parallel_language(SPANISH, logs) == SPANISH
    assert any("untranslated" in line for line in logs)


def test_normalisation_runs_inside_the_waterfall_and_reaches_canonical_fields():
    """End to end: a Spanish Parallel result must land on the lead in
    English, since Lead.headline is what the dialog and drafting both read."""
    orch = _orch()
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: dict(SPANISH))
    orch.claude = stub(
        translate_to_english=lambda payload: {
            "headline": "Warm, dynamic, striking and personal.",
            "about_snippet": "I have a slightly husky, distinctive voice",
            "certifications": [],
        }
    )
    result = orch.process_lead(
        {"Source": "Bodalgo", "Profile_Link": "https://www.bodalgo.com/en/voice-over-talents/someone", "Full_Name": "Raul A"}
    )
    assert result["lead"]["Headline"] == "Warm, dynamic, striking and personal."
    assert result["parallel_fallback"]["data"]["_original_language"]["headline"] == SPANISH["headline"]


def test_english_text_replaces_the_stale_source_language_column():
    """The translation has to land where it's actually read.

    Confirmed live 2026-09-07: after normalisation shipped, `parallelData`
    held English while `Lead.headline`/`aboutSnippet` still held the Spanish
    strings from an earlier pass -- and those columns are exactly what the
    enrichment dialog's field rows and drafting's flat facts read, so the
    translation was invisible where it mattered. The merge's never-overwrite
    rule was doing it: those fields already had (Spanish) values.
    """
    orch = _orch()
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: dict(SPANISH))
    orch.claude = stub(
        translate_to_english=lambda payload: {
            "headline": "Warm, dynamic, impactful and personal.",
            "about_snippet": "I have a somewhat raspy and personal voice",
            "certifications": [],
        }
    )

    # The lead already carries source-language text from an earlier pass --
    # and deliberately NOT byte-identical to what this run extracted, which
    # is what defeated the first (exact-match) version of this rule.
    lead = {
        "Source": "Bodalgo",
        "Profile_Link": "https://www.bodalgo.com/en/voice-over-talents/someone",
        "Full_Name": "Quique L",
        "Headline": SPANISH["headline"],
        "About_Snippet": "tengo una voz medio rasgada y personal, aunque tambien otros registros distintos",
    }
    result = orch.process_lead(lead)

    assert result["lead"]["Headline"] == "Warm, dynamic, impactful and personal."
    assert result["lead"]["About_Snippet"] == "I have a somewhat raspy and personal voice"
    assert result["field_sources"]["Headline"] == "parallel"


def test_forcing_is_scoped_to_the_translated_text_fields_only():
    """The override is scoped to the four fields that carry translated free
    text -- every other canonical field keeps the never-overwrite rule, so a
    non-English profile can't become a licence to rewrite the whole row."""
    orch = _orch()
    orch.parallel = stub(enrich_profile=lambda lead, profile_link: dict(SPANISH))
    orch.claude = stub(
        translate_to_english=lambda payload: {
            "headline": "Warm, dynamic, impactful and personal.",
            "about_snippet": "I have a somewhat raspy and personal voice",
            "certifications": [],
        }
    )

    lead = {
        "Source": "Bodalgo",
        "Profile_Link": "https://www.bodalgo.com/en/voice-over-talents/someone",
        "Full_Name": "Quique L",
        "Contact_Number": "+34 600 000 000",
        "Vendor_Experience": "Some agency",
    }
    result = orch.process_lead(lead)
    # Translated text fields DO get replaced...
    assert result["lead"]["Headline"] == "Warm, dynamic, impactful and personal."
    # ...while fields outside that set keep the never-overwrite rule.
    assert result["lead"]["Contact_Number"] == "+34 600 000 000"
    assert result["lead"]["Vendor_Experience"] == "Some agency"
