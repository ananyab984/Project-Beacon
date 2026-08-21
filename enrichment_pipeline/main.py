"""Primary Entrypoint for the Production Enrichment Pipeline (CLI & FastAPI HTTP Server)."""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from typing import Any, Dict, List, Optional

import requests
from pydantic import BaseModel

from config import ConfigError, load_config
from core.dedup import find_duplicate_candidates
from logger import configure_logging, get_logger
from orchestrator import EnrichmentOrchestrator

log = get_logger(__name__)


def _start_keepalive_ping(service_name: str, keepalive_url: str, interval_seconds: int) -> None:
    if not keepalive_url:
        return

    target = keepalive_url.rstrip("/")
    health_url = target if target.endswith("/health") else f"{target}/health"
    interval = max(60, interval_seconds)

    def _loop() -> None:
        while True:
            try:
                res = requests.get(health_url, timeout=10, headers={"User-Agent": f"ProjectBeacon-{service_name}/1.0"})
                if res.status_code >= 400:
                    log.warning("[%s] keepalive ping returned %s from %s", service_name, res.status_code, health_url)
                else:
                    log.info("[%s] keepalive ping OK -> %s", service_name, health_url)
            except Exception as exc:
                log.warning("[%s] keepalive ping failed -> %s: %s", service_name, health_url, exc)
            time.sleep(interval)

    threading.Thread(target=_loop, name=f"{service_name}-keepalive", daemon=True).start()


def _attach_duplicate_flags(results: list, candidates: list) -> None:
    """Attach a `duplicate_flag` key onto each PipelineResult dict involved in >=1 flagged pair."""
    by_index: Dict[int, list] = {}
    for c in candidates:
        by_index.setdefault(c["lead_a_index"], []).append(c)
        by_index.setdefault(c["lead_b_index"], []).append(c)
    for idx, result in enumerate(results):
        hits = by_index.get(idx, [])
        result["duplicate_flag"] = {
            "flagged": bool(hits),
            "best_match_score": max((h["match_score"] for h in hits), default=None),
            "candidate_pair_indices": [(h["lead_a_index"], h["lead_b_index"]) for h in hits],
        }


def _write_duplicate_review_queue(candidates: list, threshold: float, total_leads: int) -> None:
    os.makedirs("output", exist_ok=True)
    payload = {
        "threshold_used": threshold,
        "total_leads_in_batch": total_leads,
        "total_candidates_flagged": len(candidates),
        "candidates": candidates,
    }
    with open("output/duplicate_review_queue.json", "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    if candidates:
        log.warning(
            "Danny M rule: %d duplicate pair(s) flagged for human review -> output/duplicate_review_queue.json",
            len(candidates),
        )


def run_cli(input_path: str, output_path: str, config) -> None:
    """Run pipeline in CLI mode over input JSON file."""
    log.info("Running Enrichment Pipeline CLI on input: %s", input_path)
    with open(input_path, "r", encoding="utf-8") as f:
        input_data = json.load(f)

    orchestrator = EnrichmentOrchestrator(config)

    if isinstance(input_data, list):
        results = [orchestrator.process_lead(item) for item in input_data]
        duplicate_candidates = find_duplicate_candidates(
            [r["lead"] for r in results], threshold=config.dedup_match_threshold,
        )
        _attach_duplicate_flags(results, duplicate_candidates)
        _write_duplicate_review_queue(duplicate_candidates, config.dedup_match_threshold, len(results))
    else:
        results = orchestrator.process_lead(input_data)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    log.info("Enrichment complete! Saved results to %s", output_path)


class LeadRequest(BaseModel):
    First_Name: Optional[str] = None
    Full_Name: Optional[str] = None
    Country_of_Residence: Optional[str] = None
    Source: Optional[str] = "LinkedIn"
    Profile_Link: Optional[str] = None
    Contact_Number: Optional[str] = None
    Email_Address: Optional[str] = None
    Services: Optional[str] = None
    Source_Language: Optional[str] = None
    Target_Language: Optional[str] = None
    Secondary_Languages: Optional[str] = None
    Years_of_Exp: Optional[Any] = None
    Vendor_Experience: Optional[str] = None
    Headline: Optional[str] = None
    About_Snippet: Optional[str] = None
    Current_Title: Optional[str] = None
    Tools_Software: Optional[str] = None
    Certifications: Optional[str] = None
    Experience_History: Optional[str] = None
    Full_Profile_Context: Optional[str] = None
    # Not a lead field -- the caller's persisted record of which canonical
    # fields were already resolved (and by what source) on a PRIOR
    # enrichment run for this same lead, so a second run doesn't re-spend an
    # LLM call re-verifying something already settled. Stripped out before
    # building the lead dict; see `run_server`'s /enrich handler below.
    Field_Sources: Optional[Dict[str, str]] = None


class EnrichmentResponse(BaseModel):
    lead: Dict[str, Any]
    enrichment_status: str
    enrichment_percentage: int
    field_sources: Dict[str, str]
    audit: Dict[str, Any]
    execution_time_ms: int
    logs: List[str]
    duplicate_flag: Optional[Dict[str, Any]] = None


class BatchEnrichmentResponse(BaseModel):
    results: List[EnrichmentResponse]
    duplicate_review_queue: List[Dict[str, Any]]
    dedup_threshold_used: float


def run_server(host: str, port: int, config) -> None:
    """Run pipeline as a FastAPI HTTP service (ready for Node.js backend integration).

    The three Pydantic models above are deliberately module-level, not nested in
    this function: with `from __future__ import annotations` active (PEP 563,
    used throughout this file), FastAPI/Pydantic resolve every type annotation
    as a lazily-evaluated string against the *module's* globals. A class
    defined inside this function is invisible to that resolution and raises
    `PydanticUndefinedAnnotation: name 'LeadRequest' is not defined` the moment
    a route referencing it is registered -- this previously meant `--serve`
    could never start at all, so every enrichment call from Node failed
    before reaching BrightData, not because of a parsing gap.
    """
    import uvicorn
    from fastapi import FastAPI, HTTPException

    app = FastAPI(
        title="Project Beacon — Production Enrichment Pipeline",
        description="Scraping, Stage 3 parsing, targeted LLM fallback, and evidence verification service.",
        version="1.0.0",
    )

    orchestrator = EnrichmentOrchestrator(config)

    @app.get("/health")
    def health_check():
        return {
            "status": "healthy",
            "service": "enrichment_pipeline",
            "version": "1.0.0",
        }

    @app.post("/enrich", response_model=EnrichmentResponse)
    def enrich_single_lead(payload: LeadRequest):
        try:
            lead_dict = payload.model_dump(exclude_unset=True)
            known_field_sources = lead_dict.pop("Field_Sources", None)
            result = orchestrator.process_lead(lead_dict, known_field_sources=known_field_sources)
            return result
        except Exception as exc:
            log.exception("Error enriching lead: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/enrich/batch", response_model=BatchEnrichmentResponse)
    def enrich_batch_leads(payload: List[LeadRequest]):
        try:
            results = []
            for item in payload:
                lead_dict = item.model_dump(exclude_unset=True)
                known_field_sources = lead_dict.pop("Field_Sources", None)
                results.append(orchestrator.process_lead(lead_dict, known_field_sources=known_field_sources))
            duplicate_candidates = find_duplicate_candidates(
                [r["lead"] for r in results], threshold=config.dedup_match_threshold,
            )
            _attach_duplicate_flags(results, duplicate_candidates)
            return {
                "results": results,
                "duplicate_review_queue": duplicate_candidates,
                "dedup_threshold_used": config.dedup_match_threshold,
            }
        except Exception as exc:
            log.exception("Error in batch enrichment: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    log.info("Starting Enrichment Pipeline FastAPI server at http://%s:%d", host, port)
    uvicorn.run(app, host=host, port=port)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Project Beacon Production Enrichment Pipeline")
    parser.add_argument("--input", help="Path to input lead JSON file")
    parser.add_argument("--output", default="enriched_output.json", help="Path to output JSON file")
    parser.add_argument("--serve", action="store_true", help="Run as FastAPI HTTP server for Node.js backend integration")
    parser.add_argument("--host", default="0.0.0.0", help="HTTP server host")
    parser.add_argument("--port", type=int, default=8000, help="HTTP server port")

    args = parser.parse_args(argv or sys.argv[1:])

    try:
        config = load_config(require_keys=False)
    except ConfigError as exc:
        configure_logging("INFO")
        log.error("Configuration error: %s", exc)
        return 2

    configure_logging(config.log_level)

    if args.serve:
        if config.keepalive_enabled:
            _start_keepalive_ping("enrichment", config.keepalive_url, config.keepalive_interval_seconds)
        run_server(args.host, args.port, config)
    elif args.input:
        run_cli(args.input, args.output, config)
    else:
        # Simple test execution if no args provided
        log.info("No --input or --serve provided. Running self-test on sample lead...")
        orchestrator = EnrichmentOrchestrator(config)
        sample = {
            "Full_Name": "Tammy Pérez",
            "Source": "Ada",
            "Profile_Link": "https://www.audiodescription.co.uk/members/tammy-perez",
            "Source_Language": "Spanish",
        }
        res = orchestrator.process_lead(sample)
        print("\n=== SAMPLE ENRICHMENT TEST OUTPUT ===")
        print(json.dumps(res, indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
