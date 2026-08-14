"""Build an enriched workbook in the ORIGINAL 18-column (ProZ) format.

Unlike build_excel_from_raw.py (which appends Enriched_* columns), this maps the
LinkedIn enrichment IN PLACE onto the native ProZ columns, matching the format
of the target file. Policy (per user decision "Derive + keep input"):

  * DERIVE from LinkedIn when it has the data:
      - Full_Name / First_Name        <- name / first_name
      - Secondary_Languages           <- languages[] (minus Source/Target)
      - Vendor_Experience             <- current_company (Freelance vs In-house)
  * KEEP the input value otherwise (LinkedIn can't infer these):
      - Source_Language / Target_Language / Services
      - Years_of_Exp  (no public experience array is returned -> not derivable)
      - Country_of_Residence
  * Email_Address / Contact_Number stay [Missing Input] (never public).
  * Enrichment_Status / Enrichment_Notes reflect what happened per row.

Reads cached raw JSON -> NO API calls.

Usage:
    python build_native_output.py --input input_LI.xlsx --raw raw_responses_LI.json --output enriched_output_LI.xlsx
"""

from __future__ import annotations

import argparse
import json
import sys

import pandas as pd

from excel_reader import read_profiles
from excel_writer import write_enriched
from logger import configure_logging, get_logger
from parser import normalize_response
from utils import clean_str, is_missing, safe_get

log = get_logger(__name__)

MISSING = "[Missing Input]"
FREELANCE_MARKERS = ("freelance", "self-employed", "self employed", "independent", "freelancer")


def _lang_titles(languages) -> list[str]:
    out = []
    for item in languages or []:
        title = item.get("title") if isinstance(item, dict) else str(item)
        if title:
            out.append(title.strip())
    return out


def derive_secondary_languages(languages, source: str, target: str, current: str) -> str:
    """LinkedIn languages minus the Source/Target; fall back to the input value."""
    titles = _lang_titles(languages)
    if not titles:
        return current  # LinkedIn had nothing -> keep input
    excl = {source.strip().lower(), target.strip().lower()}
    kept = [t for t in titles if t.lower() not in excl]
    return ", ".join(dict.fromkeys(kept)) if kept else current


def derive_vendor_experience(company: str, current: str) -> str:
    """Freelance vs In-house from the current company; else keep input."""
    if not company:
        return current
    low = company.lower()
    if any(marker in low for marker in FREELANCE_MARKERS):
        return "Freelance"
    return "In-house"


def build(input_path: str, raw_path: str, output_path: str) -> pd.DataFrame:
    df = read_profiles(input_path).copy()
    with open(raw_path, encoding="utf-8") as f:
        results = json.load(f)["results"]

    enriched = failed = 0
    for i in range(len(df)):
        rec = results[i] if i < len(results) else {"status": "error", "raw": None, "error": "no record"}
        profile = normalize_response(rec.get("raw")) if rec.get("raw") is not None else {}
        name = clean_str(profile.get("name"))

        # No usable public data (sparse LI08 / invalid LI10 / empty profile).
        if not name:
            df.at[df.index[i], "Enrichment_Status"] = "No public data"
            note = rec.get("error") or "Profile returned no public LinkedIn data (sparse/invalid)."
            df.at[df.index[i], "Enrichment_Notes"] = note
            failed += 1
            continue

        # --- Derive from LinkedIn ---
        first = clean_str(profile.get("first_name"))
        df.at[df.index[i], "Full_Name"] = name
        if first:
            df.at[df.index[i], "First_Name"] = first

        source = clean_str(df.at[df.index[i], "Source_Language"])
        target = clean_str(df.at[df.index[i], "Target_Language"])
        cur_secondary = clean_str(df.at[df.index[i], "Secondary_Languages"]) or MISSING
        secondary = derive_secondary_languages(profile.get("languages"), source, target, cur_secondary)
        df.at[df.index[i], "Secondary_Languages"] = secondary or MISSING

        company = clean_str(profile.get("current_company_name")) or clean_str(safe_get(profile, "current_company", "name"))
        cur_vendor = clean_str(df.at[df.index[i], "Vendor_Experience"]) or MISSING
        df.at[df.index[i], "Vendor_Experience"] = derive_vendor_experience(company, cur_vendor)

        # Years_of_Exp: no public experience array -> keep input untouched.

        # --- Status + human-readable note of exactly what was enriched ---
        derived_bits = [f"name", f"languages={_lang_titles(profile.get('languages')) or 'n/a'}"]
        if company:
            derived_bits.append(f"company='{company}'")
        edu = safe_get(profile, "educations_details") or ""
        exp_n = len(profile.get("experience") or [])
        note = (
            f"Enriched from LinkedIn ({', '.join(derived_bits)}). "
            f"Education: {edu or 'n/a'}. "
            f"Experience entries returned: {exp_n} "
            f"(public work-history not exposed; Years_of_Exp kept from input). "
            f"Email/phone not public."
        )
        df.at[df.index[i], "Enrichment_Status"] = "Enriched"
        df.at[df.index[i], "Enrichment_Notes"] = note
        enriched += 1

    write_enriched(df, output_path)
    log.info("Built %s: %d enriched, %d no-data (native 18-column format, no API calls).",
             output_path, enriched, failed)
    return df


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Build enriched Excel in native ProZ column format")
    ap.add_argument("--input", default="input_LI.xlsx")
    ap.add_argument("--raw", default="raw_responses_LI.json")
    ap.add_argument("--output", default="enriched_output_LI.xlsx")
    args = ap.parse_args(argv)
    configure_logging("INFO")
    build(args.input, args.raw, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
