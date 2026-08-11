"""Run the Gemini LLM extraction layer over a raw Bright Data dump.

Pipeline:
    dump_all_raw.py  ->  raw_responses*.json   (Bright Data raw scrape)
    llm_enrich.py    ->  llm_extracted.json    (years_of_exp + contact info)

For each profile it asks Gemini to extract ONLY explicitly-present years of
experience and contact info (see gemini_extractor for the strict rules), then
prints a table and writes the structured results.

Usage:
    python llm_enrich.py                              # default raw + output paths
    python llm_enrich.py --raw raw_responses_LI3.json --output llm_extracted.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from dotenv import load_dotenv

from gemini_extractor import GeminiExtractor
from logger import configure_logging, get_logger

load_dotenv(override=False)
log = get_logger(__name__)


def _unwrap(raw):
    if isinstance(raw, list):
        return raw[0] if raw else None
    return raw


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="LLM (Gemini) extraction over raw Bright Data JSON")
    ap.add_argument("--raw", default="raw_responses_LI3.json")
    ap.add_argument("--output", default="llm_extracted.json")
    ap.add_argument("--delay", type=float, default=5.0,
                    help="Seconds to wait between profiles (free-tier rate limit).")
    args = ap.parse_args(argv)

    configure_logging("INFO")
    with open(args.raw, encoding="utf-8") as f:
        dump = json.load(f)
    results = dump["results"] if isinstance(dump, dict) and "results" in dump else [
        {"case_id": str(i + 1), "raw": r} for i, r in enumerate(dump if isinstance(dump, list) else [dump])
    ]

    extractor = GeminiExtractor()
    log.info("Using Gemini model: %s over %d profiles", extractor.model, len(results))

    out = []
    for i, rec in enumerate(results):
        if i:
            time.sleep(args.delay)  # throttle for free-tier per-minute limits
        cid = rec.get("case_id", "?")
        profile = _unwrap(rec.get("raw"))
        name = profile.get("name") if isinstance(profile, dict) else None

        if not isinstance(profile, dict) or not name:
            log.info("[%s] no usable profile data; skipping LLM.", cid)
            out.append({"case_id": cid, "name": name, "status": "no_data",
                        "years_of_professional_experience": None, "contact_information": {}})
            continue

        try:
            ext = extractor.extract(profile)
            ext.update(case_id=cid, name=name, status="ok")
            out.append(ext)
            log.info("[%s] %s -> years=%s contacts=%s", cid, name,
                     ext.get("years_of_professional_experience"),
                     {k: v for k, v in ext.get("contact_information", {}).items() if v})
        except Exception as exc:  # noqa: BLE001
            log.error("[%s] LLM extraction failed: %s", cid, exc)
            out.append({"case_id": cid, "name": name, "status": f"error: {exc}",
                        "years_of_professional_experience": None, "contact_information": {}})

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    _print_table(out)
    log.info("Wrote %s", args.output)
    return 0


def _print_table(rows: list[dict]) -> None:
    def contacts_str(ci: dict) -> str:
        parts = []
        for k in ("emails", "phones", "websites", "other"):
            for v in (ci or {}).get(k, []):
                parts.append(v)
        return "; ".join(parts) if parts else "—"

    hdr = ("Case", "Name", "Years of Exp", "Evidence (verbatim)", "Contact Info")
    w = (5, 20, 12, 34, 30)
    line = lambda r: " | ".join(str(c)[: w[i]].ljust(w[i]) for i, c in enumerate(r))
    print("\n" + line(hdr))
    print("-+-".join("-" * x for x in w))
    for r in rows:
        yrs = r.get("years_of_professional_experience")
        ev = r.get("years_experience_evidence") or ("—" if r.get("status") == "ok" else r.get("status"))
        print(line((r.get("case_id"), r.get("name") or "—",
                    f"{yrs} yrs" if yrs is not None else "not stated",
                    ev, contacts_str(r.get("contact_information")))))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
