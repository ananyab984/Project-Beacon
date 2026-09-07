"""Main Pipeline Orchestrator connecting all 7 enrichment stages."""

from __future__ import annotations

import json
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
# safety net). Worst case today, now identical for both waterfall shapes
# since Parallel runs on all platforms: Tier 1 (BrightData or Tavily, 15s) +
# Parallel 3700s (its own much longer deadline -- see config.py's
# parallel_deadline_seconds) + the LLM fallback call itself (15s) =
# 15 + 3700 + 15 = 3730s -- comfortably under this 3800s ceiling.
# Raised again (350s -> 3800s) after TWO successive guesses at Parallel's
# "typical" latency (150s, then 240s) both still cut off calls that were
# genuinely succeeding server-side (confirmed live 2026-09-07: a real
# "core"-processor Task Run routinely takes ~150-170s, and our own guessed
# ceiling kept firing right as the real result was landing). Rather than
# guess a third number, providers/parallel_client.py now defers to the
# Parallel SDK's own well-engineered default (waits up to an hour for a task
# to actually finish) -- this ceiling, and every one below, is sized to never
# be the thing that cuts that off early. In practice, real calls still
# resolve in ~150-170s -- this ceiling only matters for a genuine outlier,
# not the expected case. See server/src/jobs/enrichment.job.ts's matching
# axios timeout (4000s) and retryWithBackoff deadlineMs (4200s), both raised
# in lockstep so Node's own timeouts never fire before this one does.
LEAD_LEVEL_TIMEOUT_SECONDS = 3800.0

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
            "raw_enrichment_data": None,
            "conclusion": "timed_out",
        }

    def _run_linkedin_steps(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str], profile_link: str
    ) -> tuple[Any, str, Optional[Dict[str, Any]]]:
        """LinkedIn waterfall, steps 1-2 of 3: Bright Data -> Parallel.
        Differs from the non-LinkedIn shape only in its Tier 1 provider --
        both now share _run_parallel_stage() for Tier 2."""
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

        parallel_fallback = self._run_parallel_stage(lead, field_sources, logs, profile_link, "brightdata")
        return raw_scraped_data, raw_source_text, parallel_fallback

    def _run_parallel_stage(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        profile_link: str, tier1_label: str,
    ) -> Optional[Dict[str, Any]]:
        """Stage 3.5: Parallel -- synchronous, replacing Clay's async
        dispatch-and-webhook design entirely. This call either returns
        resolved fields or raises before it returns, so there is no "still
        pending" state left for the rest of the waterfall (or Node) to
        account for -- contrast with Clay's old `_clay_dispatch: "pending"`
        marker, which no longer has an equivalent here.

        Shared by BOTH waterfall shapes. Clay's version of this stage was
        hard-gated to linkedin.com/in|sales URLs, because Clay's own "Enrich
        person" action rejected anything else outright ("Invalid person
        identifier", confirmed against its dashboard 2026-08-26). Parallel has
        no such limitation -- the PoC ran it successfully against ProZ,
        Bodalgo, ATA/ATAA and Freelancer.com profile URLs -- so carrying that
        gate forward was an artificial holdover from the previous provider
        that left non-LinkedIn leads permanently without Tier 2 data and split
        enrichment provenance across the table. The gate is now simply "is
        there a profile URL to research", which is the real precondition."""
        already_ran = field_sources.get("_parallel_fallback")

        if not profile_link:
            logs.append("Stage 3.5 skipped: no Profile_Link for Parallel to research")
            return None
        if already_ran:
            logs.append(
                f"Stage 3.5 skipped: Parallel already attempted for this lead (state={already_ran!r}), not re-calling"
            )
            return {"called": False, "reason": f"already_{already_ran}"}
        if not self.parallel:
            logs.append("Stage 3.5 skipped: PARALLEL_API_KEY not configured")
            return None

        try:
            parallel_data = self.parallel.enrich_profile(lead, profile_link)
            field_sources["_parallel_fallback"] = "complete"
            msg = f"Stage 3.5: Parallel call complete ({tier1_label} scrape already ran)"
            logs.append(msg)
            log.info("Lead %s: %s", lead.get("Full_Name") or profile_link, msg)
            self._merge_parallel_fields(lead, field_sources, logs, parallel_data)
            return {"called": True, "reason": tier1_label, "data": parallel_data}
        except ParallelError as exc:
            field_sources["_parallel_fallback"] = "failed"
            msg = f"Stage 3.5: Parallel call failed: {exc}"
            logs.append(msg)
            log.error(msg)
            return {"called": True, "reason": tier1_label, "error": str(exc)}

    def _run_non_linkedin_steps(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        profile_link: str, provider_type: str, parser_name: str,
    ) -> tuple[Any, str, Optional[Dict[str, Any]]]:
        """Non-LinkedIn waterfall, steps 1-2 of 3: Tavily -> Parallel. Parallel
        used to be unreachable from this path by construction (a holdover from
        Clay, which rejected non-LinkedIn identifiers); it now runs here too,
        via the same _run_parallel_stage() the LinkedIn path uses, so a
        ProZ/Bodalgo/personal-site lead gets the same Tier 2 treatment."""
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

        parallel_fallback = self._run_parallel_stage(lead, field_sources, logs, profile_link, provider_type)
        return raw_scraped_data, raw_source_text, parallel_fallback

    def _apply_parsed_fields(
        self, lead: Dict[str, Any], field_sources: Dict[str, str], logs: list[str],
        source_label: str, parsed: Dict[str, Any],
    ) -> None:
        """Shared merge rule for ANY stage that resolves canonical fields
        (Stage 3's scrape parsers, Stage 3.5's Parallel call): NEVER
        overwrite existing data -- EXCEPT OVERRIDE_ON_VERIFIED_FIELDS."""
        for k, v in parsed.items():
            if is_empty_value(v):
                continue
            if k in OVERRIDE_ON_VERIFIED_FIELDS:
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
        self._apply_parsed_fields(lead, field_sources, logs, "parallel", mapped)

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
        # _run_parallel_stage) and the Tier 3 LLM fallback below. Parallel was
        # LinkedIn-only while Clay held that position, since Clay rejected
        # every other identifier; that gate is gone (see
        # _run_parallel_stage's docstring).
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

        # Waterfall order: Bright Data/Tavily -> Parallel -> AI extraction, in
        # that priority -- AI is the last resort, run only after Parallel has
        # already had its (synchronous, already-concluded-by-this-point)
        # chance. Unlike Clay's old async design, there is no "still awaiting"
        # state to check here -- Stage 3.5 above either ran to completion or
        # was skipped/failed before this line, so Stage 4 always sees a
        # settled picture of the lead.
        if not fallback_targets:
            # ABSOLUTE RULE: nothing left to fill or verify -- BYPASS LLM STAGE ENTIRELY
            msg = "Stage 4 Bypass Guard: nothing left for the LLM to fill or verify! BYPASSING LLM FALLBACK ENTIRELY."
            logs.append(msg)
            log.info(msg)
            conclusion: Conclusion = "short_circuit_success"
        else:
            # Stage 5 & 6: Targeted LLM Fallback & Verbatim Evidence Verification
            # Every step that could run for this platform has now been
            # attempted (scrape, Parallel if applicable, LLM fallback below) --
            # whatever this pass ends up with is a normal, concluded result,
            # not a failure of the waterfall itself, whether the LLM call
            # below succeeds, partially succeeds, or raises ClaudeError
            # (itself only raised after core/resilience.py's own retry/
            # deadline budget is exhausted).
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
            "parallel_fallback": parallel_fallback,
            "raw_enrichment_data": raw_scraped_data,
            "conclusion": conclusion,
        }
