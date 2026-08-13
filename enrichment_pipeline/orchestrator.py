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

    def process_lead(self, lead_input: Dict[str, Any]) -> PipelineResult:
        start_time = time.monotonic()
        lead = dict(lead_input)
        logs: list[str] = []
        field_sources: Dict[str, str] = {}

        # Mark existing populated fields
        initial_audit = audit_lead_fields(lead)
        for k, v in lead.items():
            if not is_empty_value(v):
                field_sources[k] = "existing"

        logs.append(f"Stage 1 Complete: Initial Enrichment Score = {initial_audit['enrichment_percentage']}% ({initial_audit['populated_count']}/13 fields)")
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

            # Merge rules: NEVER overwrite existing data
            for k, v in stage3_parsed.items():
                if is_empty_value(lead.get(k)) and not is_empty_value(v):
                    lead[k] = v
                    field_sources[k] = "brightdata" if provider_type == "brightdata" else "tavily"
                    logs.append(f"Stage 3 Parsed: {k} = {v!r} (from {field_sources[k]})")

        post_stage3_audit = audit_lead_fields(lead)
        logs.append(f"Stage 3 Complete: Score = {post_stage3_audit['enrichment_percentage']}%")

        # Stage 4: Critical Field Audit & LLM Bypass Guard
        missing_critical = post_stage3_audit["missing_critical_fields"]

        if not missing_critical:
            # ABSOLUTE RULE: If scrapers/parsers filled all critical fields, BYPASS LLM STAGE ENTIRELY
            msg = "Stage 4 Bypass Guard: All critical fields (Years_of_Exp, Contact_Number, Email_Address) are present! BYPASSING LLM FALLBACK ENTIRELY."
            logs.append(msg)
            log.info(msg)
        else:
            # Stage 5 & 6: Targeted LLM Fallback & Verbatim Evidence Verification
            logs.append(f"Stage 4 Audit: Missing critical fields {missing_critical} -> Triggering Targeted LLM Fallback")

            if self.claude and raw_source_text:
                try:
                    system_prompt = build_targeted_prompt(missing_critical)
                    llm_raw_output = self.claude.extract_critical_fields(system_prompt, raw_source_text)

                    # Stage 6: Verbatim Evidence Verification
                    verified_llm = verify_against_source(llm_raw_output, raw_source_text)

                    for k, v in verified_llm.items():
                        if is_empty_value(lead.get(k)) and not is_empty_value(v):
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
