"""Main Pipeline Orchestrator connecting all 7 enrichment stages."""

from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, Literal, Optional, TypedDict

from config import Config
from core.field_audit import audit_lead_fields
from core.schema import is_empty_value
from core.source_router import route_lead
from llm_fallback.client import ClaudeClient, ClaudeError
from llm_fallback.prompt_builder import build_targeted_prompt
from llm_fallback.verifier import verify_against_source
from logger import get_logger
from providers.brightdata_client import BrightDataClient, BrightDataError
from providers.clay_client import ClayClient, ClayError
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
# about when still empty after Stage 3's deterministic parse.
FILL_ONLY_ENRICHABLE_FIELDS = ["Current_Title", "Tools_Software", "Certifications"]

# Lead-level cumulative budget across the WHOLE waterfall call sequence for
# one lead -- real elapsed time via time.monotonic(), not a sum of each
# step's own 15s deadline (core/resilience.py's RetryPolicy.deadline_seconds
# already bounds each individual provider call; this is a separate,
# outer safety net). Worst case today: LinkedIn's up-to-2 sequential
# provider calls before Stage 4-6 (BrightData, Clay) + the LLM fallback call
# itself = 3 x 15s = 45s; non-LinkedIn = 2 x 15s = 30s -- both comfortably
# under this ceiling, so it's not expected to fire in the common case.
LEAD_LEVEL_TIMEOUT_SECONDS = 60.0

Conclusion = Literal["short_circuit_success", "exhausted_no_match", "timed_out"]


class PipelineResult(TypedDict):
    lead: Dict[str, Any]
    enrichment_status: str
    enrichment_percentage: int
    field_sources: Dict[str, str]
    audit: Dict[str, Any]
    execution_time_ms: int
    logs: list[str]
    # None while Clay's async dispatch is still pending (`_clay_dispatch ==
    # "pending"`, see clay_awaiting below) -- that pass hasn't concluded one
    # way or another yet, distinct from all three named states, and is
    # already correctly handled by enrichment_status/field_sources alone
    # (Node's enrichLeadById reads clay_awaiting from field_sources, not
    # this). Populated for every other return path.
    conclusion: Optional[Conclusion]
    # Set only when Bright Data returned nothing for a LinkedIn profile and
    # Clay's async fallback was dispatched. `correlation_id` is what
    # /api/webhooks/clay (Node) matches Clay's later result back to this
    # lead by -- currently Profile_Link, since no lead-id crosses this
    # request boundary today. `None` means Clay was never triggered.
    clay_fallback: Optional[Dict[str, Any]]
    # The COMPLETE raw scrape payload (Bright Data or Tavily, whichever ran)
    # -- previously computed as raw_source_text purely for internal LLM
    # fallback verification, then discarded before the response was even
    # built. Same "nothing dropped" principle as Clay's clay_data: drafting
    # can't personalize on detail that was never handed to it. None if no
    # scrape ran or it returned nothing.
    raw_enrichment_data: Optional[Any]


class EnrichmentOrchestrator:
    """7-Stage Enrichment Pipeline Orchestrator."""

    def __init__(self, config: Config):
        self.config = config
        self.brightdata = BrightDataClient(config) if config.brightdata_api_key else None
        self.tavily = TavilyClient(config) if config.tavily_api_key else None
        self.claude = ClaudeClient(config) if config.claude_api_key else None
        self.clay = ClayClient(config) if config.clay_webhook_url else None

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
        """Builds a terminal result for the 60s lead-level ceiling firing
        before the waterfall could conclude either way -- distinct from
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
            "clay_fallback": None,
            "raw_enrichment_data": None,
            "conclusion": "timed_out",
        }

    def _run_linkedin_steps(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], profile_link: str
    ) -> tuple[Any, str, Optional[Dict[str, Any]]]:
        """LinkedIn waterfall, steps 1-2 of 3: Bright Data -> Clay. The only
        method that ever references self.clay -- structurally, not just
        behaviorally, the non-LinkedIn path below has no way to reach it."""
        raw_scraped_data: Any = None
        raw_source_text = ""

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

        if raw_scraped_data is not None:
            self._merge_stage3_parsed(lead, field_sources, logs, "linkedin", "brightdata", raw_scraped_data)

        post_stage3_audit = audit_lead_fields(lead)
        logs.append(f"Stage 3 Complete: Score = {post_stage3_audit['enrichment_percentage']}%")

        # Stage 3.5: Clay fallback.
        #
        # BUG FIX (2026-08-26): went through two narrower gates before this
        # (total-miss-only, then email-missing-only) -- explicitly corrected
        # to fire for EVERY LinkedIn lead, unconditionally, once per lead.
        # Clay isn't just a gap-filler for a missing field; it's a genuinely
        # richer second enrichment pass (experience, education, courses,
        # languages -- see core/leads.py's grounding_facts on the drafting
        # side) that's worth having on every LinkedIn lead regardless of what
        # Bright Data already found. Deliberately NOT gated on completeness
        # (i.e. not skipped by a "short-circuit success" check) -- that would
        # silently regress this exact, already-fixed-once bug. Gate is just:
        # do we have a LinkedIn identifier Clay's Enrich Person action can
        # use, and has this lead not already been through Clay before.
        clay_fallback: Optional[Dict[str, Any]] = None
        # Confirmed live against Clay's own dashboard (2026-08-26): dispatching
        # a non-LinkedIn Profile_Link (ProZ/Bodalgo/personal-site URLs, even
        # with a real Email included in the same payload) makes Clay's
        # "Enrich person" waterfall action fail every row with "Invalid
        # input: Invalid person identifier" -- it does not fall back to
        # searching by email despite Email being sent as its own field. This
        # table's Enrich Person step is LinkedIn-URL-only.
        has_clay_identifier = bool(re.search(r"linkedin\.com/(in|sales)/", profile_link or "", re.IGNORECASE))
        clay_dispatch_state = field_sources.get("_clay_dispatch")
        already_dispatched = bool(clay_dispatch_state)

        if not has_clay_identifier:
            logs.append(
                "Stage 3.5 skipped: this lead has no LinkedIn URL -- Clay's Enrich Person action "
                "rejects everything else (ProZ/ATA/Bodalgo profile links, or an email alone) with "
                "'Invalid person identifier', confirmed live 2026-08-26"
            )
        elif already_dispatched:
            clay_fallback = {"dispatched": False, "correlation_id": profile_link, "reason": f"already_{clay_dispatch_state}"}
            logs.append(f"Stage 3.5 skipped: Clay fallback already attempted for this lead (state={clay_dispatch_state!r}), not re-dispatching")
        elif self.clay and profile_link:
            try:
                self.clay.dispatch_lead(lead, correlation_id=profile_link)
                field_sources["_clay_dispatch"] = "pending"
                clay_fallback = {"dispatched": True, "correlation_id": profile_link, "reason": "linkedin_lead"}
                msg = f"Stage 3.5: dispatched to Clay (LinkedIn lead, brightdata scrape complete) -- async, result arrives via webhook"
                logs.append(msg)
                log.info("Lead %s: %s", lead.get("Full_Name") or profile_link, msg)
            except ClayError as exc:
                msg = f"Stage 3.5: Clay dispatch failed: {exc}"
                logs.append(msg)
                log.error(msg)
        elif not self.clay:
            logs.append("Stage 3.5 skipped: LinkedIn lead, but CLAY_WEBHOOK_URL not configured")
        elif not profile_link:
            logs.append("Stage 3.5 skipped: LinkedIn lead, but no Profile_Link to use as Clay's correlation id")

        return raw_scraped_data, raw_source_text, clay_fallback

    def _run_non_linkedin_steps(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        profile_link: str, provider_type: str, parser_name: str,
    ) -> tuple[Any, str, Optional[Dict[str, Any]]]:
        """Non-LinkedIn waterfall, step 1 of 2: Tavily only. No reference to
        self.clay anywhere in this method -- structurally impossible for a
        non-LinkedIn lead to reach Clay, not merely gated by a URL check."""
        raw_scraped_data: Any = None
        raw_source_text = ""

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

        if raw_scraped_data is not None:
            self._merge_stage3_parsed(lead, field_sources, logs, parser_name, "tavily", raw_scraped_data)

        post_stage3_audit = audit_lead_fields(lead)
        logs.append(f"Stage 3 Complete: Score = {post_stage3_audit['enrichment_percentage']}%")

        # No Clay step reachable from this path at all -- not behaviorally
        # gated (as it effectively was before, via a URL regex any provider
        # type could theoretically satisfy), but structurally: this method
        # has no code path that calls self.clay, full stop.
        return raw_scraped_data, raw_source_text, None

    def _merge_stage3_parsed(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        parser_name: str, source_label: str, raw_scraped_data: Any,
    ) -> None:
        """Shared Stage 3 merge rules (identical for both waterfall shapes):
        NEVER overwrite existing data -- EXCEPT OVERRIDE_ON_VERIFIED_FIELDS."""
        parser = self.parsers.get(parser_name, GenericParser())
        profile_link = lead.get("Profile_Link", "")
        stage3_parsed = parser.parse(profile_link, raw_scraped_data)

        for k, v in stage3_parsed.items():
            if is_empty_value(v):
                continue
            if k in OVERRIDE_ON_VERIFIED_FIELDS:
                # Mark it verified even when the scraped value happens to
                # match the manual one -- otherwise field_sources stays
                # "existing" and Stage 4 would needlessly re-send an
                # already-confirmed field to the LLM fallback.
                if lead.get(k) != v:
                    lead[k] = v
                    field_sources[k] = source_label
                    logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {source_label}, verified profile overrides manual entry)")
                else:
                    field_sources[k] = source_label
                    logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {source_label}, confirmed matches manual entry)")
            elif is_empty_value(lead.get(k)):
                lead[k] = v
                field_sources[k] = source_label
                logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {source_label})")

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

        # Stage 3 + 3.5: two structurally distinct waterfall shapes --
        # LinkedIn (Bright Data -> Clay, 3 steps incl. the shared LLM
        # fallback below) vs every other platform (Tavily only, 2 steps).
        # `_run_non_linkedin_steps` has no code path that can reach Clay at
        # all, regardless of Profile_Link's contents -- not just gated by a
        # URL check.
        if provider_type == "brightdata":
            raw_scraped_data, raw_source_text, clay_fallback = self._run_linkedin_steps(lead, field_sources, logs, profile_link)
        else:
            raw_scraped_data, raw_source_text, clay_fallback = self._run_non_linkedin_steps(
                lead, field_sources, logs, profile_link, provider_type, parser_name
            )

        if time.monotonic() - start_time >= LEAD_LEVEL_TIMEOUT_SECONDS:
            return self._timed_out_result(lead, field_sources, logs, start_time, "Stage 4-6 (LLM fallback)")

        post_stage3_audit = audit_lead_fields(lead)

        # Stage 4: Critical Field Audit & LLM Bypass Guard
        missing_critical = post_stage3_audit["missing_critical_fields"]

        # A field counts as "still resting on an unverified manual entry" if
        # it hasn't been confirmed by a scrape ("brightdata"/"tavily") OR by
        # a prior LLM-verified pass ("llm_fallback", persisted by the caller
        # via known_field_sources) -- covers a field that's still empty AND a
        # populated-but-never-verified manual guess, while never re-asking
        # about something already settled on an earlier run of this same
        # lead. Many BrightData LinkedIn profiles don't return a structured
        # skills/languages section at all (confirmed in production), so this
        # free-text LLM pass is sometimes the only way to catch a wrong
        # manual guess -- but only needs to run once per lead, not every time.
        def _unverified(field: str) -> bool:
            return field_sources.get(field) not in ("brightdata", "tavily", "llm_fallback")

        override_candidates = [f for f in OVERRIDE_ON_VERIFIED_FIELDS if _unverified(f)]
        missing_fill_only = [f for f in FILL_ONLY_ENRICHABLE_FIELDS if is_empty_value(lead.get(f))]
        fallback_targets = list(dict.fromkeys(missing_critical + override_candidates + missing_fill_only))

        # Waterfall order: Bright Data/Tavily -> Clay -> AI extraction, in
        # that priority -- AI is the last resort, not a parallel guess fired
        # in the same pass as an in-flight Clay dispatch. `_clay_dispatch`
        # stays "pending" for both "just dispatched this pass" and "already
        # dispatched on a prior pass, still awaiting its webhook reply" (the
        # `already_dispatched` branch above doesn't touch it), so checking it
        # here after Stage 3.5 has run covers both cases uniformly. Once
        # Clay's webhook resolves it to "complete" (or the dispatch itself
        # failed/was never applicable), this stops blocking and the next
        # poll pass runs Stage 4-6 normally.
        clay_awaiting = field_sources.get("_clay_dispatch") == "pending"

        if clay_awaiting:
            msg = "Stage 4 skipped: Clay fallback is still awaiting its async result -- AI extraction only runs after Clay has had its chance (or Clay doesn't apply to this lead)."
            logs.append(msg)
            log.info(msg)
            # Not one of the 3 named conclusion states -- this pass hasn't
            # concluded either way yet, purely awaiting Clay's async webhook.
            # enrichment_status/field_sources (clay_awaiting) already
            # correctly represent this; nothing else reads `conclusion` when
            # it's None.
            conclusion: Optional[Conclusion] = None
        elif not fallback_targets:
            # ABSOLUTE RULE: nothing left to fill or verify -- BYPASS LLM STAGE ENTIRELY
            msg = "Stage 4 Bypass Guard: nothing left for the LLM to fill or verify! BYPASSING LLM FALLBACK ENTIRELY."
            logs.append(msg)
            log.info(msg)
            conclusion = "short_circuit_success"
        else:
            # Stage 5 & 6: Targeted LLM Fallback & Verbatim Evidence Verification
            # Every step that could run for this platform has now been
            # attempted (scrape, Clay if applicable, LLM fallback below) --
            # whatever this pass ends up with is a normal, concluded result,
            # not a failure of the waterfall itself, whether the LLM call
            # below succeeds, partially succeeds, or raises ClaudeError
            # (itself only raised after core/resilience.py's own 5-attempt/
            # 15s-deadline budget is exhausted).
            conclusion = "exhausted_no_match"
            logs.append(f"Stage 4 Audit: Target fields {fallback_targets} -> Triggering Targeted LLM Fallback")

            if self.claude and raw_source_text:
                try:
                    system_prompt = build_targeted_prompt(fallback_targets)
                    llm_raw_output = self.claude.extract_critical_fields(system_prompt, raw_source_text)

                    # Stage 6: Verbatim Evidence Verification
                    verified_llm = verify_against_source(llm_raw_output, raw_source_text)

                    for k, v in verified_llm.items():
                        if is_empty_value(v):
                            continue
                        if k in OVERRIDE_ON_VERIFIED_FIELDS:
                            # Mark it settled even when the LLM-verified value
                            # matches what's already there -- otherwise a
                            # future re-enrichment of this same lead would
                            # spend another Claude call re-asking about it.
                            if lead.get(k) != v:
                                lead[k] = v
                                logs.append(f"Stage 6 Verified LLM: {k} = {v!r} (verified profile overrides manual entry)")
                            else:
                                logs.append(f"Stage 6 Verified LLM: {k} = {v!r} (confirmed matches manual entry)")
                            field_sources[k] = "llm_fallback"
                        elif is_empty_value(lead.get(k)):
                            lead[k] = v
                            field_sources[k] = "llm_fallback"
                            logs.append(f"Stage 6 Verified LLM: {k} = {v!r}")

                except ClaudeError as exc:
                    msg = f"LLM Fallback error: {exc}"
                    logs.append(msg)
                    log.error(msg)
            else:
                if not self.claude:
                    logs.append("LLM Fallback skipped: CLAUDE_API_KEY not configured")
                elif not raw_source_text:
                    logs.append("LLM Fallback skipped: No raw scraped text available")

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
            "clay_fallback": clay_fallback,
            "raw_enrichment_data": raw_scraped_data,
            "conclusion": conclusion,
        }
