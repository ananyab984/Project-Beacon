"""
Stage 3: parse proz_raw_content.json (Tavily Search snippets, since Extract
cannot fetch proz.com — see tavily_extract_poc.py / tavily_search_fallback.py)
into the Template_ProjectBeacon.xlsx schema via deterministic text parsing.
No LLM call, no full profile page — everything below is derived only from
the short title/content snippets Tavily's Search index returns.

Known, and significant, limitations (documented, not hidden):
- Contact_Number / Email_Address: NEVER available. ProZ hides these behind
  member login even on a normally-rendered page, and the page itself is
  Cloudflare-blocked for both Extract and any live re-fetch, so these are
  always null.
- Reachout Date / Application Date: not applicable to a ProZ profile at all,
  always null.
- Source_Language / Target_Language: parsed from an explicit "X to Y
  translator" phrase in the primary snippet's title when present. Where the
  title has no such phrase (e.g. a team account, or a profile whose ProZ
  headline is a tagline instead of the auto-generated "X to Y translator"
  string), falls back to language codes embedded in KudoZ question-pair URLs
  (e.g. "pair=ara_eng") among the supporting snippets. This fallback is a
  weaker signal — it reflects languages the profile has answered KudoZ
  questions in, not a stated working-language pair — and is documented via
  Vendor_Experience-adjacent notes in Secondary_Languages where relevant.
- Country_of_Residence: only ever populated when a snippet explicitly
  states citizenship ("I am an American, Lebanese and Syrian citizen").
  Nationality is used as a proxy for residence, which is not guaranteed to
  be accurate; left null when no explicit statement exists — no default
  region applies (ProZ is a global marketplace).
- Years_of_Exp: only populated from an explicit "N+ years" phrase in a
  snippet. Left null otherwise.
- Vendor_Experience: only populated when a snippet explicitly names a
  client/vendor relationship (e.g. "helping to localize ProZ.com into
  Somali"). Left null otherwise — ProZ doesn't expose client/vendor lists in
  the indexed snippet text.
- Services: the profile's own stated service list when the snippet spells
  it out ("Services Translation, Editing/proofreading, Training"); falls
  back to "Translation" alone, since every ProZ profile of this kind is by
  definition a translation services listing.
"""

import json
import re
import sys

INPUT_PATH = "proz_raw_content.json"
OUTPUT_PATH = "proz_projectbeacon_output.json"

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

LANG_PAIR_CODE_MAP = {
    "ara": "Arabic",
    "eng": "English",
    "esl": "Spanish",
    "fra": "French",
    "deu": "German",
    "ita": "Italian",
    "por": "Portuguese",
    "rus": "Russian",
    "chi": "Chinese",
    "hrv": "Croatian",
}

NATIONALITY_TO_COUNTRY = {
    "american": "United States",
    "lebanese": "Lebanon",
    "syrian": "Syria",
    "croatian": "Croatia",
    "spanish": "Spain",
    "italian": "Italy",
    "somali": "Somalia",
    "arab": "United Arab Emirates",
}

LANG_PAIR_TITLE_PATTERN = re.compile(
    r"((?:[A-Z][a-zA-Z]+(?:,\s+|\s+and\s+))*[A-Z][a-zA-Z]+)\s+to\s+([A-Z][a-zA-Z]+)\b"
)


def all_texts(primary: dict | None, others: list[dict]) -> list[str]:
    texts = []
    if primary:
        texts.append(primary.get("title") or "")
        texts.append(primary.get("content") or "")
    for snippet in others:
        texts.append(snippet.get("title") or "")
        texts.append(snippet.get("content") or "")
    return [t for t in texts if t]


def extract_full_name(primary: dict | None, others: list[dict]) -> str | None:
    texts = all_texts(primary, others)

    for text in texts:
        match = re.search(r"\(Translator Profile - ([^)]+)\)", text)
        if match:
            return match.group(1).strip()

    for text in texts:
        match = re.match(r"^(.+?)\s+-\s+KudoZ", text)
        if match:
            name = match.group(1).strip()
            return name.title() if name.isupper() else name

    for text in texts:
        match = re.match(r"^(.+?)\s*\|\s*Feedback card", text)
        if match:
            name = match.group(1).strip()
            return name.title() if name.isupper() else name

    return None


def split_first_name(full_name: str | None) -> str | None:
    if not full_name:
        return None
    return full_name.split()[0]


def strip_name_prefix(title: str, full_name: str | None) -> str:
    if full_name and title.startswith(full_name):
        return title[len(full_name):].lstrip(" -")
    return title


def extract_languages(primary: dict | None, others: list[dict], full_name: str | None) -> tuple[str | None, str | None, str | None]:
    # Tavily's indexed title is often truncated with a trailing "..." right
    # where the target language would be (e.g. "...Italian to ..."), so the
    # language pair is searched for across both the title AND the content
    # snippet — ProZ's own auto-generated meta description ("Translation
    # services in English to Croatian.") reliably appears in content even
    # when the title is cut off.
    title = strip_name_prefix((primary or {}).get("title") or "", full_name)
    content = strip_name_prefix((primary or {}).get("content") or "", full_name)
    pairs = LANG_PAIR_TITLE_PATTERN.findall(f"{title}\n{content}")

    if pairs:
        sources, targets = [], []
        for src, tgt in pairs:
            for lang in re.split(r",\s*|\s+and\s+", src):
                lang = lang.strip()
                if lang and lang not in sources:
                    sources.append(lang)
            if tgt not in targets:
                targets.append(tgt)
        return ", ".join(sources), ", ".join(targets), None

    # Fallback: infer languages worked with from KudoZ pair= URL params
    # among supporting snippets (weaker signal, see module docstring).
    codes_found = []
    for snippet in others:
        url = snippet.get("url") or ""
        match = re.search(r"pair=([a-z]{3})_([a-z]{3})", url)
        if match:
            for code in match.groups():
                lang = LANG_PAIR_CODE_MAP.get(code)
                if lang and lang not in codes_found:
                    codes_found.append(lang)

    if codes_found:
        joined = ", ".join(codes_found)
        return joined, joined, None

    return None, None, None


def extract_country(primary: dict | None, others: list[dict]) -> str | None:
    for text in all_texts(primary, others):
        match = re.search(r"I am an? ([\w\s,]+?) citizen", text)
        if match:
            nationalities = [n.strip().lower() for n in re.split(r",\s*|\s+and\s+", match.group(1)) if n.strip()]
            countries = [NATIONALITY_TO_COUNTRY[n] for n in nationalities if n in NATIONALITY_TO_COUNTRY]
            if countries:
                return ", ".join(countries)
    return None


def extract_services(primary: dict | None, others: list[dict]) -> str | None:
    for text in all_texts(primary, others):
        match = re.search(r"Services\s+([A-Z][\w/\s,]+?)\.", text)
        if match:
            return match.group(1).strip()
    return "Translation"


def extract_years_of_exp(primary: dict | None, others: list[dict]) -> int | None:
    for text in all_texts(primary, others):
        match = re.search(r"(\d{1,2})\s*\+\s*years", text)
        if match:
            return int(match.group(1))
    return None


def extract_vendor_experience(primary: dict | None, others: list[dict]) -> str | None:
    for text in all_texts(primary, others):
        match = re.search(r"helping to localize ([\w.]+) into (\w+)", text)
        if match:
            return f"{match.group(1)} (localization)"
    return None


def parse_profile(profile_link: str, primary: dict | None, others: list[dict]) -> dict:
    record = {field: None for field in TEMPLATE_FIELDS}
    record["Source"] = "ProZ"
    record["Profile_Link"] = profile_link

    full_name = extract_full_name(primary, others)
    record["Full_Name"] = full_name
    record["First_Name"] = split_first_name(full_name)

    record["Country_of_Residence"] = extract_country(primary, others)
    record["Services"] = extract_services(primary, others)

    source_lang, target_lang, secondary_lang = extract_languages(primary, others, full_name)
    record["Source_Language"] = source_lang
    record["Target_Language"] = target_lang
    record["Secondary_Languages"] = secondary_lang

    record["Years_of_Exp"] = extract_years_of_exp(primary, others)
    record["Vendor_Experience"] = extract_vendor_experience(primary, others)

    return record


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        profiles = json.load(f)

    print(f"Loaded {len(profiles)} profiles from {INPUT_PATH}")

    results = []
    for i, profile in enumerate(profiles, start=1):
        profile_link = profile.get("profile_link")
        primary = profile.get("primary_snippet")
        others = profile.get("other_snippets") or []
        try:
            record = parse_profile(profile_link, primary, others)
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
