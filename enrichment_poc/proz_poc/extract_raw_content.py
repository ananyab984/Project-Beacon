"""
Stage 2: consolidate the Tavily Search results for each ProZ profile URL into
one object per profile. Extract's raw_content is never available for
proz.com (Cloudflare-blocked, see tavily_extract_poc.py), so this pulls from
the Search fallback instead: the exact-URL result (the profile page itself)
becomes "primary_snippet", and every other on-domain result found for that
URL (KudoZ pages, feedback cards, other-language mirrors) is kept as
supporting "other_snippets" for extra signal (e.g. citizenship mentions,
language pairs asked/answered in KudoZ).
"""

import json
import sys
from urllib.parse import urlsplit

INPUT_PATH = "proz_tavily_search_raw_output.json"
OUTPUT_PATH = "proz_raw_content.json"


def strip_query(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        search_responses = json.load(f)

    print(f"Loaded {len(search_responses)} Tavily search responses from {INPUT_PATH}")

    profiles = []
    for i, response in enumerate(search_responses, start=1):
        profile_link = response.get("_source_profile_url")
        results = response.get("results") or []

        # Prefer an exact URL match (the profile page itself, no query
        # string) over a same-path-different-query match (e.g. a KudoZ
        # popup on the same profile ID), since stripping query strings
        # alone conflates the two.
        primary = None
        for result in results:
            if result.get("url") == profile_link:
                primary = result
                break
        if primary is None:
            for result in results:
                if strip_query(result.get("url", "")) == strip_query(profile_link):
                    primary = result
                    break

        others = [r for r in results if r is not primary]

        profiles.append({
            "profile_link": profile_link,
            "primary_snippet": {
                "title": primary.get("title"),
                "content": primary.get("content"),
            } if primary else None,
            "other_snippets": [
                {"url": r.get("url"), "title": r.get("title"), "content": r.get("content")}
                for r in others
            ],
        })
        found = "found" if primary else "NOT FOUND"
        print(f"[{i}/{len(search_responses)}] {profile_link}: primary snippet {found}, {len(others)} supporting snippet(s)")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(profiles)} profiles to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
