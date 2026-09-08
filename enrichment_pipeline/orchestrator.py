"""Main Pipeline Orchestrator connecting all 7 enrichment stages."""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Dict, Literal, Optional, TypedDict

from config import Config
from core.enrichment_count import count_stage6_fillable_fields
from core.field_audit import audit_lead_fields
from core.schema import has_content, is_empty_value
from core.source_router import route_lead
from llm_fallback.client import ClaudeClient, ClaudeError
from llm_fallback.verifier import filter_web_search_result
from logger import get_logger
from providers.brightdata_client import BrightDataClient, BrightDataError
from providers.parallel_client import ParallelClient, ParallelError
from providers.tavily_client import TavilyClient, TavilyError

# Parsers
from parsers.ada_parser import AdaParser
from parsers.ata_parser import AtaParser
from parsers.ataa_parser import AtaaParser
from parsers.bodalgo_parser import BodalgoParser
from parsers.generic_parser import GenericParser
from parsers.linkedin_parser import LinkedInParser
from parsers.proz_parser import ProzParser

log = get_logger(__name__)

# Lets Tier 2 (Parallel) START before Tier 1 (Bright Data/Tavily) FINISHES,
# since both take only the profile URL and share no state -- there was never
# a real reason for the second to wait on the first, only that the code
# called them in sequence. Measured on production leads: Tier 1 runs 7-15s,
# so the previous sequential shape spent that whole span doing nothing for
# Parallel, which dominates total latency (~150-170s) regardless. Small and
# separate from core/resilience.py's `_executor` (used inside every retried
# HTTP attempt) and providers/parallel_client.py's `_parallel_executor`
# (Parallel's own retry bulkhead) -- this pool only ever holds ONE
# outstanding dispatch per lead being processed, for the span of Tier 1's
# scrape, so 8 workers comfortably covers real concurrent load.
_tier_overlap_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tier-overlap")

# Fields where a manually-typed value is frequently just an approximation (a
# name spelling/nickname, a rough one-item service guess picked from a
# dropdown, a best-guess language pair) and a verified profile value is the
# source of truth once we have it -- shared between Stage 3's deterministic
# merge and Stage 6's LLM-verified merge below, since production evidence
# shows many BrightData LinkedIn profiles don't return a structured
# `skills`/`languages` section at all, making free-text LLM extraction the
# only remaining path to correct a wrong manual guess for those leads.
OVERRIDE_ON_VERIFIED_FIELDS = {
    "Full_Name", "First_Name",
    "Services", "Source_Language", "Target_Language",
    "Secondary_Languages", "Country_of_Residence",
}

# Fields with no manual-entry equivalent -- only worth asking the LLM fallback
# about when still empty after Stage 3's deterministic parse. Headline and
# About_Snippet were confirmed in production to come back empty from
# BrightData for a meaningful share of LinkedIn profiles (Martin Godart's
# reported case: every one of the dialog's 10 fields blank, including these
# two) yet were never wired into any fallback list, so a persistently-blocked
# profile would show them as permanently "Not found" even after Stage 6 was
# added -- Stage 6 only ever tries fields that land in fallback_targets.
FILL_ONLY_ENRICHABLE_FIELDS = ["Current_Title", "Tools_Software", "Certifications", "Headline", "About_Snippet"]

# Phrases that mark a value as the model NARRATING an absence rather than
# reporting data ("No certifications are listed in the available profile
# evidence."). Confirmed live 2026-09-07: Parallel put exactly that string
# into `certifications` for 2 of 7 leads, which then reached Lead.certifications
# and would have been quoted back to the lead as a fact in their outreach
# draft. providers/parallel_client.py's schema now instructs an empty list
# instead, but an LLM can always regress -- this is the trust-boundary check
# that keeps prose out of a data column regardless of how the prompt behaves.
_ABSENCE_PROSE_MARKERS = (
    "no certification", "none listed", "not listed", "not available",
    "not specified", "not provided", "no data", "none found", "not found",
    "profile evidence", "no information",
)


# Values `field_sources["_parallel_fallback"]` can hold, and the re-attempt
# policy they encode. The marker is round-tripped by the caller on every
# enrichment pass (Node sends it back as Field_Sources), so it's the only
# memory this stage has of what happened last time.
#
# It replaces a plain truthy check that treated ANY value -- including
# "failed" -- as "already attempted, never call again". That meant a single
# transient blip (a timeout, a 5xx, a dropped connection) denied a lead Tier 2
# enrichment permanently, recoverable only by editing the database by hand.
# Confirmed live 2026-09-07: three leads were stamped "failed" by a
# since-fixed timeout bug and then silently skipped by every later pass, so
# the fix couldn't reach them until their markers were cleared manually.
PARALLEL_STATE_COMPLETE = "complete"
PARALLEL_STATE_FAILED_PERMANENT = "failed_permanent"
PARALLEL_STATE_FAILED_TRANSIENT_PREFIX = "failed_transient:"
# Transient failures get this many total attempts across passes before the
# lead is left alone. Two, deliberately: each attempt is a real paid Task Run
# taking ~150-170s, and the poller revisits pending leads on a schedule, so an
# uncapped retry would bill for the same dead URL indefinitely.
MAX_PARALLEL_TRANSIENT_ATTEMPTS = 2


def _parallel_attempts(state: Optional[str]) -> int:
    """How many transient attempts this lead has already used."""
    if not state or not state.startswith(PARALLEL_STATE_FAILED_TRANSIENT_PREFIX):
        return 0
    try:
        return int(state.split(":", 1)[1])
    except (IndexError, ValueError):
        # An unparseable counter is treated as "already used them all" rather
        # than "start over" -- a corrupt marker must never become a way to
        # re-bill a lead on every pass.
        return MAX_PARALLEL_TRANSIENT_ATTEMPTS


def _parallel_state_is_settled(state: Optional[str]) -> Optional[str]:
    """Human-readable reason this lead needs no further Parallel call, or
    None if it should be (re-)attempted."""
    if state == PARALLEL_STATE_COMPLETE:
        return "Parallel already resolved this lead"
    if state == PARALLEL_STATE_FAILED_PERMANENT:
        return "Parallel permanently rejected this lead's input"
    if state and state.startswith(PARALLEL_STATE_FAILED_TRANSIENT_PREFIX):
        attempts = _parallel_attempts(state)
        if attempts >= MAX_PARALLEL_TRANSIENT_ATTEMPTS:
            return f"Parallel failed {attempts}/{MAX_PARALLEL_TRANSIENT_ATTEMPTS} times, attempts exhausted"
        return None  # retry budget left
    if state:
        # Legacy marker from before this policy existed (plain "failed", or
        # anything unrecognised). Treat as settled rather than guessing, so an
        # unknown value can't silently re-bill every pass.
        return f"unrecognised Parallel state {state!r}, treating as settled"
    return None



# Stage 6 (Claude web search, Tier 3) fires only once a lead is still thin
# after Bright Data/Tavily and Parallel have both had their (retried) chance.
#
# Gated on count_stage6_fillable_fields, NOT the 10-field UI metric
# (count_enriched_fields) this used to share -- that metric includes
# Profile_Link (the lead's own input, enriched 0 times ever, in 32 of 32
# production leads) and Email_Address/Contact_Number (which Stage 6 is itself
# forbidden from filling, see WEBSEARCH_EXCLUDED_FIELDS below). Measuring
# "how thin is this lead" against a denominator that includes fields nothing
# can ever fill, and one stage is barred from filling, made a threshold of ">5
# of 10" actually demand "6 of a real 7" -- which is why Stage 6 fired for 28
# of 32 leads (88%) with zero recorded successes across every run in
# production logs, at a measured cost of 91-486s each.
#
# 2 (of the real 7 fillable fields) reserves this for genuinely thin leads --
# a lead with headline/title/about/services already found (the common case)
# will not trigger it just because Country or a language field is still
# missing, which is exactly the failure mode the original ">5 of 10" threshold
# was trying (and failing) to prevent.
MAX_FIELDS_BEFORE_WEBSEARCH = 2

# Never asked for, never accepted from Stage 6 even if the model returns
# them anyway (see verifier.py's filter_web_search_result) -- a wrong
# contact reaches a different real human being, so missing contact info is
# the safer failure. Years_of_Exp stays in scope; a wrong number only carries
# the ordinary hallucination risk every other field has.
WEBSEARCH_EXCLUDED_FIELDS = frozenset({"Email_Address", "Contact_Number"})

# Same re-attempt policy as PARALLEL_STATE_* above, duplicated rather than
# shared: this is a distinct provider/marker (`_websearch_fallback`, not
# `_parallel_fallback`), and each already has its own settled/attempt-count
# meaning that would only get harder to follow behind a shared parameterized
# helper for two call sites.
WEBSEARCH_STATE_COMPLETE = "complete"
WEBSEARCH_STATE_FAILED_PERMANENT = "failed_permanent"
WEBSEARCH_STATE_FAILED_TRANSIENT_PREFIX = "failed_transient:"
MAX_WEBSEARCH_TRANSIENT_ATTEMPTS = 2


def _websearch_attempts(state: Optional[str]) -> int:
    """How many transient attempts this lead has already used for Stage 6."""
    if not state or not state.startswith(WEBSEARCH_STATE_FAILED_TRANSIENT_PREFIX):
        return 0
    try:
        return int(state.split(":", 1)[1])
    except (IndexError, ValueError):
        return MAX_WEBSEARCH_TRANSIENT_ATTEMPTS


def _websearch_state_is_settled(state: Optional[str]) -> Optional[str]:
    """Human-readable reason this lead needs no further Stage 6 call, or
    None if it should be (re-)attempted."""
    if state == WEBSEARCH_STATE_COMPLETE:
        return "web search already resolved this lead"
    if state == WEBSEARCH_STATE_FAILED_PERMANENT:
        return "Claude permanently rejected this lead's web-search request"
    if state and state.startswith(WEBSEARCH_STATE_FAILED_TRANSIENT_PREFIX):
        attempts = _websearch_attempts(state)
        if attempts >= MAX_WEBSEARCH_TRANSIENT_ATTEMPTS:
            return f"web search failed {attempts}/{MAX_WEBSEARCH_TRANSIENT_ATTEMPTS} times, attempts exhausted"
        return None
    if state:
        return f"unrecognised web-search state {state!r}, treating as settled"
    return None


def _tier1_skip_reason(env_var: str, profile_link: str, client: Any) -> str:
    """Why Stage 3 (Tier 1) did not run, named precisely enough to act on.

    The two causes are worlds apart operationally -- "this lead has no URL to
    scrape" is normal and per-lead, while "the API key is missing from this
    environment" is a deployment fault affecting EVERY lead -- and both used
    to produce the same thing: nothing. A misconfigured environment was
    therefore indistinguishable from a blocked profile, right up to the shape
    of the stored result (`rawScrapeData: NULL`).

    The second message deliberately says the lead falls back to Parallel/web
    search, because that is also the latency story: with Tier 1 gone every
    lead looks thin, so Stage 6 fires on all of them and adds its own minutes
    to a run that had no chance of finding much anyway."""
    if not profile_link:
        return "Stage 3 skipped: no Profile_Link to scrape"
    if client is None:
        return (
            f"Stage 3 SKIPPED: {env_var} is not configured in this environment -- Tier 1 is "
            f"disabled for EVERY lead, not just this one. This lead now depends entirely on "
            f"Parallel and web search, which is both thinner and slower."
        )
    return "Stage 3 skipped: Tier 1 unavailable for this lead"


# `_has_content` now lives in core/schema.py: every provider needs the same
# judgement about structurally-empty-but-well-formed payloads, and providers/
# cannot import orchestrator without a cycle. Imported above as `has_content`.


def _is_empty_parallel_result(parallel_data: Dict[str, Any]) -> bool:
    """True if Parallel's Task Run succeeded (no exception) but found nothing
    real -- no scalar field and no list entry carrying any actual value.

    Confirmed live 2026-09-07: a blocked LinkedIn profile made Parallel return
    exactly `{"headline": null, "current_title": null, "about_snippet": null,
    "country": null, "experience": [], "education": [], "languages": [],
    "certifications": []}` -- a well-formed LeadProfile dict, so
    `isinstance(content, dict)` in parallel_client.py's `_run_once` never
    raised, and this was accepted as a genuine success on the first try.

    Emptiness is measured with `has_content` (core/schema.py), not truthiness, so the
    near-miss version of that payload -- one whose lists hold the right
    NUMBER of entries and no data inside any of them -- is judged the same
    way rather than passing as a find."""
    return not any(
        has_content(parallel_data.get(f))
        for f in (
            "headline", "current_title", "about_snippet", "country",
            "experience", "education", "languages", "certifications",
        )
    )


# Function words that are common and distinctive in the languages these
# profiles actually turn up in (Spanish, French, German, Portuguese, Italian),
# and rare-to-absent in English profile prose. Used only to decide whether a
# payload is worth sending for translation -- a false positive costs one cheap
# Claude call, a false negative leaves that lead's text in its own language,
# so the list leans towards triggering.
#
# ponytail: a word-list sniff, not language identification. Ceiling: a mostly
# English profile with a stray foreign phrase triggers a (harmless) pass, and
# a very short non-English field can slip past. Upgrade path is a real
# detector (langdetect/lingua) if this proves too blunt in practice; not worth
# a dependency for the handful of languages seen so far.
_NON_ENGLISH_MARKERS = frozenset(
    {
        # Spanish / Portuguese
        "de", "la", "el", "los", "las", "con", "para", "por", "una", "como",
        "muy", "más", "también", "años", "voz", "trabajo", "em", "não", "uma",
        "del", "su", "sus", "está", "años",
        # French
        "le", "les", "des", "une", "du", "au", "aux", "est", "sur", "avec",
        "pour", "dans", "traduction", "traductrice", "traducteur", "ans", "et",
        "à", "chez", "en", "formation", "expérience", "étudiante", "étudiant",
        "lieu", "ses", "son",
        # German
        "und", "der", "die", "das", "den", "von", "mit", "für", "ich", "auch",
        "sprachen", "jahre", "übersetzer", "übersetzerin",
        # Italian
        "il", "lo", "gli", "che", "con", "per", "sono", "anni", "voce",
        "traduzione", "esperienza",
    }
)


def _payload_strings(value: Any) -> list[str]:
    """Every human-readable string VALUE in a payload, keys excluded."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        out: list[str] = []
        for key, v in value.items():
            # Skip our own bookkeeping, and never count the preserved original
            # (which is by definition non-English) when re-judging a payload.
            if isinstance(key, str) and key.startswith("_"):
                continue
            # `profile_sections_detected` is a QA checklist of the page's
            # section HEADINGS, not profile prose -- and headings skew English
            # even on a French page ("About", "Experience", "Education").
            # Counting them is the same dilution bug this function's docstring
            # already describes for schema key names: it worked where the free
            # text was long enough to outweigh them and failed where it wasn't.
            if key == "profile_sections_detected":
                continue
            out.extend(_payload_strings(v))
        return out
    if isinstance(value, list):
        out = []
        for v in value:
            out.extend(_payload_strings(v))
        return out
    return []


def _looks_non_english(payload: Any) -> bool:
    """True if a payload's free text reads as something other than English.

    Judges the VALUES only. A first version sniffed the whole JSON dump,
    which counted the schema's own key names ("about_snippet",
    "field_of_study", "school_name", "proficiency"...) as words -- all of
    them English, all of them diluting the ratio. It worked on payloads whose
    free text was long enough to outweigh them and quietly failed on shorter
    ones: a real French lead ("Étudiante à Université Rennes 2 Traduction
    EN—>FR", "Traductrice EN—>FR et ES—>FR · Expérience : Freelance") scored
    under the threshold purely because her prose was brief and her
    experience/education arrays contributed a pile of English keys.
    """
    text = " ".join(_payload_strings(payload)).lower()
    words = re.findall(r"[a-zà-öø-ÿ']+", text)
    if len(words) < 8:
        # Too little text to judge; leave it alone rather than pay for a call.
        return False
    hits = sum(1 for w in words if w in _NON_ENGLISH_MARKERS)
    return hits / len(words) >= 0.06


def _is_absence_prose(value: str) -> bool:
    """True if `value` reads as a sentence about missing data rather than a
    real data value. Deliberately narrow: requires one of the known marker
    phrases AND enough length to be a sentence, so a genuine short credential
    that happens to contain a marker word survives."""
    lowered = value.strip().lower()
    if len(lowered) < 15:
        return False
    return any(marker in lowered for marker in _ABSENCE_PROSE_MARKERS)

# Lead-level cumulative budget across the WHOLE waterfall call sequence for
# one lead -- real elapsed time via time.monotonic(), not a sum of each
# step's own deadline (core/resilience.py's RetryPolicy.deadline_seconds
# already bounds each individual provider call; this is a separate, outer
# safety net). Worst case, identical for both waterfall shapes since Parallel
# runs on all platforms: Tier 1 (BrightData or Tavily, 15s) + Parallel 3700s
# (its own much longer deadline -- see config.py's parallel_deadline_seconds)
# + Stage 6's web-search call (300s -- see config.py's
# claude_websearch_deadline_seconds) = 15 + 3700 + 300 = 4015s -- raised
# (3800s -> 4100s) for headroom under this new ceiling.
# Earlier history: raised 350s -> 3800s after TWO successive guesses at
# Parallel's "typical" latency (150s, then 240s) both still cut off calls
# that were genuinely succeeding server-side (confirmed live 2026-09-07: a
# real "core"-processor Task Run routinely takes ~150-170s, and our own
# guessed ceiling kept firing right as the real result was landing). Rather
# than guess a third number, providers/parallel_client.py now defers to the
# Parallel SDK's own well-engineered default (waits up to an hour for a task
# to actually finish) -- this ceiling, and every one below, is sized to never
# be the thing that cuts that off early. In practice, real calls still
# resolve in ~150-170s -- this ceiling only matters for a genuine outlier,
# not the expected case. See server/src/jobs/enrichment.job.ts's matching
# axios timeout (4200s) and retryWithBackoff deadlineMs (4400s), both raised
# in lockstep so Node's own timeouts never fire before this one does.
LEAD_LEVEL_TIMEOUT_SECONDS = 4100.0

Conclusion = Literal["short_circuit_success", "exhausted_no_match", "timed_out"]


class PipelineResult(TypedDict):
    lead: Dict[str, Any]
    enrichment_status: str
    enrichment_percentage: int
    field_sources: Dict[str, str]
    audit: Dict[str, Any]
    execution_time_ms: int
    logs: list[str]
    conclusion: Optional[Conclusion]
    # Set whenever Parallel's Stage 3.5 call was attempted for this lead --
    # `called: True` with the resolved `data` dict on success, `called:
    # False` when skipped (already ran on a prior pass), or `called: True`
    # with no `data` key when the call itself failed (Tier 1's result still
    # stands either way). None when Parallel never applied at all (no
    # Profile_Link, or no API key configured). Unlike Clay's old
    # `clay_fallback`, this is never a "dispatched, result pending" marker --
    # Parallel's call is synchronous, so this field always reflects a
    # concluded outcome by the time this dict is built.
    parallel_fallback: Optional[Dict[str, Any]]
    # Set whenever Stage 6's Claude web-search call was attempted for this
    # lead -- same shape/meaning as parallel_fallback above (`called: True`
    # with `data` on success, `called: False` when skipped, `called: True`
    # with no `data` key on failure). None when Stage 6 never applied at all
    # (short-circuited, over the field-count threshold, or only contact
    # fields were missing).
    websearch_fallback: Optional[Dict[str, Any]]
    # The COMPLETE raw scrape payload (Bright Data or Tavily, whichever ran)
    # -- previously computed as raw_source_text purely for internal LLM
    # fallback verification, then discarded before the response was even
    # built. Same "nothing dropped" principle as Parallel's full data:
    # drafting can't personalize on detail that was never handed to it.
    # None if no scrape ran or it returned nothing.
    raw_enrichment_data: Optional[Any]


class EnrichmentOrchestrator:
    """7-Stage Enrichment Pipeline Orchestrator."""

    def __init__(self, config: Config):
        self.config = config
        self.brightdata = BrightDataClient(config) if config.brightdata_api_key else None
        self.tavily = TavilyClient(config) if config.tavily_api_key else None
        self.claude = ClaudeClient(config) if config.claude_api_key else None
        self.parallel = ParallelClient(config) if config.parallel_api_key else None

        self.parsers = {
            "linkedin": LinkedInParser(),
            "ada": AdaParser(),
            "proz": ProzParser(),
            "bodalgo": BodalgoParser(),
            "ata": AtaParser(),
            "ataa": AtaaParser(),
            "generic_llm": GenericParser(),
        }

    def _timed_out_result(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], start_time: float, stage: str
    ) -> PipelineResult:
        """Builds a terminal result for the lead-level ceiling firing before
        the waterfall could conclude either way -- distinct from
        `exhausted_no_match` (every step ran to its own conclusion, this one
        aborted mid-sequence) and from a genuine crash (this is a clean,
        expected abort, not an unhandled exception)."""
        msg = f"Lead-level {LEAD_LEVEL_TIMEOUT_SECONDS:.0f}s timeout hit before {stage} -- aborting waterfall run"
        logs.append(msg)
        log.warning(msg)
        audit = audit_lead_fields(lead)
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        return {
            "lead": lead,
            "enrichment_status": "enrichment_partial",
            "enrichment_percentage": audit["enrichment_percentage"],
            "field_sources": field_sources,
            "audit": audit,
            "execution_time_ms": elapsed_ms,
            "logs": logs,
            "parallel_fallback": None,
            "websearch_fallback": None,
            "raw_enrichment_data": None,
            "conclusion": "timed_out",
        }

    def _run_linkedin_steps(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], profile_link: str
    ) -> tuple[Any, str, Optional[Dict[str, Any]]]:
        """LinkedIn waterfall, steps 1-2 of 3: Bright Data -> Parallel.
        Differs from the non-LinkedIn shape only in its Tier 1 provider --
        both now share _dispatch_parallel_stage()/_resolve_parallel_stage()
        for Tier 2, run CONCURRENTLY with this method's own Tier 1 scrape
        rather than after it (see _dispatch_parallel_stage's docstring)."""
        raw_scraped_data: Any = None
        raw_source_text = ""

        # Dispatched BEFORE Tier 1's blocking scrape below, not after -- the
        # two calls share nothing but the profile URL, so there was never a
        # real reason for Parallel to wait out Tier 1's own 7-15s before
        # starting. Resolved only after Tier 1's merge, further down, so merge
        # ORDER (Tier 1 first) is unchanged.
        parallel_early_result, parallel_future, parallel_attempts = self._dispatch_parallel_stage(
            lead, field_sources, logs, profile_link
        )

        if profile_link and self.brightdata:
            try:
                raw_scraped_data = self.brightdata.scrape_profile(profile_link)
                # json.dumps (not Python's str()) so the LLM fallback sees
                # standard double-quoted JSON -- str() renders None/True as
                # Python literals and adds repr noise that wastes the
                # 8000-char budget extract_critical_fields truncates to.
                raw_source_text = json.dumps(raw_scraped_data, ensure_ascii=False, default=str)
            except BrightDataError as exc:
                msg = f"Scraping warning (brightdata): {exc}"
                logs.append(msg)
                log.warning(msg)
        else:
            # Previously this branch did not exist, so Tier 1 being disabled
            # was indistinguishable from Tier 1 running and finding nothing:
            # both left raw_scraped_data as None with not one line of output.
            # That is the worst possible failure to debug, because it looks
            # exactly like a blocked profile. Confirmed live 2026-09-08 on a
            # lead whose LinkedIn profile Bright Data scrapes perfectly on
            # demand (name, About, education, certifications all returned)
            # yet whose stored rawScrapeData was NULL -- with nothing in the
            # service log to say why, since `self.brightdata` is None
            # whenever BRIGHTDATA_API_KEY is absent from the environment.
            # Stage 3.5 already announces its own missing key; Tier 1 stayed
            # silent. It no longer does.
            msg = _tier1_skip_reason("BRIGHTDATA_API_KEY", profile_link, self.brightdata)
            logs.append(msg)
            log.warning(msg)

        if raw_scraped_data is not None:
            self._merge_stage3_parsed(lead, field_sources, logs, "linkedin", "brightdata", raw_scraped_data)

        post_stage3_audit = audit_lead_fields(lead)
        logs.append(f"Stage 3 Complete: Score = {post_stage3_audit['enrichment_percentage']}%")

        # Tier 1's merge is already applied above -- resolving Tier 2 here,
        # not before, is what keeps _apply_parsed_fields' override precedence
        # (Tier 1 first, Tier 2 second) unchanged from before this was made
        # concurrent.
        if parallel_future is not None:
            parallel_fallback = self._resolve_parallel_stage(
                parallel_future, parallel_attempts, lead, field_sources, logs, "brightdata"
            )
        else:
            parallel_fallback = parallel_early_result
        return raw_scraped_data, raw_source_text, parallel_fallback

    def _dispatch_parallel_stage(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], profile_link: str,
    ) -> "tuple[Optional[Dict[str, Any]], Optional[Future], int]":
        """Non-blocking half of Stage 3.5. Shared by BOTH waterfall shapes.
        Clay's version of this stage was hard-gated to linkedin.com/in|sales
        URLs, because Clay's own "Enrich person" action rejected anything
        else outright ("Invalid person identifier", confirmed against its
        dashboard 2026-08-26). Parallel has no such limitation -- the PoC ran
        it successfully against ProZ, Bodalgo, ATA/ATAA and Freelancer.com
        profile URLs -- so carrying that gate forward was an artificial
        holdover from the previous provider that left non-LinkedIn leads
        permanently without Tier 2 data and split enrichment provenance
        across the table. The gate is simply "is there a profile URL to
        research", which is the real precondition, checked below.

        Every early-exit check this stage has always made (no URL, already
        settled, key not configured) is performed up front so it costs
        nothing, and -- only if none of them apply -- the network call is
        SUBMITTED rather than awaited. Returns one of:

          (result, None, 0)      -- an early-exit result; nothing to resolve.
          (None, future, n)      -- dispatched; call _resolve_parallel_stage
                                     with `future` and attempts-so-far `n`
                                     once Tier 1's OWN merge has been applied.
          (None, None, 0)        -- Parallel not configured; nothing to do.

        `lead` is passed as a SHALLOW COPY taken at this exact moment, not the
        live mutable dict -- Tier 1's scrape (running concurrently in the
        caller) will go on to mutate `lead` via `_merge_stage3_parsed`, and
        `enrich_profile` only ever reads `lead.get("Full_Name")` to build its
        request. A snapshot makes that read deterministic (always "whatever
        Full_Name held at dispatch time") instead of racing Tier 1's write,
        and costs nothing in practice: Full_Name is a required field at
        Add-Lead time, so it is already populated in nearly every case before
        either tier ever runs -- Tier 1 only occasionally corrects it (a
        verified spelling), and profile_link is what Parallel actually reads
        the page from, not the name.
        """
        state = field_sources.get("_parallel_fallback")

        if not profile_link:
            logs.append("Stage 3.5 skipped: no Profile_Link for Parallel to research")
            return None, None, 0

        settled = _parallel_state_is_settled(state)
        if settled:
            logs.append(f"Stage 3.5 skipped: {settled} (state={state!r}), not re-calling")
            return {"called": False, "reason": f"already_{state}"}, None, 0

        if not self.parallel:
            logs.append("Stage 3.5 skipped: PARALLEL_API_KEY not configured")
            return None, None, 0

        attempts_so_far = _parallel_attempts(state)
        future = _tier_overlap_executor.submit(self.parallel.enrich_profile, dict(lead), profile_link)
        return None, future, attempts_so_far

    def _resolve_parallel_stage(
        self, future: Future, attempts_so_far: int,
        lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], tier1_label: str,
    ) -> Optional[Dict[str, Any]]:
        """Stage 3.5's blocking half: wait for the call `_dispatch_parallel_stage`
        already submitted, then apply the exact merge/error-handling logic
        this method always had. Called only AFTER Tier 1's own merge is
        applied in the caller -- merge ORDER (not dispatch order) is what
        `_apply_parsed_fields`' override precedence depends on, and that
        order is unchanged by making the two calls run concurrently.

        This call either returns resolved fields or raises before it
        returns, so there is no "still pending" state left for the rest of
        the waterfall (or Node) to account for -- contrast with Clay's old
        `_clay_dispatch: "pending"` marker, which no longer has an
        equivalent here.

        Re-attempt policy (see PARALLEL_STATE_* above): a success or a
        permanent rejection is final; a transient failure is retried on later
        passes up to MAX_PARALLEL_TRANSIENT_ATTEMPTS."""
        try:
            parallel_data = future.result()
            parallel_data = self._normalize_parallel_language(parallel_data, logs)

            if _is_empty_parallel_result(parallel_data):
                # Technically a success (no exception), but empty -- Martin
                # Godart's actual case: every field null/[], because Parallel's
                # browsing agent hit the same LinkedIn block Bright Data did.
                # This used to be stamped COMPLETE on the very first attempt,
                # which meant the 2-attempt transient-retry policy below --
                # already decided on and already built -- never even engaged,
                # since it only ever fired for a genuine exception. Routing an
                # empty-but-well-formed result through the SAME transient path
                # gives it the real second attempt that policy was meant to
                # guarantee, on the chance a retry lands on a different
                # session/IP than the one that just got blocked.
                msg = self._record_parallel_transient(field_sources, attempts_so_far, "returned no usable content")
                logs.append(msg)
                log.warning(msg)
                return {"called": True, "reason": tier1_label, "error": "empty result"}

            field_sources["_parallel_fallback"] = PARALLEL_STATE_COMPLETE
            msg = f"Stage 3.5: Parallel call complete ({tier1_label} scrape already ran)"
            logs.append(msg)
            log.info("Lead %s: %s", lead.get("Full_Name") or profile_link, msg)
            self._merge_parallel_fields(lead, field_sources, logs, parallel_data)
            return {"called": True, "reason": tier1_label, "data": parallel_data}
        except ParallelError as exc:
            if getattr(exc, "permanent", False):
                field_sources["_parallel_fallback"] = PARALLEL_STATE_FAILED_PERMANENT
                msg = f"Stage 3.5: Parallel rejected this lead's input, not retrying: {exc}"
                logs.append(msg)
                log.error(msg)
            else:
                msg = self._record_parallel_transient(field_sources, attempts_so_far, str(exc))
                logs.append(msg)
                log.error(msg)
            return {"called": True, "reason": tier1_label, "error": str(exc)}

    @staticmethod
    def _record_parallel_transient(field_sources: Dict[str, str], attempts_so_far: int, reason: str) -> str:
        """Stamps the next transient-attempt marker and returns the log line
        -- shared by a genuine exception and an empty-but-successful result,
        since both consume the same 2-attempt budget the same way."""
        attempts = attempts_so_far + 1
        field_sources["_parallel_fallback"] = f"{PARALLEL_STATE_FAILED_TRANSIENT_PREFIX}{attempts}"
        remaining = MAX_PARALLEL_TRANSIENT_ATTEMPTS - attempts
        return (
            f"Stage 3.5: Parallel call failed (attempt {attempts}/"
            f"{MAX_PARALLEL_TRANSIENT_ATTEMPTS}, "
            f"{'will retry on a later pass' if remaining > 0 else 'attempts exhausted'}): {reason}"
        )

    def _run_websearch_stage(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        web_search_targets: list[str], profile_link: str, source_platform: str,
    ) -> Optional[Dict[str, Any]]:
        """Stage 6: Claude web search -- Tier 3, replacing the old raw-text
        extraction entirely. Fires only when the lead is still thin after
        Bright Data/Tavily and Parallel have both had their (retried) chance
        (see MAX_FIELDS_BEFORE_WEBSEARCH in process_lead) -- exactly the
        backstop a persistently-blocked profile (a LinkedIn 301, a dead ProZ
        link) needs, since neither earlier tier has anything left to try.

        Re-attempt policy mirrors _dispatch_parallel_stage/_resolve_parallel_stage's: a genuine success or
        a permanent rejection is final; an empty-but-successful result (the
        model reported could_not_find_anything, or cited no source) is
        routed through the SAME transient-retry bookkeeping a raised
        ClaudeError would use, up to MAX_WEBSEARCH_TRANSIENT_ATTEMPTS -- the
        exact "successful but empty must still get its retry" fix Part 0
        made for Parallel, applied here from the start rather than
        discovered as a second bug later.
        """
        state = field_sources.get("_websearch_fallback")
        settled = _websearch_state_is_settled(state)
        if settled:
            logs.append(f"Stage 6 skipped: {settled} (state={state!r}), not re-calling")
            return {"called": False, "reason": f"already_{state}"}

        if not self.claude:
            logs.append("Stage 6 skipped: CLAUDE_API_KEY not configured")
            return None

        attempts_so_far = _websearch_attempts(state)
        full_name = lead.get("Full_Name") or ""

        try:
            web_result = self.claude.search_missing_fields(web_search_targets, full_name, profile_link, source_platform)
            verified = filter_web_search_result(web_result, web_search_targets)

            if not verified:
                msg = self._record_websearch_transient(field_sources, attempts_so_far, "found nothing usable/verifiable")
                logs.append(msg)
                log.warning(msg)
                return {"called": True, "reason": "web_search", "error": "empty result"}

            field_sources["_websearch_fallback"] = WEBSEARCH_STATE_COMPLETE
            msg = f"Stage 6: Web search complete, sources={web_result.get('sources_used')}"
            logs.append(msg)
            log.info("Lead %s: %s", full_name or profile_link, msg)
            self._apply_parsed_fields(lead, field_sources, logs, "llm_fallback", verified)
            return {"called": True, "reason": "web_search", "data": web_result}
        except ClaudeError as exc:
            if getattr(exc, "permanent", False):
                field_sources["_websearch_fallback"] = WEBSEARCH_STATE_FAILED_PERMANENT
                msg = f"Stage 6: Claude rejected this web-search request, not retrying: {exc}"
                logs.append(msg)
                log.error(msg)
            else:
                msg = self._record_websearch_transient(field_sources, attempts_so_far, str(exc))
                logs.append(msg)
                log.error(msg)
            return {"called": True, "reason": "web_search", "error": str(exc)}

    @staticmethod
    def _record_websearch_transient(field_sources: Dict[str, str], attempts_so_far: int, reason: str) -> str:
        """Stamps the next transient-attempt marker and returns the log line
        -- shared by a genuine exception and an empty-but-successful result,
        mirroring _record_parallel_transient."""
        attempts = attempts_so_far + 1
        field_sources["_websearch_fallback"] = f"{WEBSEARCH_STATE_FAILED_TRANSIENT_PREFIX}{attempts}"
        remaining = MAX_WEBSEARCH_TRANSIENT_ATTEMPTS - attempts
        return (
            f"Stage 6: Web search failed (attempt {attempts}/"
            f"{MAX_WEBSEARCH_TRANSIENT_ATTEMPTS}, "
            f"{'will retry on a later pass' if remaining > 0 else 'attempts exhausted'}): {reason}"
        )

    def _run_non_linkedin_steps(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        profile_link: str, provider_type: str, parser_name: str,
    ) -> tuple[Any, str, Optional[Dict[str, Any]]]:
        """Non-LinkedIn waterfall, steps 1-2 of 3: Tavily -> Parallel. Parallel
        used to be unreachable from this path by construction (a holdover from
        Clay, which rejected non-LinkedIn identifiers); it now runs here too,
        via the same _dispatch_parallel_stage()/_resolve_parallel_stage() the
        LinkedIn path uses, so a ProZ/Bodalgo/personal-site lead gets the same
        Tier 2 treatment -- run CONCURRENTLY with this method's own Tavily
        call rather than after it (see _dispatch_parallel_stage's docstring)."""
        raw_scraped_data: Any = None
        raw_source_text = ""

        # Dispatched before Tavily's blocking call, same reasoning as the
        # LinkedIn path: the two share nothing but the profile URL.
        parallel_early_result, parallel_future, parallel_attempts = self._dispatch_parallel_stage(
            lead, field_sources, logs, profile_link
        )

        if profile_link and self.tavily:
            try:
                if provider_type == "tavily_search":
                    raw_scraped_data = self.tavily.search_snippets(f"site:proz.com {lead.get('Full_Name', '')}".strip(), include_domains=["proz.com"])
                    raw_source_text = json.dumps(raw_scraped_data, ensure_ascii=False, default=str)
                elif provider_type == "tavily_extract":
                    raw_scraped_data = self.tavily.extract_url(profile_link)
                    raw_source_text = raw_scraped_data.get("raw_content", "")
            except TavilyError as exc:
                msg = f"Scraping warning ({provider_type}): {exc}"
                logs.append(msg)
                log.warning(msg)
        else:
            # Same silent-skip gap as the LinkedIn path above, same fix.
            msg = _tier1_skip_reason("TAVILY_API_KEY", profile_link, self.tavily)
            logs.append(msg)
            log.warning(msg)

        if raw_scraped_data is not None:
            self._merge_stage3_parsed(lead, field_sources, logs, parser_name, "tavily", raw_scraped_data)

        post_stage3_audit = audit_lead_fields(lead)
        logs.append(f"Stage 3 Complete: Score = {post_stage3_audit['enrichment_percentage']}%")

        # Tier 1's merge is already applied above -- see the LinkedIn path's
        # matching comment for why resolve-after-merge is what preserves
        # override precedence.
        if parallel_future is not None:
            parallel_fallback = self._resolve_parallel_stage(
                parallel_future, parallel_attempts, lead, field_sources, logs, provider_type
            )
        else:
            parallel_fallback = parallel_early_result
        return raw_scraped_data, raw_source_text, parallel_fallback

    def _apply_parsed_fields(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        source_label: str, parsed: Dict[str, Any],
        force_keys: Optional[set] = None,
    ) -> None:
        """Shared merge rule for ANY stage that resolves canonical fields
        (Stage 3's scrape parsers, Stage 3.5's Parallel call): NEVER
        overwrite existing data -- EXCEPT OVERRIDE_ON_VERIFIED_FIELDS.

        `force_keys` lifts that rule for named fields on this one write. Its
        only caller is English normalisation, and only for a profile it has
        established is NOT in English -- in which case whatever is sitting in
        Headline/About_Snippet/Current_Title/Country_of_Residence is either
        the source-language text or an earlier provider's reading of the same
        non-English page, and the freshly translated value supersedes it.
        Without this the English text reached `parallelData` but the canonical
        column kept the Spanish, and those columns are exactly what the
        enrichment dialog's field rows and drafting's flat facts read -- so
        the translation was invisible in both places it exists for.

        A first attempt matched the stored value against the pre-translation
        string exactly, which was too brittle to work: extraction isn't
        byte-identical run to run, so a lead re-enriched later kept its
        Spanish `about_snippet` while its headline updated. Recruiter edits
        stay safe regardless -- enrichLeadById refuses to overwrite any field
        tagged `manual` before this result is ever persisted.
        """
        for k, v in parsed.items():
            if is_empty_value(v):
                continue
            forced = force_keys is not None and k in force_keys
            if forced and lead.get(k) != v:
                lead[k] = v
                field_sources[k] = source_label
                logs.append(f"Stage Parsed: {k} = {v!r} (from {source_label}, English normalisation replaces the source-language value)")
            elif k in OVERRIDE_ON_VERIFIED_FIELDS:
                # Mark it verified even when the resolved value happens to
                # match the manual one -- otherwise field_sources stays
                # "existing" and Stage 4 would needlessly re-send an
                # already-confirmed field to the LLM fallback.
                if lead.get(k) != v:
                    lead[k] = v
                    field_sources[k] = source_label
                    logs.append(f"Stage Parsed: {k} = {v!r} (from {source_label}, verified profile overrides manual entry)")
                else:
                    field_sources[k] = source_label
                    logs.append(f"Stage Parsed: {k} = {v!r} (from {source_label}, confirmed matches manual entry)")
            elif is_empty_value(lead.get(k)):
                lead[k] = v
                field_sources[k] = source_label
                logs.append(f"Stage Parsed: {k} = {v!r} (from {source_label})")

    def _merge_stage3_parsed(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        parser_name: str, source_label: str, raw_scraped_data: Any,
    ) -> None:
        """Stage 3 merge for a raw scrape payload that still needs a parser
        (BrightData/Tavily) -- parses first, then applies the same override
        rule every resolved-field source shares (see _apply_parsed_fields)."""
        parser = self.parsers.get(parser_name, GenericParser())
        profile_link = lead.get("Profile_Link", "")
        stage3_parsed = parser.parse(profile_link, raw_scraped_data)
        self._apply_parsed_fields(lead, field_sources, logs, source_label, stage3_parsed)

    def _normalize_parallel_language(self, parallel_data: Dict[str, Any], logs: list[str]) -> Dict[str, Any]:
        """Turn a source-language Parallel payload into English, keeping the
        original alongside it.

        Parallel extracts in whatever language the profile is written in (see
        providers/parallel_client.py's LeadProfile on why translating at
        extraction time loses detail), but everything downstream is English:
        the recruiter-facing enrichment dialog, and the drafting prompt, which
        quotes these fields back to the lead inside an English email.
        Confirmed live 2026-09-07: two Bodalgo leads came back with Spanish
        headlines and bios ("Cálida, dinámica, impactante...") that drafting
        would have pasted straight into an English message.

        Failure here is NOT enrichment failure. If translation can't be done
        -- no Claude key, an API error -- the untranslated payload is returned
        as-is, because source-language data is worth far more than none.
        `_original_language` keeps the pre-translation payload so nothing is
        ever lost to a bad translation either.
        """
        if not parallel_data or not _looks_non_english(parallel_data):
            return parallel_data
        if not self.claude:
            logs.append("Stage 3.5: profile is not in English, but CLAUDE_API_KEY isn't set -- keeping it untranslated")
            return parallel_data

        try:
            translated = self.claude.translate_to_english(parallel_data)
        except ClaudeError as exc:
            msg = f"Stage 3.5: English normalisation failed, keeping the original-language data: {exc}"
            logs.append(msg)
            log.warning(msg)
            return parallel_data

        if not isinstance(translated, dict) or not translated:
            logs.append("Stage 3.5: English normalisation returned nothing usable -- keeping the original-language data")
            return parallel_data

        # Never let translation DROP a key that had content. A missing key here
        # means information was lost in translation, which is the one outcome
        # worth rejecting the whole result over -- the point of translating
        # separately was to stop losing detail, not to move where it happens.
        lost = [k for k, v in parallel_data.items() if not is_empty_value(v) and is_empty_value(translated.get(k))]
        if lost:
            msg = f"Stage 3.5: English normalisation dropped {lost} -- keeping the original-language data instead"
            logs.append(msg)
            log.warning(msg)
            return parallel_data

        translated["_original_language"] = parallel_data
        logs.append("Stage 3.5: profile wasn't in English -- normalised to English (original kept under _original_language)")
        return translated

    def _merge_parallel_fields(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], parallel_data: Dict[str, Any],
    ) -> None:
        """Maps Parallel's Task Run output (LeadProfile schema, see
        providers/parallel_client.py) onto canonical lead fields. Already
        structured data -- no parser needed, contrast with BrightData/
        Tavily's raw-payload-plus-parser path above."""
        mapped: Dict[str, Any] = {}
        if parallel_data.get("headline"):
            mapped["Headline"] = parallel_data["headline"]
        if parallel_data.get("current_title"):
            mapped["Current_Title"] = parallel_data["current_title"]
        if parallel_data.get("about_snippet"):
            mapped["About_Snippet"] = parallel_data["about_snippet"]
        if parallel_data.get("country"):
            mapped["Country_of_Residence"] = parallel_data["country"]
        certs = parallel_data.get("certifications")
        if isinstance(certs, list):
            kept = [str(c) for c in certs if c and not _is_absence_prose(str(c))]
            dropped = len(certs) - len(kept)
            if dropped:
                logs.append(
                    f"Stage 3.5: dropped {dropped} non-data 'nothing found' string(s) Parallel put in `certifications` "
                    f"instead of returning an empty list"
                )
            if kept:
                mapped["Certifications"] = ", ".join(kept)

        # `_original_language` present means this profile was established to
        # be non-English and the values above are its translation. Whatever is
        # currently in these four columns therefore came from the same
        # non-English page, so the translated text supersedes it -- otherwise
        # the English only ever reaches `parallelData` and the dialog's field
        # rows keep showing the source language. Scoped to exactly the fields
        # that carry translated free text, so the never-overwrite rule still
        # holds for everything else.
        force_keys = None
        if isinstance(parallel_data.get("_original_language"), dict):
            force_keys = {"Headline", "Current_Title", "About_Snippet", "Country_of_Residence"}

        self._apply_parsed_fields(lead, field_sources, logs, "parallel", mapped, force_keys=force_keys)

    def process_lead(self, lead_input: Dict[str, Any], known_field_sources: Optional[Dict[str, str]] = None) -> PipelineResult:
        start_time = time.monotonic()
        lead = dict(lead_input)
        logs: list[str] = []
        # Seed from the caller's persisted record of what was already
        # resolved (and how) on a prior run for this same lead, so a repeat
        # enrichment doesn't re-spend an LLM call re-verifying something
        # already settled -- see `_unverified()` below.
        field_sources: Dict[str, str] = dict(known_field_sources or {})

        # Mark any populated field not already carrying a known source as "existing"
        initial_audit = audit_lead_fields(lead)
        for k, v in lead.items():
            if not is_empty_value(v) and k not in field_sources:
                field_sources[k] = "existing"

        logs.append(f"Stage 1 Complete: Initial Enrichment Score = {initial_audit['enrichment_percentage']}% ({initial_audit['populated_count']}/{initial_audit['total_fields']} fields)")
        log.info("Lead %s baseline score: %d%%", lead.get("Full_Name") or lead.get("Profile_Link") or "unnamed", initial_audit["enrichment_percentage"])

        # Stage 2: Source Router (based strictly on explicit Source dropdown value)
        source_val = lead.get("Source", "")
        profile_link = lead.get("Profile_Link", "")
        provider_type, parser_name = route_lead(source_val)

        logs.append(f"Stage 2 Router: Source={source_val!r} -> Provider={provider_type!r}, Parser={parser_name!r}")

        if time.monotonic() - start_time >= LEAD_LEVEL_TIMEOUT_SECONDS:
            return self._timed_out_result(lead, field_sources, logs, start_time, "Stage 3 (scrape)")

        # Stage 3 + 3.5: two waterfall shapes that differ only in their
        # Tier 1 provider -- LinkedIn uses Bright Data, every other platform
        # uses Tavily -- and then share Tier 2 (Parallel, via
        # _dispatch_parallel_stage/_resolve_parallel_stage) and the Tier 3 LLM
        # fallback below. Parallel was
        # LinkedIn-only while Clay held that position, since Clay rejected
        # every other identifier; that gate is gone (see
        # _dispatch_parallel_stage's docstring).
        if provider_type == "brightdata":
            raw_scraped_data, raw_source_text, parallel_fallback = self._run_linkedin_steps(lead, field_sources, logs, profile_link)
        else:
            raw_scraped_data, raw_source_text, parallel_fallback = self._run_non_linkedin_steps(
                lead, field_sources, logs, profile_link, provider_type, parser_name
            )

        if time.monotonic() - start_time >= LEAD_LEVEL_TIMEOUT_SECONDS:
            return self._timed_out_result(lead, field_sources, logs, start_time, "Stage 4-6 (LLM fallback)")

        post_stage3_audit = audit_lead_fields(lead)

        # Stage 4: Critical Field Audit & LLM Bypass Guard
        missing_critical = post_stage3_audit["missing_critical_fields"]

        # A field counts as "still resting on an unverified manual entry" if
        # it hasn't been confirmed by a scrape ("brightdata"/"tavily"), by
        # Parallel ("parallel"), or by a prior LLM-verified pass
        # ("llm_fallback", persisted by the caller via known_field_sources) --
        # covers a field that's still empty AND a populated-but-never-verified
        # manual guess, while never re-asking about something already settled
        # on an earlier run of this same lead. Many BrightData LinkedIn
        # profiles don't return a structured skills/languages section at all
        # (confirmed in production), so this free-text LLM pass is sometimes
        # the only way to catch a wrong manual guess -- but only needs to run
        # once per lead, not every time.
        def _unverified(field: str) -> bool:
            return field_sources.get(field) not in ("brightdata", "tavily", "parallel", "llm_fallback")

        override_candidates = [f for f in OVERRIDE_ON_VERIFIED_FIELDS if _unverified(f)]
        missing_fill_only = [f for f in FILL_ONLY_ENRICHABLE_FIELDS if is_empty_value(lead.get(f))]
        fallback_targets = list(dict.fromkeys(missing_critical + override_candidates + missing_fill_only))

        # Waterfall order: Bright Data/Tavily -> Parallel -> Claude web
        # search, in that priority -- web search is the last resort, run only
        # after Parallel has already had its (synchronous,
        # already-concluded-by-this-point) chance. Unlike Clay's old async
        # design, there is no "still awaiting" state to check here -- Stage
        # 3.5 above either ran to completion or was skipped/failed before
        # this line, so Stage 4 always sees a settled picture of the lead.
        websearch_fallback: Optional[Dict[str, Any]] = None
        if not fallback_targets:
            # ABSOLUTE RULE: nothing left to fill or verify -- BYPASS LLM STAGE ENTIRELY
            msg = "Stage 4 Bypass Guard: nothing left for the LLM to fill or verify! BYPASSING LLM FALLBACK ENTIRELY."
            logs.append(msg)
            log.info(msg)
            conclusion: Conclusion = "short_circuit_success"
        else:
            # Every step that could run for this platform has now been
            # attempted (scrape, Parallel) -- whatever this pass ends up with
            # is a normal, concluded result, not a failure of the waterfall
            # itself, whether Stage 6 below fires, is skipped, or fails.
            conclusion = "exhausted_no_match"
            logs.append(f"Stage 4 Audit: Target fields {fallback_targets}")

            web_search_targets = [f for f in fallback_targets if f not in WEBSEARCH_EXCLUDED_FIELDS]
            # Scoped to the fields Stage 6 could actually fill -- see
            # MAX_FIELDS_BEFORE_WEBSEARCH's comment for why the 10-field UI
            # metric was the wrong denominator for this decision.
            fillable_count = count_stage6_fillable_fields(lead, field_sources)

            if not self.config.stage6_websearch_enabled:
                logs.append("Stage 6 skipped: disabled (STAGE6_WEBSEARCH_ENABLED is not 'true')")
            elif fillable_count > MAX_FIELDS_BEFORE_WEBSEARCH:
                logs.append(
                    f"Stage 6 skipped: {fillable_count} fillable fields already enriched "
                    f"(> {MAX_FIELDS_BEFORE_WEBSEARCH}), web search reserved for thin leads"
                )
            elif not web_search_targets:
                logs.append("Stage 6 skipped: only Email_Address/Contact_Number are missing, which web search never fills")
            else:
                websearch_fallback = self._run_websearch_stage(
                    lead, field_sources, logs, web_search_targets, profile_link, provider_type
                )

        # Stage 7: Finalize & Score Calculation
        final_audit = audit_lead_fields(lead)
        status = "enrichment_complete" if final_audit["is_complete"] else "enrichment_partial"
        elapsed_ms = int((time.monotonic() - start_time) * 1000)

        logs.append(f"Stage 7 Finalize: Status={status}, Final Enrichment Score={final_audit['enrichment_percentage']}% (Elapsed: {elapsed_ms}ms)")

        return {
            "lead": lead,
            "enrichment_status": status,
            "enrichment_percentage": final_audit["enrichment_percentage"],
            "field_sources": field_sources,
            "audit": final_audit,
            "execution_time_ms": elapsed_ms,
            "logs": logs,
            "parallel_fallback": parallel_fallback,
            "websearch_fallback": websearch_fallback,
            "raw_enrichment_data": raw_scraped_data,
            "conclusion": conclusion,
        }
