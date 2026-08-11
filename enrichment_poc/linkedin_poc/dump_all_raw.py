"""Dump the RAW Bright Data response for EVERY profile in the Excel.

Unlike phase1_smoke_test.py (which tests only the first valid URL), this walks
all rows, calls the API once per unique URL (dedup), and writes a single JSON
file containing, for each profile, EITHER its raw response OR an error message.
Nothing is dropped — invalid/missing/failed rows appear with status "error".

Usage:
    python dump_all_raw.py
    python dump_all_raw.py --input my.xlsx --output raw_responses.json
"""

from __future__ import annotations

import argparse
import json
import sys

from brightdata_client import BrightDataClient, EnrichmentError
from config import ConfigError, load_config
from excel_reader import PROFILE_LINK_COLUMN, read_profiles
from logger import configure_logging, get_logger
from utils import clean_str, is_valid_linkedin_url, normalize_url, timed

log = get_logger(__name__)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Dump raw Bright Data responses for all profiles")
    parser.add_argument("--input", help="Path to input .xlsx (overrides INPUT_PATH)")
    parser.add_argument("--output", default="raw_responses.json", help="Where to write the raw dump")
    args = parser.parse_args(argv)

    try:
        config = load_config(require_api_key=True)
    except ConfigError as exc:
        configure_logging("INFO")
        log.error("Configuration error: %s", exc)
        return 2

    configure_logging(config.log_level)
    input_path = args.input or config.input_path

    df = read_profiles(input_path)
    client = BrightDataClient(config)

    # url -> raw response (dict/list) OR error string, so each URL is called once.
    cache: dict[str, object] = {}
    results: list[dict] = []
    success = failed = cache_hits = 0

    for position, (_, row) in enumerate(df.iterrows(), start=1):
        case_id = clean_str(row.get("Case_ID")) or f"row {position}"
        url = clean_str(row.get(PROFILE_LINK_COLUMN))
        record: dict = {"case_id": case_id, "url": url}

        log.info("Processing %d/%d (%s) url=%r", position, len(df), case_id, url or "<none>")

        # Validation gates -> error record, no API call.
        if not url:
            record.update(status="error", error="Missing URL: Profile_Link is empty.", raw=None)
            results.append(record); failed += 1
            continue
        if not is_valid_linkedin_url(url):
            record.update(status="error", error=f"Invalid URL: does not match linkedin.com/in/...", raw=None)
            results.append(record); failed += 1
            continue

        key = normalize_url(url)
        if key in cache:
            cache_hits += 1
            cached = cache[key]
            record["from_cache"] = True
            if isinstance(cached, str):
                record.update(status="error", error=cached, raw=None); failed += 1
            else:
                record.update(status="success", error=None, raw=cached); success += 1
            log.info("[%s] cache hit", case_id)
            results.append(record)
            continue

        # Live call.
        try:
            with timed() as t:
                raw = client.enrich_profile(url)
            cache[key] = raw
            record.update(status="success", error=None, elapsed_s=t.seconds, raw=raw)
            success += 1
        except EnrichmentError as exc:
            cache[key] = exc.message
            record.update(status="error", error=exc.message, raw=None)
            failed += 1
            log.error("[%s] %s", case_id, exc.message)
        results.append(record)

    payload = {
        "summary": {
            "total": len(df),
            "success": success,
            "failed": failed,
            "cache_hits": cache_hits,
        },
        "results": results,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print("=" * 60)
    print(f"Wrote {args.output}")
    print(f"  total={len(df)}  success={success}  failed={failed}  cache_hits={cache_hits}")
    for r in results:
        mark = "OK " if r["status"] == "success" else "ERR"
        note = "" if r["status"] == "success" else f" -> {r['error']}"
        print(f"  [{mark}] {r['case_id']:6} {r['url']}{note}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
