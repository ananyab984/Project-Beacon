"""
Stage 1b: ProZ.com sits behind Cloudflare bot-challenge pages (verified via
tavily_extract_poc.py -> every URL comes back "Failed to fetch url", and a
plain curl to the same URL returns HTTP 403 / "Just a moment..."). Tavily's
Extract API cannot fetch these pages live.

Fallback: Tavily's Search API returns previously-indexed snippets for these
same URLs (title + short content excerpt) without needing to fetch the page
live. This is a materially weaker signal than Extract's full raw_content
(no full bio text, no email/phone, no bio paragraphs) but is the only data
Tavily can surface for ProZ profiles. Dump the complete, unmodified raw JSON
responses for each profile URL searched.
"""

import json
import os
import sys

import requests
from dotenv import load_dotenv

PROFILE_URLS = [
    "https://www.proz.com/profile/913793",
    "https://www.proz.com/profile/108627",
    "https://www.proz.com/profile/1898441",
    "https://www.proz.com/translator/3112043",
    "https://www.proz.com/profile/1217087",
]

OUTPUT_PATH = "proz_tavily_search_raw_output.json"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"

load_dotenv()
API_KEY = os.getenv("TAVILY_API_KEY")
if not API_KEY:
    print("ERROR: TAVILY_API_KEY not found in .env", file=sys.stderr)
    sys.exit(1)


def search_url(url: str) -> dict:
    response = requests.post(
        TAVILY_SEARCH_URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "query": url,
            "include_domains": ["proz.com"],
            "search_depth": "basic",
            "include_raw_content": True,
            "max_results": 5,
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def main():
    print(f"Loaded {len(PROFILE_URLS)} profile URLs")

    results = []
    for i, url in enumerate(PROFILE_URLS, start=1):
        print(f"[{i}/{len(PROFILE_URLS)}] Searching: {url}")
        try:
            raw_response = search_url(url)
            raw_response["_source_profile_url"] = url
            results.append(raw_response)
            print(f"[{i}/{len(PROFILE_URLS)}] OK ({len(raw_response.get('results', []))} results)")
        except requests.exceptions.RequestException as e:
            print(f"[{i}/{len(PROFILE_URLS)}] FAILED: {e}", file=sys.stderr)
            continue

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(results)} raw responses to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
