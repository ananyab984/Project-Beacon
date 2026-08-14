"""
Minimal POC: extract Bodalgo profile URLs from bodalgo_test.csv via the
Tavily Extract API and dump the complete, unmodified raw JSON responses.
"""

import json
import os
import sys

import pandas as pd
import requests
from dotenv import load_dotenv

CSV_PATH = "bodalgo_test.csv"
URL_COLUMN = "Profile_Link"
OUTPUT_PATH = "tavily_raw_output.json"
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"

load_dotenv()
API_KEY = os.getenv("TAVILY_API_KEY")
if not API_KEY:
    print("ERROR: TAVILY_API_KEY not found in .env", file=sys.stderr)
    sys.exit(1)


def extract_url(url: str) -> dict:
    response = requests.post(
        TAVILY_EXTRACT_URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "urls": [url],
            "extract_depth": "advanced",
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def main():
    df = pd.read_csv(CSV_PATH)
    urls = df[URL_COLUMN].dropna().tolist()

    print(f"Loaded {len(urls)} profile URLs from {CSV_PATH}")

    results = []
    for i, url in enumerate(urls, start=1):
        print(f"[{i}/{len(urls)}] Extracting: {url}")
        try:
            raw_response = extract_url(url)
            results.append(raw_response)
            print(f"[{i}/{len(urls)}] OK")
        except requests.exceptions.RequestException as e:
            print(f"[{i}/{len(urls)}] FAILED: {e}", file=sys.stderr)
            continue

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(results)} raw responses to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
