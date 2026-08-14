"""Generate a MOCK sample output workbook to illustrate the output schema.

This does NOT call Bright Data. It feeds the real input rows through the real
pipeline using a stub client that returns the sample_response.json fixture, so
you can see exactly what columns enriched_output.xlsx will contain — without an
API key. The invalid/edge rows still exercise the error path.

Run:  python make_sample_output.py   ->  sample_enriched_output.xlsx
"""

from __future__ import annotations

import json

from excel_reader import read_profiles
from excel_writer import write_enriched
from logger import configure_logging, get_logger
from main import enrich_dataframe

configure_logging("INFO")
log = get_logger(__name__)

with open("sample_response.json", encoding="utf-8") as f:
    SAMPLE = json.load(f)


class _MockClient:
    """Returns the fixture for every valid URL (marks TC09 'broken' as failing)."""

    def enrich_profile(self, url: str):
        from brightdata_client import EnrichmentError

        if "mformby" in url:  # TC09 is described as a broken/invalid profile
            raise EnrichmentError("No data returned for profile (simulated broken profile)")
        data = dict(SAMPLE)
        data["url"] = url  # reflect the actual input URL
        return data


def main() -> int:
    df = read_profiles("LinkedIn_Enrichment_Test_Cases.xlsx")
    result = enrich_dataframe(df, _MockClient())
    write_enriched(result, "sample_enriched_output.xlsx")
    log.info("MOCK sample written to sample_enriched_output.xlsx (NOT real API data).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
