"""Primary Entrypoint for the AI Message Drafting Layer (CLI & FastAPI HTTP Server)."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional

from config import ConfigError, load_config
from core.leads import check_channel_eligibility, load_leads
from logger import configure_logging, get_logger
from core.rate_card import RateCardService
from orchestrator import DraftingOrchestrator

log = get_logger(__name__)


def run_cli(args, config) -> None:
    """Run drafting pipeline in CLI mode over enriched lead files."""
    default_sources = [
        "../enrichment_poc/linkedin_poc/enriched_final.xlsx",
        "../enrichment_poc/Ada_poc/ada_projectbeacon_output.json",
        "../enrichment_poc/bodalogo_dataset_poc/bodalgo_projectbeacon_output.json",
        "../enrichment_poc/proz_poc/proz_projectbeacon_output.json",
    ]
    input_sources = args.input or default_sources
    log.info("Loading enriched leads from: %s", input_sources)

    leads = load_leads(input_sources, limit=args.limit, only_enriched=True)
    if not leads:
        log.warning("No enriched leads found in input sources.")
        return

    orchestrator = DraftingOrchestrator(config)
    results = []

    for lead in leads:
        channels = []
        if args.channel in {"email", "both"} and check_channel_eligibility(lead, "email").eligible:
            channels.append("email")
        if args.channel in {"linkedin", "both"} and check_channel_eligibility(lead, "linkedin").eligible:
            channels.append("linkedin")

        for ch in channels:
            try:
                res = orchestrator.process_draft(as_dict(lead), channel=ch)  # manual_override left at default False
                results.append(res)
                _print_report(res)
            except Exception as exc:
                log.error("Failed to generate draft for %s/%s: %s", lead.first_name, ch, exc)

    json_path = "output/drafts.json"
    import os
    os.makedirs("output", exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)

    sends = sum(1 for r in results if r["verdict"] == "SEND")
    holds = sum(1 for r in results if r["verdict"] == "HOLD")
    ineligible = sum(1 for r in results if r["verdict"] == "INELIGIBLE")
    print(f"\n{'═' * 78}")
    print(f"  Done. {len(results)} drafts · {sends} SEND · {holds} HOLD · {ineligible} INELIGIBLE")
    print(f"  Results saved to {json_path}")
    print("═" * 78)


def as_dict(lead) -> dict:
    return {
        "First_Name": lead.first_name,
        "Full_Name": lead.full_name,
        "Country_of_Residence": lead.country,
        "Source": lead.source,
        "Profile_Link": lead.profile_link,
        "Email_Address": lead.email,
        "Services": ", ".join(lead.services) if lead.services else None,
        "Source_Language": lead.source_language,
        "Target_Language": lead.target_language,
        "Secondary_Languages": ", ".join(lead.secondary_languages) if lead.secondary_languages else None,
        "Years_of_Exp": lead.years_of_exp,
        "Vendor_Experience": lead.vendor_experience,
        "Enrichment_Status": lead.enrichment_status,
    }


def _print_report(res: dict) -> None:
    line = "─" * 78
    print(f"\n{line}")
    print(f"  {res['lead_name']} · {res['channel'].upper()} · {res['telemetry']['model']} · {res['telemetry']['latency_ms']}ms")
    print(line)
    if res.get("subject"):
        print(f"  SUBJECT: {res['subject']}")
    print("  " + res["body"].replace("\n", "\n  "))
    print(f"  {'-' * 74}")
    for c in res["evaluation"]["checks"]:
        mark = "✅" if c["passed"] else ("⚠️ " if c["severity"] == "warn" else "❌")
        print(f"   {mark} {c['name']:22} {c['detail']}")
    if res["verdict"] == "SEND":
        verdict = "🟢 SEND"
    elif res["verdict"] == "HOLD":
        verdict = "🔴 HOLD (needs review)"
    else:
        verdict = "⚪ INELIGIBLE (missing contact data for this channel)"
    print(f"  {'-' * 74}")
    print(f"   VERDICT: {verdict}  [flags={res['flags'] or 'none'}]")


def run_server(host: str, port: int, config) -> None:
    """Run pipeline as a FastAPI HTTP server (ready for Node.js backend integration)."""
    import uvicorn
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel, Field

    app = FastAPI(
        title="Project Beacon — AI Message Drafting Service",
        description="Personalized outreach message generation and single-stage deterministic evaluation service.",
        version="1.0.0",
    )

    orchestrator = DraftingOrchestrator(config)

    class DraftRequest(BaseModel):
        lead: Dict[str, Any]
        channel: Optional[str] = "email"
        rate_card: Optional[List[Dict[str, Any]]] = None
        manual_override: Optional[bool] = False

    class EditLogRequest(BaseModel):
        draft_id: str
        original_body: str
        edited_body: str

    @app.get("/health")
    def health_check():
        return {
            "status": "healthy",
            "service": "drafting_service",
            "version": "1.0.0",
        }

    @app.post("/draft")
    def generate_draft_endpoint(payload: DraftRequest):
        try:
            if payload.rate_card:
                orchestrator.rate_card_service = RateCardService(payload.rate_card)
            return orchestrator.process_draft(
                payload.lead,
                channel=payload.channel or "email",
                manual_override=bool(payload.manual_override),
            )
        except Exception as exc:
            log.exception("Error generating draft: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/draft/edit-log")
    def log_edit_endpoint(payload: EditLogRequest):
        try:
            return orchestrator.record_edit(payload.draft_id, payload.original_body, payload.edited_body)
        except Exception as exc:
            log.exception("Error logging recruiter edit: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    log.info("Starting AI Message Drafting FastAPI server at http://%s:%d", host, port)
    uvicorn.run(app, host=host, port=port)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Project Beacon AI Message Drafting Layer")
    parser.add_argument("--limit", type=int, default=3, help="Max leads to process")
    parser.add_argument("--channel", choices=["email", "linkedin", "both"], default="both")
    parser.add_argument("--input", help="Override input file path")
    parser.add_argument("--serve", action="store_true", help="Run as FastAPI HTTP server")
    parser.add_argument("--host", default="0.0.0.0", help="HTTP server host")
    parser.add_argument("--port", type=int, default=8001, help="HTTP server port")

    args = parser.parse_args(argv or sys.argv[1:])

    try:
        config = load_config(require_api_key=False)
    except ConfigError as exc:
        configure_logging("INFO")
        log.error("Configuration error: %s", exc)
        return 2

    configure_logging(config.log_level)

    if args.serve:
        run_server(args.host, args.port, config)
    else:
        run_cli(args, config)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
