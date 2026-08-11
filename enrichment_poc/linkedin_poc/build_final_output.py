"""FINAL merge -> native 18-column Excel with LLM years + contact filled in.

Combines three sources onto the original ProZ columns:
  * input_LI3.xlsx          - the original rows (format + domain fields kept)
  * raw_responses_LI3.json  - Bright Data scrape -> Full_Name/First_Name/
                              Secondary_Languages/Vendor_Experience
  * llm_extracted.json      - Gemini strict extraction -> Years_of_Exp (only
                              when explicitly stated) + Contact_Number/Email

Policy:
  * Years_of_Exp   <- LLM value IF the LLM found it explicitly stated; else keep
                      the input cell untouched (no fabrication).
  * Contact_Number <- first LLM phone if present; Email_Address <- first LLM
                      email if present; websites appended to Enrichment_Notes.
  * Everything the LLM could NOT confirm stays exactly as it was.

No API calls - reads cached JSON only.

Usage:
    python build_final_output.py \
        --input input_LI3.xlsx --raw raw_responses_LI3.json \
        --llm llm_extracted.json --output enriched_final.xlsx
"""

from __future__ import annotations

import argparse
import json
import sys

from build_native_output import derive_secondary_languages, derive_vendor_experience
from excel_reader import read_profiles
from excel_writer import write_enriched
from logger import configure_logging, get_logger
from parser import normalize_response
from utils import clean_str, safe_get

log = get_logger(__name__)
MISSING = "[Missing Input]"


def build(input_path: str, raw_path: str, llm_path: str, output_path: str):
    df = read_profiles(input_path).copy()
    raw_results = json.load(open(raw_path, encoding="utf-8"))["results"]
    llm_rows = json.load(open(llm_path, encoding="utf-8"))
    llm_by_case = {r.get("case_id"): r for r in llm_rows}

    enriched = failed = 0
    for i in range(len(df)):
        idx = df.index[i]
        case_id = clean_str(df.at[idx, "Case_ID"])
        rec = raw_results[i] if i < len(raw_results) else {"raw": None}
        profile = normalize_response(rec.get("raw")) if rec.get("raw") is not None else {}
        name = clean_str(profile.get("name"))
        llm = llm_by_case.get(case_id, {})

        if not name:
            df.at[idx, "Enrichment_Status"] = "No public data"
            df.at[idx, "Enrichment_Notes"] = "Profile returned no public LinkedIn data (sparse/invalid)."
            failed += 1
            continue

        # --- Bright Data derived fields ---
        df.at[idx, "Full_Name"] = name
        first = clean_str(profile.get("first_name"))
        if first:
            df.at[idx, "First_Name"] = first
        source = clean_str(df.at[idx, "Source_Language"])
        target = clean_str(df.at[idx, "Target_Language"])
        cur_sec = clean_str(df.at[idx, "Secondary_Languages"]) or MISSING
        df.at[idx, "Secondary_Languages"] = derive_secondary_languages(
            profile.get("languages"), source, target, cur_sec) or MISSING
        company = clean_str(profile.get("current_company_name")) or clean_str(safe_get(profile, "current_company", "name"))
        cur_vendor = clean_str(df.at[idx, "Vendor_Experience"]) or MISSING
        df.at[idx, "Vendor_Experience"] = derive_vendor_experience(company, cur_vendor)

        # --- LLM-extracted years (only if explicitly stated) ---
        yrs = llm.get("years_of_professional_experience")
        yrs_note = ""
        if yrs is not None:
            df.at[idx, "Years_of_Exp"] = yrs
            yrs_note = f"Years_of_Exp={yrs} from LLM (stated: \"{llm.get('years_experience_evidence')}\")."
        else:
            yrs_note = "Years_of_Exp not explicitly stated on profile; input value kept."

        # --- LLM-extracted contact (only if present verbatim) ---
        ci = llm.get("contact_information") or {}
        emails, phones, websites = ci.get("emails") or [], ci.get("phones") or [], ci.get("websites") or []
        contact_note = ""
        if phones:
            df.at[idx, "Contact_Number"] = "; ".join(phones)
            contact_note += f" Phone(s): {'; '.join(phones)}."
        if emails:
            df.at[idx, "Email_Address"] = "; ".join(emails)
            contact_note += f" Email(s): {'; '.join(emails)}."
        if websites:
            contact_note += f" Website(s): {'; '.join(websites)}."
        if not (phones or emails or websites):
            contact_note = " No contact info present in public data."

        df.at[idx, "Enrichment_Status"] = "Enriched"
        df.at[idx, "Enrichment_Notes"] = (yrs_note + contact_note).strip()
        enriched += 1

    write_enriched(df, output_path)
    log.info("Built %s: %d enriched, %d no-data (native 18-col + LLM years/contact).",
             output_path, enriched, failed)
    return df


def main(argv):
    ap = argparse.ArgumentParser(description="Final merge: native format + LLM years/contact")
    ap.add_argument("--input", default="input_LI3.xlsx")
    ap.add_argument("--raw", default="raw_responses_LI3.json")
    ap.add_argument("--llm", default="llm_extracted.json")
    ap.add_argument("--output", default="enriched_final.xlsx")
    args = ap.parse_args(argv)
    configure_logging("INFO")
    build(args.input, args.raw, args.llm, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
