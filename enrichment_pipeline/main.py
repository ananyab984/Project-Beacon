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
from orchestrator import Conclusion, EnrichmentOrchestrator

log = get_logger(__name__)


# Parallel's processor tiers, cheapest/fastest first. `processor` is typed as a
# bare `str` in the SDK's RunInput, so a wrong value is not caught locally --
# it is rejected by the API mid-run, after the lead has already waited. Used
# only to tell truth on /health; the value itself stays whatever is configured.
KNOWN_PARALLEL_PROCESSORS = frozenset({"lite", "base", "core", "pro", "ultra"})


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
    # Was missing here entirely -- process_lead()'s own PipelineResult
    # (orchestrator.py) always computes this, but response_model=
    # EnrichmentResponse silently strips any key it doesn't declare, so
    # every real HTTP response has been returning `conclusion: undefined`
    # to Node regardless of what the waterfall actually concluded. Confirmed
    # live 2026-09-09: a real call returned execution_time_ms/
    # enrichment_status intact but no conclusion key at all. This meant
    # Node's `isComplete = conclusion !== "timed_out"` was always true --
    # a genuine Python-side timeout was silently treated as COMPLETE,
    # and onHoldReason=TIMEOUT could never actually fire from this path.
    conclusion: Optional[Conclusion] = None
    duplicate_flag: Optional[Dict[str, Any]] = None
    parallel_fallback: Optional[Dict[str, Any]] = None
    websearch_fallback: Optional[Dict[str, Any]] = None
    raw_enrichment_data: Optional[Any] = None


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

    # Served at BOTH paths on purpose. The platform's health check is what
    # decides a deploy is live, and its configured path lives in the Render
    # dashboard, not in this repo -- so a path set to "/" (or left at a
    # provider default of "/") polls a route FastAPI answers with 404, the
    # deploy never goes healthy, and it sits "In progress" until the platform
    # gives up and rolls back. The build itself is 32s; everything after that
    # is the platform waiting for an answer at whatever path it was told to
    # use. Answering on "/" as well costs one route and removes the entire
    # class of "deployed fine, never went live".
    @app.get("/")
    @app.get("/health")
    def health_check():
        # Reports WHICH TIERS ARE ACTUALLY WIRED UP, because "healthy" on its
        # own is a misleading thing to say. Every provider here is optional by
        # design (`load_config(require_keys=False)`, and each client is None
        # when its key is absent), so this process starts up, answers health
        # checks, accepts /enrich, and returns 200 while silently doing a
        # fraction of the work -- a missing BRIGHTDATA_API_KEY costs Tier 1 on
        # every single lead and looks identical to a blocked profile from the
        # outside. That happened (2026-09-08): a profile Bright Data scrapes
        # perfectly on demand came back with rawScrapeData NULL and no
        # explanation anywhere. One curl against this endpoint now answers
        # "is the environment complete?" for any deployment.
        #
        # Booleans only -- never echo a key. `parallel_processor` is a tier
        # NAME, not a secret, but it is reported as a validity verdict rather
        # than verbatim precisely so that a key mistakenly pasted into that
        # variable is reported as wrong WITHOUT this public endpoint leaking
        # it.
        return {
            "status": "healthy",
            "service": "enrichment_pipeline",
            "version": "1.0.0",
            "providers_configured": {
                "brightdata": bool(config.brightdata_api_key),
                "brightdata_dataset_id": bool(config.dataset_id),
                "tavily": bool(config.tavily_api_key),
                "parallel": bool(config.parallel_api_key),
                "claude": bool(config.claude_api_key),
            },
            "parallel_processor": (
                config.parallel_processor
                if config.parallel_processor in KNOWN_PARALLEL_PROCESSORS
                else f"INVALID -- not one of {sorted(KNOWN_PARALLEL_PROCESSORS)}"
            ),
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
    # timeout_graceful_shutdown is set because uvicorn's default is to wait
    # FOREVER for in-flight requests on SIGTERM, and an in-flight request here
    # is a full waterfall run -- minutes normally, up to orchestrator.py's
    # LEAD_LEVEL_TIMEOUT_SECONDS (4100s) at the ceiling. A redeploy lands
    # SIGTERM on an instance mid-enrichment routinely, and the platform then
    # SIGKILLs it after its own (much shorter) grace window anyway, so the
    # unbounded wait bought nothing and just made every deploy end in a hard
    # kill. 25s stays inside a typical 30s platform window, so the process
    # exits cleanly on its own terms instead.
    #
    # A lead cut off this way is NOT lost: the connection closes, Node's
    # enrichLeadById catch path reverts it to PENDING and flags
    # ON_HOLD/SYSTEM_ERROR, so it shows up with a Retry rather than sitting
    # in IN_PROGRESS until the 20-minute stall sweep notices.
    uvicorn.run(app, host=host, port=port, timeout_graceful_shutdown=25)


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
