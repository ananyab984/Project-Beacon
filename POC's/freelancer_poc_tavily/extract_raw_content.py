"""
Stage 2: pull case_id, profile_link, full_name + raw_content out of the Tavily extract
responses, one object per profile, ready to feed the parser.
"""

import json
import sys

INPUT_PATH = "freelancer_tavily_raw_output.json"
OUTPUT_PATH = "freelancer_raw_content.json"


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    print(f"Loaded {len(items)} Tavily responses from {INPUT_PATH}")

    profiles = []
    for i, item in enumerate(items, start=1):
        if item.get("status") != "success":
            print(f"[{i}/{len(items)}] Status not success, skipping", file=sys.stderr)
            continue

        resp = item.get("response", {})
        results = resp.get("results") or []
        if not results:
            print(f"[{i}/{len(items)}] No results in response, skipping", file=sys.stderr)
            continue

        result = results[0]
        profiles.append({
            "case_id": item.get("case_id"),
            "full_name": item.get("full_name"),
            "profile_link": item.get("url"),
            "title": result.get("title"),
            "raw_content": result.get("raw_content"),
        })
        print(f"[{i}/{len(items)}] Extracted raw_content for {item.get('case_id')} ({item.get('url')})")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(profiles)} profiles to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
