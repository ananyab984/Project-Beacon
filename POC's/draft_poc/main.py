"""AI Draft Messages Pipeline — POC entry point.

Pipeline (mirrors the requested flow):

    Enriched Lead  ->  Prompt Builder  ->  Groq/LLM  -->  Email Draft
                                                     `->  LinkedIn Draft
                                                            |
                                                            v
                                                    Evaluation Metrics

For each lead we generate an email + a LinkedIn draft, score both through the
two-stage evaluator, print a readable report, and write full results to
output/ (JSON + a summary XLSX).

Usage:
    python main.py --limit 3
    python main.py --channel email --limit 5
    python main.py --input ../Ada_poc/ada_projectbeacon_output.json
"""

from __future__ import annotations

import argparse
import json
import os

import draft_generator as gen
from config import ConfigError, load_config
from evaluator import Evaluation, evaluate
from groq_client import GroqClient
from leads import Lead, load_leads
from logger import get_logger

log = get_logger(__name__)


def _run_one(client: GroqClient, cfg, lead: Lead, channels: list[str]) -> list[tuple]:
    results = []
    for channel in channels:
        try:
            draft = (gen.generate_email if channel == "email" else gen.generate_linkedin)(client, cfg, lead)
        except Exception as exc:
            log.error("Generation failed for %s/%s: %s", lead.first_name, channel, exc)
            continue
        ev = evaluate(client, cfg.judge_model, draft)
        results.append((draft, ev))
    return results


def _print_report(draft, ev: Evaluation) -> None:
    line = "─" * 78
    print(f"\n{line}")
    print(f"  {ev.lead_name} · {draft.channel.upper()} · {draft.model} · {draft.latency_ms}ms")
    print(line)
    if draft.subject:
        print(f"  SUBJECT: {draft.subject}")
    print("  " + draft.body.replace("\n", "\n  "))
    print(f"  {'-' * 74}")
    for c in ev.checks:
        mark = "✅" if c.passed else ("⚠️ " if c.severity == "warn" else "❌")
        print(f"   {mark} {c.name:22} {c.detail}")
    verdict = "🟢 SEND" if ev.send else "🔴 HOLD (needs review)"
    print(f"  {'-' * 74}")
    print(f"   VERDICT: {verdict}  [programmatic_pass={ev.programmatic_pass}]")


def _save(results: list[tuple], out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    # Full JSON
    payload = []
    for draft, ev in results:
        payload.append({
            "lead": draft.lead.first_name,
            "channel": draft.channel,
            "subject": draft.subject,
            "body": draft.body,
            "model": draft.model,
            "latency_ms": draft.latency_ms,
            "evaluation": ev.to_dict(),
        })
    json_path = os.path.join(out_dir, "drafts.json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    log.info("Wrote %s", json_path)

    # Summary XLSX
    try:
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "drafts"
        ws.append(["Lead", "Channel", "Subject", "Send?", "Programmatic Pass", "Body"])
        for draft, ev in results:
            ws.append([
                draft.lead.first_name, draft.channel, draft.subject or "",
                "SEND" if ev.send else "HOLD", ev.programmatic_pass,
                draft.body,
            ])
        xlsx_path = os.path.join(out_dir, "drafts.xlsx")
        wb.save(xlsx_path)
        log.info("Wrote %s", xlsx_path)
    except Exception as exc:
        log.warning("Could not write XLSX summary: %s", exc)


def _run_pipeline(client: GroqClient, cfg, leads: list[Lead], channel_opt: str) -> list[tuple]:
    results = []
    for lead in leads:
        target_channels = []
        if channel_opt in {"email", "both"} and lead.has_email:
            target_channels.append("email")
        if channel_opt in {"linkedin", "both"} and lead.has_linkedin:
            target_channels.append("linkedin")

        if not target_channels:
            log.warning("Skipping lead %s: no matching channel for '%s'", lead.first_name, channel_opt)
            continue

        for ch in target_channels:
            try:
                draft = (gen.generate_email if ch == "email" else gen.generate_linkedin)(client, cfg, lead)
            except Exception as exc:
                log.error("Generation failed for %s/%s: %s", lead.first_name, ch, exc)
                continue
            ev = evaluate(draft)
            results.append((draft, ev))
            _print_report(draft, ev)
            import time
            time.sleep(1.0)

    return results


def main() -> None:
    ap = argparse.ArgumentParser(description="AI draft-messages POC")
    ap.add_argument("--limit", type=int, default=10, help="max leads to process")
    ap.add_argument("--channel", choices=["email", "linkedin", "both"], default="both")
    ap.add_argument("--input", default=None, help="override input file path(s), comma-separated")
    args = ap.parse_args()

    try:
        cfg = load_config()
    except ConfigError as exc:
        raise SystemExit(f"Configuration error: {exc}")

    log.info("Groq model=%s  key=%s", cfg.gen_model, cfg.masked_key())

    default_sources = [
        "../linkedin_poc/enriched_final.xlsx",
        "../Ada_poc/ada_projectbeacon_output.json",
        "../bodalogo_dataset_poc/bodalgo_projectbeacon_output.json",
        "../proz_poc/proz_projectbeacon_output.json",
    ]
    input_sources = args.input or cfg.input_path
    if not args.input and not os.path.exists(cfg.input_path):
        input_sources = [s for s in default_sources if os.path.exists(s)]

    log.info("Loading enriched profiles from: %s", input_sources)
    leads = load_leads(input_sources, limit=args.limit, only_enriched=True)

    client = GroqClient(cfg)
    all_results = _run_pipeline(client, cfg, leads, args.channel)

    _save(all_results, cfg.output_dir)

    sends = sum(1 for _, ev in all_results if ev.send)
    print(f"\n{'═' * 78}")
    print(f"  Done. {len(all_results)} drafts · {sends} SEND · {len(all_results) - sends} HOLD")
    print(f"  Full results in {cfg.output_dir}/drafts.json  and  {cfg.output_dir}/drafts.xlsx")
    print("═" * 78)


if __name__ == "__main__":
    main()


