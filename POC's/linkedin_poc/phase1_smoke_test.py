"""Phase 1 — single-profile smoke test (the validation gate before Phase 2).

Sends ONE real LinkedIn URL (the first valid one in the Excel, or a URL you
pass on the CLI) to Bright Data and prints exactly what the spec's Phase 1
checklist asks you to confirm:

  * Authentication succeeds and the endpoint is reachable.
  * The request shape (dataset_id/format as query params + JSON array body) is
    accepted.
  * The ACTUAL response shape — dict vs list.
  * Which requested fields are actually populated vs null/missing.
  * The real end-to-end response time.

The raw response is saved to ``phase1_raw_response.json`` for inspection.
Do NOT proceed to Phase 2 (main.py) until this passes on a real response.

Usage:
    python phase1_smoke_test.py                       # first valid URL in Excel
    python phase1_smoke_test.py https://www.linkedin.com/in/someone/
"""

from __future__ import annotations

import json
import sys

from brightdata_client import BrightDataClient, EnrichmentError
from config import ConfigError, load_config
from excel_reader import PROFILE_LINK_COLUMN, read_profiles
from logger import configure_logging, get_logger
from parser import COL_PREFIX, parse_profile
from utils import clean_str, is_valid_linkedin_url, timed

log = get_logger(__name__)

RAW_OUTPUT_PATH = "phase1_raw_response.json"


def _pick_url_from_excel(input_path: str) -> str | None:
    df = read_profiles(input_path)
    for _, row in df.iterrows():
        link = clean_str(row.get(PROFILE_LINK_COLUMN))
        if is_valid_linkedin_url(link):
            return link
    return None


def _describe_shape(raw: object) -> str:
    if isinstance(raw, dict):
        return f"dict with {len(raw)} top-level keys"
    if isinstance(raw, list):
        inner = type(raw[0]).__name__ if raw else "?"
        return f"list of {len(raw)} item(s) (first item: {inner})"
    return type(raw).__name__


def main(argv: list[str]) -> int:
    try:
        config = load_config(require_api_key=True)
    except ConfigError as exc:
        configure_logging("INFO")
        log.error("Configuration error: %s", exc)
        return 2

    configure_logging(config.log_level)

    # Choose the URL: CLI arg wins, else first valid URL from the Excel.
    if argv:
        url = argv[0].strip()
    else:
        url = _pick_url_from_excel(config.input_path)

    if not url or not is_valid_linkedin_url(url):
        log.error("No valid LinkedIn /in/ URL to test (got %r).", url)
        return 1

    print("=" * 70)
    print("PHASE 1 SMOKE TEST")
    print("=" * 70)
    print(f"Endpoint    : {config.base_url}")
    print(f"dataset_id  : {config.dataset_id}  (sent as query param)")
    print(f"format      : {config.response_format}  (sent as query param)")
    print(f"API key     : {config.masked_key()}")
    print(f"Test URL    : {url}")
    print("-" * 70)

    client = BrightDataClient(config)
    try:
        with timed() as t:
            raw = client.enrich_profile(url)
    except EnrichmentError as exc:
        print(f"\n❌ FAILED: {exc.message}")
        print("\nDebugging tips:")
        print("  401 -> API key wrong/expired (check .env BRIGHTDATA_API_KEY).")
        print("  400/404 -> DATASET_ID wrong, or query-param shape rejected.")
        print("  429 -> rate limited; try again shortly.")
        print("  Timeout -> raise REQUEST_TIMEOUT in .env.")
        return 1

    # --- Save + report --------------------------------------------------
    with open(RAW_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(raw, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Authentication + endpoint OK.")
    print(f"⏱  Response time : {t.seconds}s "
          f"({'in the documented 10-30s range' if 10 <= t.seconds <= 30 else 'NOTE: outside the documented 10-30s range'})")
    print(f"📦 Response SHAPE: {_describe_shape(raw)}")
    print(f"   -> Parser will {'use it directly' if isinstance(raw, dict) else 'take the first list item'}.")
    print(f"💾 Raw JSON saved to: {RAW_OUTPUT_PATH}")

    # Field presence report.
    flat = parse_profile(raw)
    print("\nRequested field presence (flattened):")
    present, missing = [], []
    for col, val in flat.items():
        name = col[len(COL_PREFIX):]
        (present if str(val).strip() else missing).append(name)
    print(f"  PRESENT ({len(present)}): {', '.join(present) or '—'}")
    print(f"  EMPTY/NULL ({len(missing)}): {', '.join(missing) or '—'}")
    print("\n(Email/phone are expected to be empty on public profiles — that is normal.)")

    print("\n" + "=" * 70)
    print("PHASE 1 CHECKLIST — confirm each before running main.py (Phase 2):")
    print("  [x] Authentication succeeded")
    print("  [x] Endpoint reachable + query-param request accepted")
    print(f"  [{'x' if isinstance(raw, (dict, list)) else ' '}] Response shape confirmed above (dict vs list)")
    print("  [ ] Review phase1_raw_response.json: are the fields you need present?")
    print(f"  [{'x' if 10 <= t.seconds <= 30 else ' '}] Response time within documented range")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
