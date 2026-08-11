"""Build enriched_output.xlsx from an existing raw_responses.json dump.

Re-parses the raw responses you already fetched (via dump_all_raw.py) and merges
them onto the original Excel rows — WITHOUT calling the API again. Use this to
regenerate the enriched workbook after tweaking parser.py's FIELD_MAP.

Usage:
    python build_excel_from_raw.py
    python build_excel_from_raw.py --raw raw_responses.json --input in.xlsx --output enriched_output.xlsx
"""

from __future__ import annotations

import argparse
import json
import sys

import pandas as pd

from excel_reader import read_profiles
from excel_writer import write_enriched
from logger import configure_logging, get_logger
from main import ERROR_COLUMN, STATUS_COLUMN
from parser import enrichment_columns, parse_profile

log = get_logger(__name__)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Build enriched Excel from cached raw JSON")
    ap.add_argument("--raw", default="raw_responses.json")
    ap.add_argument("--input", default="LinkedIn_Enrichment_Test_Cases.xlsx")
    ap.add_argument("--output", default="enriched_output.xlsx")
    args = ap.parse_args(argv)

    configure_logging("INFO")
    df = read_profiles(args.input)

    with open(args.raw, encoding="utf-8") as f:
        dump = json.load(f)
    results = dump["results"]

    if len(results) != len(df):
        log.warning("raw has %d results but Excel has %d rows; merging by position.",
                    len(results), len(df))

    empty = {col: "" for col in enrichment_columns()}
    rows, errors = [], []
    for i in range(len(df)):
        rec = results[i] if i < len(results) else {"status": "error", "error": "no raw record", "raw": None}
        if rec.get("status") == "success" and rec.get("raw") is not None:
            rows.append(parse_profile(rec["raw"]))
            errors.append("")
        else:
            rows.append(dict(empty))
            errors.append(rec.get("error") or "No enrichment data")

    enrichment_df = pd.DataFrame(rows, index=df.index)
    result = pd.concat([df.copy(), enrichment_df], axis=1)
    result[ERROR_COLUMN] = errors
    if STATUS_COLUMN in result.columns:
        result[STATUS_COLUMN] = ["Failed" if e else "Enriched" for e in errors]

    write_enriched(result, args.output)
    ok = sum(1 for e in errors if not e)
    log.info("Built %s: %d enriched, %d failed (from cached raw, no API calls).",
             args.output, ok, len(errors) - ok)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
