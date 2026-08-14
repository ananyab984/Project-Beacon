"""Phase 2 — full batch enrichment pipeline.

Reads the input Excel, enriches every recruiter's LinkedIn profile via Bright
Data (deduplicating repeated URLs so each is fetched at most once), flattens
and merges the results, and writes an enriched output workbook. Rows that fail
validation or enrichment are kept in the output with a populated
``Enrichment_Error`` column — never dropped.

Usage:
    python main.py                         # uses INPUT_PATH / OUTPUT_PATH from .env
    python main.py --input in.xlsx --output out.xlsx
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd

from brightdata_client import BrightDataClient, EnrichmentError
from config import Config, ConfigError, load_config
from excel_reader import PROFILE_LINK_COLUMN, read_profiles
from excel_writer import write_enriched
from logger import configure_logging, get_logger
from parser import enrichment_columns, parse_profile
from utils import clean_str, is_valid_linkedin_url, normalize_url, timed

log = get_logger(__name__)

ERROR_COLUMN = "Enrichment_Error"
STATUS_COLUMN = "Enrichment_Status"


def _empty_enrichment() -> dict[str, str]:
    """A blank enrichment record (all enrichment columns present, empty)."""
    return {col: "" for col in enrichment_columns()}


def enrich_dataframe(df: pd.DataFrame, client: BrightDataClient) -> pd.DataFrame:
    """Enrich every row, returning a new DataFrame with enrichment columns added.

    A per-run cache keyed on the normalized URL guarantees each distinct profile
    is fetched at most once (dedup requirement / API-credit saving).
    """
    # url -> either the flattened enrichment dict, or an EnrichmentError message.
    cache: dict[str, dict | str] = {}

    enrichment_rows: list[dict] = []
    errors: list[str] = []

    success_count = 0
    failure_count = 0
    cache_hits = 0

    for position, (idx, row) in enumerate(df.iterrows(), start=1):
        raw_link = row.get(PROFILE_LINK_COLUMN)
        link = clean_str(raw_link)
        label = clean_str(row.get("Case_ID")) or f"row {position}"

        log.info("Processing recruiter %d/%d (%s) link=%r", position, len(df), label, link or "<none>")

        # --- Validation gates -------------------------------------------
        if not link:
            msg = "Missing URL: Profile_Link is empty."
            log.warning("[%s] %s", label, msg)
            enrichment_rows.append(_empty_enrichment())
            errors.append(msg)
            failure_count += 1
            continue

        if not is_valid_linkedin_url(link):
            msg = f"Invalid URL: {link!r} does not match linkedin.com/in/..."
            log.warning("[%s] %s", label, msg)
            enrichment_rows.append(_empty_enrichment())
            errors.append(msg)
            failure_count += 1
            continue

        # --- Dedup / cache ----------------------------------------------
        key = normalize_url(link)
        if key in cache:
            cache_hits += 1
            cached = cache[key]
            log.info("[%s] Cache hit for %s (already fetched this run)", label, key)
            if isinstance(cached, str):  # cached failure
                enrichment_rows.append(_empty_enrichment())
                errors.append(cached)
                failure_count += 1
            else:
                enrichment_rows.append(dict(cached))
                errors.append("")
                success_count += 1
            continue

        # --- Live enrichment --------------------------------------------
        try:
            raw = client.enrich_profile(link)
            flat = parse_profile(raw)
            cache[key] = flat
            enrichment_rows.append(flat)
            errors.append("")
            success_count += 1
            log.info("[%s] Enriched OK", label)
        except EnrichmentError as exc:
            cache[key] = exc.message  # cache the failure too (don't re-call)
            enrichment_rows.append(_empty_enrichment())
            errors.append(exc.message)
            failure_count += 1
            log.error("[%s] Enrichment failed: %s", label, exc.message)
        except Exception as exc:  # noqa: BLE001 - last-resort guard, keep row
            msg = f"Unexpected error: {exc}"
            cache[key] = msg
            enrichment_rows.append(_empty_enrichment())
            errors.append(msg)
            failure_count += 1
            log.exception("[%s] Unexpected error during enrichment", label)

    # --- Assemble output -----------------------------------------------
    enrichment_df = pd.DataFrame(enrichment_rows, index=df.index)
    result = pd.concat([df.copy(), enrichment_df], axis=1)
    result[ERROR_COLUMN] = errors
    # Reflect success/failure in the existing status column if present.
    if STATUS_COLUMN in result.columns:
        result[STATUS_COLUMN] = [
            "Failed" if e else "Enriched" for e in errors
        ]

    log.info(
        "Batch summary: %d succeeded, %d failed, %d cache hits (%d rows total)",
        success_count,
        failure_count,
        cache_hits,
        len(df),
    )
    return result


def run(config: Config) -> pd.DataFrame:
    """Execute the full pipeline end-to-end and write the output file."""
    log.info("=== Bright Data enrichment run START ===")
    log.info("Config: dataset_id=%s api_key=%s timeout=%ss max_retries=%d",
             config.dataset_id, config.masked_key(), config.request_timeout, config.max_retries)

    with timed() as total:
        df = read_profiles(config.input_path)
        client = BrightDataClient(config)
        result = enrich_dataframe(df, client)
        write_enriched(result, config.output_path)

    log.info("=== Bright Data enrichment run COMPLETE in %ss -> %s ===",
             total.seconds, config.output_path)
    return result


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Bright Data LinkedIn enrichment pipeline")
    p.add_argument("--input", help="Path to input .xlsx (overrides INPUT_PATH)")
    p.add_argument("--output", help="Path to output .xlsx (overrides OUTPUT_PATH)")
    p.add_argument("--log-file", help="Optional path to also write logs to a file")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    try:
        config = load_config(require_api_key=True)
    except ConfigError as exc:
        configure_logging("INFO")
        get_logger(__name__).error("Configuration error: %s", exc)
        return 2

    # Apply CLI overrides.
    if args.input:
        config = Config(**{**config.__dict__, "input_path": args.input})
    if args.output:
        config = Config(**{**config.__dict__, "output_path": args.output})

    configure_logging(config.log_level, log_file=args.log_file)

    try:
        run(config)
    except FileNotFoundError as exc:
        log.error("Input file not found: %s", exc)
        return 1
    except Exception as exc:  # noqa: BLE001
        log.exception("Pipeline failed: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
