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
        },
        # This lead is thin enough to also trigger Stage 6 -- irrelevant to
        # what this test checks (translation), so stubbed to a harmless no-op.
        search_missing_fields=lambda *a, **kw: {"could_not_find_anything": True, "sources_used": []},
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
        },
        search_missing_fields=lambda *a, **kw: {"could_not_find_anything": True, "sources_used": []},
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
        },
        search_missing_fields=lambda *a, **kw: {"could_not_find_anything": True, "sources_used": []},
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


def test_language_sniff_is_not_diluted_by_the_schemas_own_key_names():
    """A first version sniffed the whole JSON dump, so the schema's key names
    ("about_snippet", "field_of_study", "school_name", "proficiency") counted
    as words -- all English, all diluting the ratio. It worked where the free
    text was long enough to outweigh them and quietly failed where it wasn't.

    This payload is the real French lead it failed on: brief prose, and
    experience/education/languages arrays contributing a pile of English
    keys. Her data stayed French through a full re-enrichment because of it.
    """
    maud = {
        "country": "France",
        "headline": "Étudiante à Université Rennes 2 Traduction EN—>FR et SP—>FR",
        "about_snippet": "Traductrice EN—>FR et ES—>FR · Expérience : Freelance · Formation : Université Rennes 2 · Lieu : Le Rheu",
        "current_title": "Traductrice",
        "certifications": [],
        "education": [{"school_name": "Université Rennes 2", "field_of_study": "Traduction", "degree": "Licence"}],
        "experience": [{"company": "Freelance", "title": "Traductrice", "summary": "Traduction EN vers FR"}],
        "languages": [{"language": "Anglais", "proficiency": "Courant"}],
    }
    assert _looks_non_english(maud)

    # Same shape, same array keys, English content -- must stay untouched.
    nadia = {
        "country": "Portugal",
        "headline": "EN,FR,ES>PT Translation & subtitling",
        "about_snippet": "Native Portuguese speaker with over 15 years of experience in translating, "
        "proofreading, transcreating, subtitling and editing in English, French and Spanish.",
        "current_title": "Freelance translator and/or interpreter",
        "certifications": [],
        "education": [{"school_name": "University of Lisbon", "field_of_study": "Translation", "degree": "BA"}],
        "experience": [{"company": "Freelance", "title": "Translator", "summary": "Translation and subtitling"}],
        "languages": [{"language": "Portuguese", "proficiency": "Native"}],
    }
    assert not _looks_non_english(nadia)


def test_preserved_original_does_not_retrigger_translation():
    """`_original_language` is non-English by definition. Counting it would
    make an already-translated payload look like it still needs translating,
    on every subsequent pass."""
    translated = {
        "headline": "Warm, dynamic, impactful and personal.",
        "about_snippet": "I have a somewhat raspy and personal voice with several registers.",
        "_original_language": SPANISH,
    }
    assert not _looks_non_english(translated)


# --- the nested entry schemas ------------------------------------------------
#
# The bug these pin down (confirmed live 2026-09-08): experience/education/
# languages were typed `List[Dict[str, Any]]`, which compiles to
# `{"type": "object", "additionalProperties": true}` -- an object with NO
# declared properties. Parallel returned the right NUMBER of rows and nothing
# inside any of them: 107 rows across 27 leads, every one `{}`. Martin
# Godart's profile reported 3 roles and stored 3 blank objects, and the lead
# read "Enriched" in the UI with every deep section showing "None found".
#
# Nothing else catches this. The call succeeds, the payload validates, the
# counts look right, and the data is simply absent.

ENTRY_KEYS = {
    # field -> keys the CONSUMERS already read. The enrichment dialog
    # (client/src/components/features/enrichment-details-dialog.tsx:
    # formatRole/formatEducation/labelOf) and drafting_service/core/leads.py
    # (_format_role/_role_highlight/_label_of) both read these names, so the
    # schema has to emit exactly them or the data lands where nobody looks.
    "experience": {"title", "company", "start_date", "end_date", "summary"},
    "education": {"institution", "degree", "field_of_study"},
    "languages": {"language", "proficiency"},
}


def _item_properties(field: str) -> dict:
    items = FIELDS[field]["items"]
    ref = items.get("$ref")
    assert ref, (
        f"{field} items are a free-form object ({items}) -- Parallel has no named keys to "
        f"fill and returns empty rows"
    )
    return SCHEMA["$defs"][ref.split("/")[-1]]["properties"]


def test_nested_list_entries_declare_real_properties():
    """A free-form object gives the extractor nowhere to put anything."""
    for field in ENTRY_KEYS:
        props = _item_properties(field)
        assert props, f"{field} entries declare no properties at all"


def test_nested_entry_keys_match_what_the_consumers_read():
    for field, expected in ENTRY_KEYS.items():
        props = set(_item_properties(field))
        missing = expected - props
        assert not missing, f"{field} entries no longer emit {sorted(missing)}, which its readers look for"


def test_role_summary_is_asked_for_verbatim():
    """`summary` is the field carrying quotable specifics (named clients,
    productions, tools); a title and company alone personalise nothing.

    Asserts the INTENT -- complete, and explicitly not a paraphrase -- rather
    than one particular wording. The first version of this test required the
    literal word "verbatim", which then failed against the PoC's own proven
    phrasing ("exactly as written on the profile - not a paraphrase"). Pinning
    a synonym rather than the requirement made the test an obstacle to adopting
    the wording that demonstrably works."""
    desc = (_item_properties("experience")["summary"].get("description") or "").lower()
    assert "paraphras" in desc, "summary must explicitly rule out a paraphrase"
    assert any(w in desc for w in ("verbatim", "exactly as written", "full, complete")), (
        "summary must ask for the COMPLETE description, not merely a description"
    )


# --- content-free results are never banked as a success ----------------------

def test_rows_with_no_data_inside_do_not_count_as_a_find():
    """The exact stored shape from the live bug: right row counts, nothing in
    any of them. Treating this as a success is what stamped `complete` on
    leads that had found nothing, so they were never re-attempted."""
    assert orchestrator_module._is_empty_parallel_result(
        {
            "headline": None, "current_title": None, "about_snippet": None, "country": None,
            "experience": [{}, {}, {}], "education": [{}], "languages": [{}], "certifications": [],
        }
    )


def test_a_single_real_value_anywhere_still_counts_as_a_find():
    """Martin Godart's actual result -- Parallel did resolve country and
    current_title, so the run must not be thrown away as empty."""
    assert not orchestrator_module._is_empty_parallel_result(
        {"country": "France", "current_title": "InfoGraphiste Web / Print", "experience": [{}, {}, {}]}
    )
    assert not orchestrator_module._is_empty_parallel_result(
        {"headline": None, "experience": [{"title": "Traductrice"}]}
    )


def test_blank_strings_are_not_content():
    assert orchestrator_module._is_empty_parallel_result(
        {"headline": "   ", "experience": [{"title": "", "company": None}]}
    )


# --- the forcing mechanisms that make extraction complete ----------------
#
# The PoC (POC/parallel_api_poc/test.py) returned 5 fully-populated roles with
# multi-paragraph narrative summaries for a LinkedIn profile. Production, for
# the SAME lead, returned 5 empty objects and later `[]`. The schema was
# rewritten from the PoC's maximal-extraction design into a narrow one when
# Parallel replaced Clay, dropping every mechanism below. These assertions
# exist because the field descriptions ARE the instructions Parallel receives
# -- there is no separate prompt -- so a well-meaning tightening of this text
# is a silent behaviour change with no other symptom.

def test_schema_demands_maximal_not_minimal_extraction():
    """The single most load-bearing sentence in the schema. The prior wording
    ("Kept intentionally narrow", "Extract ONLY what is literally present")
    combined with all-optional entries made `[]` the cheapest valid answer."""
    # Whitespace-collapsed: these phrases wrap across lines in the docstring,
    # and a test that only matches them unwrapped would break on a reflow
    # rather than on a real change of meaning.
    desc = " ".join((SCHEMA.get("description") or "").lower().split())
    assert "maximal" in desc, "the maximal-extraction instruction is gone"
    assert "do not stop early" in desc
    assert "entire page" in desc, "the read-the-whole-page instruction is gone"


REQUIRED_ENTRY_FIELDS = {
    # field -> the keys that must be REQUIRED on its entry model.
    # An all-optional object schema lets the model satisfy the whole section
    # with an empty list; requiring the identifying keys means an entry cannot
    # be emitted as a shell, so it must extract or omit.
    "experience": {"company", "title"},
    "education": {"institution"},
    "languages": {"language"},
}


def test_identifying_entry_fields_are_required():
    for field, must_require in REQUIRED_ENTRY_FIELDS.items():
        ref = FIELDS[field]["items"]["$ref"].split("/")[-1]
        required = set(SCHEMA["$defs"][ref].get("required", []))
        missing = must_require - required
        assert not missing, (
            f"{field} entries no longer require {sorted(missing)} -- an all-optional entry "
            f"makes an empty list the cheapest valid answer for the whole section"
        )


def test_experience_keeps_its_two_self_check_booleans():
    """`title_pairing_verified` guards a documented real bug: LinkedIn stacked
    roles at one employer having their titles and narratives swapped, caught
    only by comparing against Clay's independent record. Being required is the
    point -- it forces a per-entry re-read of the page layout."""
    ref = FIELDS["experience"]["items"]["$ref"].split("/")[-1]
    entry = SCHEMA["$defs"][ref]
    required = set(entry.get("required", []))
    assert {"is_current", "title_pairing_verified"} <= required
    assert "self-check" in (entry["properties"]["title_pairing_verified"].get("description") or "").lower()


def test_the_page_audit_checklist_exists():
    """`profile_sections_detected` makes the model enumerate the headings it
    actually saw before filling any field -- the strongest forcing function in
    the PoC schema."""
    desc = (FIELDS["profile_sections_detected"].get("description") or "").lower()
    assert "checklist" in desc
    assert "do not stop after finding the first" in desc


def test_every_list_field_says_capture_all():
    """Each list previously carried only restraint framing ("never invent one
    to fill the list"), which reads as permission to under-extract."""
    for field in ["certifications", "experience", "education", "languages"]:
        desc = (FIELDS[field].get("description") or "").lower()
        assert ("all of them" in desc or "every role" in desc), (
            f"{field} no longer instructs an exhaustive capture"
        )


def test_languages_names_its_own_importance_on_this_platform():
    """This is a linguist recruitment platform: language + proficiency is the
    qualifying data recruiters filter on."""
    desc = (FIELDS["languages"].get("description") or "").lower()
    assert "linguist" in desc


def test_the_page_audit_is_not_counted_as_profile_prose():
    """Section headings skew English even on a French page ("About",
    "Experience"), so counting them in the language sniff is the same dilution
    bug the sniff's own docstring describes for schema key names."""
    french = {
        "headline": "Étudiante à Université Rennes 2 Traduction EN—>FR",
        "about_snippet": "Traductrice EN—>FR et ES—>FR · Expérience : Freelance · Lieu : Le Rheu",
        "profile_sections_detected": [
            "About", "Experience", "Education", "Languages", "Skills", "Certifications",
            "Recommendations", "Courses", "Projects", "Honors and Awards",
        ],
    }
    assert _looks_non_english(french), "an English heading list must not mask a French profile"
