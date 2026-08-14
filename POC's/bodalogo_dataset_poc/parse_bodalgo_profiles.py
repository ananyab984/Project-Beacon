"""
Stage 2: parse Bodalgo raw_content (from bodalgo_raw_content.json) into the
Template_ProjectBeacon.xlsx schema using deterministic text parsing —
no LLM call. Bodalgo's page markup is consistent enough that regex /
string-section extraction covers it; unavailable fields are left null
rather than guessed.

Known limitations (documented, not hidden):
- Reachout Date, Application Date, Contact_Number, Email_Address,
  Target_Language, Country_of_Residence: Bodalgo profile pages never
  expose these, so they are always null.
- Source_Language: filled from the profile's first listed "Mother tongue"
  (a real fact on the page), not a true translation source language.
- Secondary_Languages: filled from the profile's "Foreign languages" line.
- Services: the profile's "Voice usage" tags, plus any explicit service
  keywords (translation, subtitling, dubbing, etc.) found in the bio text.
- Years_of_Exp / Vendor_Experience: extracted via best-effort phrase
  matching over free-text bio sections (e.g. "over 10 years of
  experience", "clients include X, Y, Z"). These are heuristics over
  unstructured prose and can legitimately be null when no such phrase
  is present.
"""

import json
import re
import sys

INPUT_PATH = "bodalgo_raw_content.json"
OUTPUT_PATH = "bodalgo_projectbeacon_output.json"

TEMPLATE_FIELDS = [
    "Reachout Date",
    "Application Date",
    "First_Name",
    "Full_Name",
    "Country_of_Residence",
    "Source",
    "Profile_Link",
    "Contact_Number",
    "Email_Address",
    "Services",
    "Source_Language",
    "Target_Language",
    "Secondary_Languages",
    "Years_of_Exp",
    "Vendor_Experience",
]

GONE_PAGE_MARKER = "This page once existed but has been deleted permanently."

# Every Bodalgo page repeats the same header/footer nav (including links
# like "Audio Transcription" / "Video Transcription") regardless of the
# profile's actual content. Free-text heuristics (service keywords, years
# of experience, client lists) must only run over the profile body, or
# they pick up boilerplate as if it were profile-specific fact.
BODY_END_MARKERS = [
    "You are about to flag this profile",
    "![Image 3: bodalgo logo",
]

SERVICE_KEYWORDS = {
    "translation": "Translation",
    "translator": "Translation",
    "subtitling": "Subtitling",
    "subtitle": "Subtitling",
    "sdh": "SDH",
    "closed caption": "CC",
    "audio description": "AD",
    "interpreting": "Interpreting",
    "localization": "Localization",
    "localisation": "Localization",
    "transcription": "Transcription",
    "dubbing": "Dubbing",
}

YEARS_OF_EXP_PATTERNS = [
    r"over\s+(\d{1,2})\s*(?:\+\s*)?years?",
    r"more than\s+(\d{1,2})\s*years?",
    r"(\d{1,2})\s*\+\s*years? of experience",
    r"(\d{1,2})\s*years?\s*(?:of\s+)?experience",
    r"(\d{1,2})-year career",
]

CLIENT_LIST_PATTERNS = [
    r"clients?\s+(?:include|consist of|such as)[:\s]*(.+?)(?:\n##|\n×|\Z)",
    r"companies (?:i'?ve|i have) worked for include[:\s]*(.+?)(?:\n##|\n×|\Z)",
]


def is_gone_page(raw_content: str) -> bool:
    return GONE_PAGE_MARKER in (raw_content or "")


def extract_body(raw_content: str) -> str:
    end = len(raw_content)
    for marker in BODY_END_MARKERS:
        pos = raw_content.find(marker)
        if pos != -1:
            end = min(end, pos)
    return raw_content[:end]


def extract_full_name(raw_content: str) -> str | None:
    for line in raw_content.splitlines():
        line = line.strip()
        if line.startswith("# ") and "gone" not in line.lower():
            return line[2:].strip()
    return None


def extract_bracket_list(raw_content: str, label: str, stop_labels) -> list[str]:
    idx = raw_content.find(label)
    if idx == -1:
        return []
    segment = raw_content[idx + len(label):]
    stop_idx = len(segment)
    for stop_label in stop_labels:
        pos = segment.find(stop_label)
        if pos != -1:
            stop_idx = min(stop_idx, pos)
    segment = segment[:stop_idx]
    return re.findall(r"\[([^\]]+)\]", segment)


def extract_foreign_languages(raw_content: str) -> str | None:
    match = re.search(r"Foreign languages\s+([A-Za-z][A-Za-z ,/]*?)(?:\n|##|$)", raw_content)
    if match:
        return match.group(1).strip()
    return None


def extract_years_of_exp(raw_content: str) -> int | None:
    for pattern in YEARS_OF_EXP_PATTERNS:
        match = re.search(pattern, raw_content, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def extract_vendor_experience(raw_content: str) -> str | None:
    for pattern in CLIENT_LIST_PATTERNS:
        match = re.search(pattern, raw_content, re.IGNORECASE | re.DOTALL)
        if match:
            raw_list = match.group(1)
            raw_list = raw_list.replace("\n-", ",").replace("\n", " ")
            raw_list = re.sub(r"\s{2,}", " ", raw_list).strip(" ,")
            if raw_list:
                return raw_list
    return None


def extract_services(raw_content: str, body: str) -> str | None:
    voice_usage_tags = extract_bracket_list(
        raw_content, "Voice usage", ["Pitch", "Mother tongues", "\n##"]
    )
    services = list(dict.fromkeys(voice_usage_tags))  # dedupe, preserve order

    lower_body = body.lower()
    for keyword, label in SERVICE_KEYWORDS.items():
        if keyword in lower_body and label not in services:
            services.append(label)

    return ", ".join(services) if services else None


def parse_profile(profile_link: str, raw_content: str) -> dict:
    record = {field: None for field in TEMPLATE_FIELDS}
    record["Source"] = "Bodalgo"
    record["Profile_Link"] = profile_link

    if not raw_content or is_gone_page(raw_content):
        return record

    body = extract_body(raw_content)

    full_name = extract_full_name(raw_content)
    record["Full_Name"] = full_name
    record["First_Name"] = full_name.split()[0] if full_name else None

    mother_tongues = extract_bracket_list(
        raw_content, "Mother tongues", ["Dialects", "Foreign languages", "\n##"]
    )
    record["Source_Language"] = mother_tongues[0] if mother_tongues else None
    record["Secondary_Languages"] = extract_foreign_languages(raw_content)

    record["Services"] = extract_services(raw_content, body)
    record["Years_of_Exp"] = extract_years_of_exp(body)
    record["Vendor_Experience"] = extract_vendor_experience(body)

    return record


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        profiles = json.load(f)

    print(f"Loaded {len(profiles)} profiles from {INPUT_PATH}")

    results = []
    for i, profile in enumerate(profiles, start=1):
        profile_link = profile.get("profile_link")
        raw_content = profile.get("raw_content")
        try:
            record = parse_profile(profile_link, raw_content)
            results.append(record)
            print(f"[{i}/{len(profiles)}] Parsed: {profile_link} -> Full_Name={record['Full_Name']!r}")
        except Exception as e:
            print(f"[{i}/{len(profiles)}] FAILED to parse {profile_link}: {e}", file=sys.stderr)
            continue

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(results)} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
