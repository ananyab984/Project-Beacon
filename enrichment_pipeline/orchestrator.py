"""Main Pipeline Orchestrator connecting all 7 enrichment stages."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional, TypedDict

from config import Config
from core.field_audit import audit_lead_fields
from core.schema import is_empty_value
from core.source_router import route_lead
from llm_fallback.client import ClaudeClient, ClaudeError
from llm_fallback.prompt_builder import build_targeted_prompt
from llm_fallback.verifier import verify_against_source
from logger import get_logger
from providers.brightdata_client import BrightDataClient, BrightDataError
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

# Always overwritten with whatever the latest scrape produced, regardless of
# whether a value is already present -- unlike OVERRIDE_ON_VERIFIED_FIELDS,
# these never participate in the LLM fallback (there's nothing to "ask
# Claude to extract" about a raw JSON dump of the same scrape it came from,
# and no manual-entry equivalent to reconcile against). Kept as a separate
# set so `_unverified()` below never adds it to the LLM target list.
ALWAYS_REFRESH_FIELDS = {"Full_Profile_Context"}


class PipelineResult(TypedDict):
    lead: Dict[str, Any]
    enrichment_status: str
    enrichment_percentage: int
    field_sources: Dict[str, str]
    audit: Dict[str, Any]
    execution_time_ms: int
    logs: list[str]


class EnrichmentOrchestrator:
    """7-Stage Enrichment Pipeline Orchestrator."""

    def __init__(self, config: Config):
        self.config = config
        self.brightdata = BrightDataClient(config) if config.brightdata_api_key else None
        self.tavily = TavilyClient(config) if config.tavily_api_key else None
        self.claude = ClaudeClient(config) if config.claude_api_key else None

        self.parsers = {
            "linkedin": LinkedInParser(),
            "ada": AdaParser(),
            "proz": ProzParser(),
            "bodalgo": BodalgoParser(),
            "ata": AtaParser(),
            "ataa": AtaaParser(),
            "generic_llm": GenericParser(),
        }

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

        # Stage 3: Scrape & Stage 3 Deterministic Parsing
        raw_scraped_data: Any = None
        raw_source_text: str = ""

        if profile_link:
            try:
                if provider_type == "brightdata" and self.brightdata:
                    raw_scraped_data = self.brightdata.scrape_profile(profile_link)
                    # json.dumps (not Python's str()) so the LLM fallback sees
                    # standard double-quoted JSON -- str() renders None/True
                    # as Python literals and adds repr noise that wastes the
                    # 8000-char budget extract_critical_fields truncates to,
                    # for no benefit to a model asked to find verbatim quotes.
                    raw_source_text = json.dumps(raw_scraped_data, ensure_ascii=False, default=str)
                elif provider_type == "tavily_search" and self.tavily:
                    raw_scraped_data = self.tavily.search_snippets(f"site:proz.com {lead.get('Full_Name', '')}".strip(), include_domains=["proz.com"])
                    raw_source_text = json.dumps(raw_scraped_data, ensure_ascii=False, default=str)
                elif provider_type == "tavily_extract" and self.tavily:
                    raw_scraped_data = self.tavily.extract_url(profile_link)
                    raw_source_text = raw_scraped_data.get("raw_content", "")
            except (BrightDataError, TavilyError) as exc:
                msg = f"Scraping warning ({provider_type}): {exc}"
                logs.append(msg)
                log.warning(msg)

        # Run parser if raw scraped data was obtained
        if raw_scraped_data is not None:
            parser = self.parsers.get(parser_name, GenericParser())
            stage3_parsed = parser.parse(profile_link, raw_scraped_data)

            # Every parser also independently builds curated drafting
            # context straight from the raw scrape (not from stage3_parsed's
            # already-narrowed fields) -- merged in here so it flows through
            # the same ALWAYS_REFRESH_FIELDS branch below as any other
            # source's context blob would.
            context = parser.build_context(profile_link, raw_scraped_data)
            if context:
                stage3_parsed = {**stage3_parsed, "Full_Profile_Context": context}

            # Merge rules: NEVER overwrite existing data -- EXCEPT
            # OVERRIDE_ON_VERIFIED_FIELDS (see module-level comment above).
            # Everything else (contact fields) keeps the strict
            # never-overwrite rule and is instead handled by the dedicated
            # Stage 4-6 critical-field audit/fallback below.
            for k, v in stage3_parsed.items():
                if is_empty_value(v):
                    continue
                source = "brightdata" if provider_type == "brightdata" else "tavily"
                if k in OVERRIDE_ON_VERIFIED_FIELDS:
                    # Mark it verified even when the scraped value happens to
                    # match the manual one -- otherwise field_sources stays
                    # "existing" and Stage 4 would needlessly re-send an
                    # already-confirmed field to the LLM fallback.
                    if lead.get(k) != v:
                        lead[k] = v
                        field_sources[k] = source
                        logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {source}, verified profile overrides manual entry)")
                    else:
                        field_sources[k] = source
                        logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {source}, confirmed matches manual entry)")
                elif k in ALWAYS_REFRESH_FIELDS:
                    lead[k] = v
                    field_sources[k] = source
                    logs.append(f"Stage 3 Parsed: {k} refreshed from latest scrape (from {source})")
                elif is_empty_value(lead.get(k)):
                    lead[k] = v
                    field_sources[k] = source
                    logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {source})")

        post_stage3_audit = audit_lead_fields(lead)
        logs.append(f"Stage 3 Complete: Score = {post_stage3_audit['enrichment_percentage']}%")

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

        if not fallback_targets:
            # ABSOLUTE RULE: nothing left to fill or verify -- BYPASS LLM STAGE ENTIRELY
            msg = "Stage 4 Bypass Guard: nothing left for the LLM to fill or verify! BYPASSING LLM FALLBACK ENTIRELY."
            logs.append(msg)
            log.info(msg)
        else:
            # Stage 5 & 6: Targeted LLM Fallback & Verbatim Evidence Verification
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
        }
