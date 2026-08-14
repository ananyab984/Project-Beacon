"""
Stage 2 (interim): pull url + raw_content out of the Tavily extract
responses, one object per profile, ready to feed the deterministic parser.
"""

import json
import sys

INPUT_PATH = "ada_tavily_raw_output.json"
OUTPUT_PATH = "ada_raw_content.json"


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        tavily_responses = json.load(f)

    print(f"Loaded {len(tavily_responses)} Tavily responses from {INPUT_PATH}")

    profiles = []
    for i, response in enumerate(tavily_responses, start=1):
        results = response.get("results") or []
        if not results:
            print(f"[{i}/{len(tavily_responses)}] No results in response, skipping", file=sys.stderr)
            continue

        result = results[0]
        profiles.append({
            "profile_link": result.get("url"),
            "raw_content": result.get("raw_content"),
        })
        print(f"[{i}/{len(tavily_responses)}] Extracted raw_content for {result.get('url')}")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(profiles)} profiles to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
