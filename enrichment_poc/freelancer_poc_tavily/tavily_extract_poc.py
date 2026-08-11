"""
POC: Extract Freelancer profile URLs from Freelancer_Public_Profile_Input_Dataset.xlsx
via Tavily Extract API using ThreadPoolExecutor for fast execution.
"""

import json
import os
import sys
import concurrent.futures
import pandas as pd
import requests
from dotenv import load_dotenv

INPUT_PATH = "Freelancer_Public_Profile_Input_Dataset.xlsx"
URL_COLUMN = "Profile_Link"
OUTPUT_PATH = "freelancer_tavily_raw_output.json"
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
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def process_url(item):
    idx, case_id, name, url = item
    print(f"[{idx}] Extracting {case_id} ({name}): {url}")
    try:
        raw_response = extract_url(url)
        print(f"[{idx}] OK: {case_id}")
        return {
            "case_id": case_id,
            "full_name": name,
            "url": url,
            "status": "success",
            "response": raw_response
        }
    except Exception as e:
        print(f"[{idx}] FAILED: {case_id} - {e}")
        return {
            "case_id": case_id,
            "full_name": name,
            "url": url,
            "status": "failed",
            "error": str(e)
        }


def main():
    df = pd.read_excel(INPUT_PATH)
    items = []
    for idx, row in df.iterrows():
        items.append((idx + 1, row["Case_ID"], row["Full_Name"], row["Profile_Link"]))

    print(f"Starting extraction for {len(items)} profiles in parallel...")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(process_url, item) for item in items]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    # Sort results by case_id
    results.sort(key=lambda x: x["case_id"])

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nCompleted! Saved {len(results)} responses to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
