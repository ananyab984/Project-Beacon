"""
Stage 3: parse ADA raw_content (from ada_raw_content.json) into the
Template_ProjectBeacon.xlsx schema using deterministic text parsing —
no LLM call. ADA directory pages (audiodescription.co.uk, Wix-hosted) follow
a consistent layout, so regex / string-section extraction covers it;
unavailable fields are left null rather than guessed.

Page layout per profile (after boilerplate nav):
    # {Full Name}
    {UK region tags / "International"}
    [{email}](mailto:{email})
    {free-text bio}
    ## Further Info:
    {phone number, or a zero-width space if absent}
    [{website text}]({website url})   (sometimes an empty link, sometimes absent)
    {comma-separated service/genre tags}
    ###### Audio Description Association UK 2023 ...   (footer, may be absent)
    bottom of page

Known limitations (documented, not hidden):
- Reachout Date, Application Date: never exposed by ADA profile pages, so
  always null.
- Country_of_Residence: ADA is a UK association and nearly every profile only
  lists UK regions / "International" with no country stated. Defaults to
  "United Kingdom" unless the phone country code or an explicit "based in
  <city>, <country>" phrase in the bio says otherwise. This is a heuristic,
  not a verified fact, for profiles that don't explicitly state a country.
- Source_Language / Target_Language: audio description is intra-language
  (describing visuals in the same language as the audience), so these
  default to "English" unless the bio explicitly states another working
  language (e.g. Alicja Tokarska mentions scripting in Polish too).
- Years_of_Exp: extracted via best-effort phrase matching over free-text
  bios ("over N years", "since YYYY", word numbers like "thirty years").
  Left null when no such phrase is present, rather than guessed.
- Vendor_Experience: extracted from explicit client/company mentions
  ("clients such as X, Y", "companies including X, Y") or from an
  organisation the profile names as their own ("Director of X", "CEO of
  X", "runs X"). Falls back to "Freelance" when the bio self-describes as
  freelance and no organisation/clients are named. Left null otherwise.
- Services: the profile's own service/genre tag list (from "Further Info"),
  prefixed with "Audio Description" since every ADA directory member is by
  definition an audio describer.
"""

import json
import re
import sys

INPUT_PATH = "ada_raw_content.json"
OUTPUT_PATH = "ada_projectbeacon_output.json"

REFERENCE_YEAR = 2026  # today's date is 2026-07-28; used to convert "since YYYY" phrasing

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

FURTHER_INFO_MARKER = "## Further Info:"
BODY_END_MARKERS = [
    "###### Audio Description Association",
    "bottom of page",
]

ZERO_WIDTH_SPACE = "​"

WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60,
}

YEARS_OF_EXP_PATTERNS = [
    r"over\s+(\d{1,2})\s*\+?\s*years?",
    r"with\s+(\d{1,2})\s*\+?\s*years?",
    r"(\d{1,2})\s*\+?\s*years?\s*(?:of\s+)?experience",
]

COUNTRY_NAMES = [
    "Canada", "Brazil", "United States", "USA", "Australia", "Ireland",
    "France", "Germany", "Poland", "Spain", "Italy", "Netherlands",
    "New Zealand", "South Africa",
]

LANGUAGE_NAMES = [
    "Polish", "French", "German", "Spanish", "Italian", "Portuguese",
    "Welsh", "Arabic", "Mandarin", "Chinese", "Dutch", "Japanese", "Russian",
]


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
        if line.startswith("# "):
            name = line[2:].strip()
            return name.title() if name.isupper() else name
    return None


def split_first_name(full_name: str) -> str | None:
    if not full_name:
        return None
    if "&" in full_name:
        parts = [p.strip().split()[0] for p in full_name.split("&") if p.strip()]
        return " & ".join(parts)
    return full_name.split()[0]


def extract_email(raw_content: str) -> str | None:
    # Restrict to the profile header/bio (before "Further Info") so the
    # site-wide "General Enquiries" footer mailto isn't picked up for
    # profiles that don't list a personal email.
    idx = raw_content.find(FURTHER_INFO_MARKER)
    segment = raw_content[:idx] if idx != -1 else raw_content
    match = re.search(r"\[([^\]]+@[^\]]+)\]\(mailto:", segment)
    return match.group(1).strip() if match else None


def get_further_info_segment(raw_content: str) -> str:
    idx = raw_content.find(FURTHER_INFO_MARKER)
    if idx == -1:
        return ""
    segment = raw_content[idx + len(FURTHER_INFO_MARKER):]
    end = len(segment)
    for marker in BODY_END_MARKERS:
        pos = segment.find(marker)
        if pos != -1:
            end = min(end, pos)
    return segment[:end]


def further_info_lines(raw_content: str) -> list[str]:
    segment = get_further_info_segment(raw_content)
    lines = []
    for line in segment.splitlines():
        stripped = line.strip().replace(ZERO_WIDTH_SPACE, "")
        if stripped:
            lines.append(stripped)
    return lines


def extract_phone(raw_content: str) -> str | None:
    for line in further_info_lines(raw_content):
        if re.fullmatch(r"[+\d][\d\s]{5,}", line):
            return line
    return None


def extract_services(raw_content: str) -> str | None:
    tags_line = None
    for line in further_info_lines(raw_content):
        if re.fullmatch(r"[+\d][\d\s]{5,}", line):
            continue
        if line.startswith("["):
            continue
        if "," in line or line.isalpha():
            tags_line = line
    services = ["Audio Description"]
    if tags_line:
        tags = [t.strip() for t in tags_line.split(",") if t.strip()]
        for tag in tags:
            if tag not in services:
                services.append(tag)
    return ", ".join(services)


def extract_years_of_exp(body: str) -> int | None:
    # Priority: explicit numeric phrasing, then AD-specific "since" phrasing,
    # then any generic "since YYYY", then word-numbers last — word-numbers
    # ("three years at BBC radio") tend to attach to unrelated career
    # anecdotes rather than total AD experience, so they're the weakest signal.
    for pattern in YEARS_OF_EXP_PATTERNS:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            return int(match.group(1))

    ad_specific_since_patterns = [
        r"qualifying as .{0,60}? in (\d{4})",
        r"career into the field of Audio Description in (\d{4})",
        r"[Aa]udio [Dd]escrib(?:ing|er) since (\d{4})",
    ]
    for pattern in ad_specific_since_patterns:
        match = re.search(pattern, body)
        if match:
            return REFERENCE_YEAR - int(match.group(1))

    match = re.search(r"since (\d{4})", body)
    if match:
        return REFERENCE_YEAR - int(match.group(1))

    word_pattern = r"\b(" + "|".join(WORD_NUMBERS) + r")\b[\s'’]*\s*years?"
    match = re.search(word_pattern, body, re.IGNORECASE)
    if match:
        return WORD_NUMBERS[match.group(1).lower()]

    return None


def extract_vendor_experience(body: str) -> str | None:
    client_patterns = [
        r"clients?\s+(?:include|consist of|such as)[:\s]*(.+?)(?:\.|\n)",
        r"companies?\s+(?:including|include)[:\s]*(.+?)(?:\.|\n)",
    ]
    for pattern in client_patterns:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            raw_list = re.sub(r"\s{2,}", " ", match.group(1)).strip(" ,")
            if raw_list:
                return raw_list

    org_patterns = [
        r"[Dd]irector of ([A-Z][\w'’\s]+?)\.",
        r"CEO of ([A-Z][\w\s]+?)[,.]",
        r"runs? ([A-Z][\w\s]+?),\s*a\s",
    ]
    for pattern in org_patterns:
        match = re.search(pattern, body)
        if match:
            return match.group(1).strip()

    if re.search(r"\bfreelance\b", body, re.IGNORECASE):
        return "Freelance"

    return None


def extract_country(raw_content: str, phone: str | None) -> str:
    match = re.search(r"based in [\w\s]+?,\s*([A-Z][\w\s]+?)[\.\n]", raw_content)
    if match:
        candidate = match.group(1).strip()
        for country in COUNTRY_NAMES:
            if country.lower() == candidate.lower():
                return country

    if phone:
        digits = phone.replace(" ", "")
        if digits.startswith("+55"):
            return "Brazil"
        if digits.startswith("07") or digits.startswith("01") or digits.startswith("+44"):
            return "United Kingdom"

    return "United Kingdom"


def extract_languages(body: str) -> tuple[str, str, str | None]:
    found = []
    for lang in LANGUAGE_NAMES:
        if re.search(rf"\b{lang}\b", body):
            found.append(lang)

    if not found:
        return "English", "English", None

    languages = ", ".join(["English"] + found)
    return languages, languages, ", ".join(found)


def parse_profile(profile_link: str, raw_content: str) -> dict:
    record = {field: None for field in TEMPLATE_FIELDS}
    record["Source"] = "ADA"
    record["Profile_Link"] = profile_link

    if not raw_content:
        return record

    body = extract_body(raw_content)

    full_name = extract_full_name(raw_content)
    record["Full_Name"] = full_name
    record["First_Name"] = split_first_name(full_name)

    record["Email_Address"] = extract_email(raw_content)
    phone = extract_phone(raw_content)
    record["Contact_Number"] = phone

    record["Services"] = extract_services(raw_content)
    record["Years_of_Exp"] = extract_years_of_exp(body)
    record["Vendor_Experience"] = extract_vendor_experience(body)
    record["Country_of_Residence"] = extract_country(raw_content, phone)

    source_lang, target_lang, secondary_lang = extract_languages(body)
    record["Source_Language"] = source_lang
    record["Target_Language"] = target_lang
    record["Secondary_Languages"] = secondary_lang

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
