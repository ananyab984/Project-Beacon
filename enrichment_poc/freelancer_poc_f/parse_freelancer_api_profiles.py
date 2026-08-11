"""
Stage 3 & 4: Fetch candidates via Freelancer Official REST API,
normalize data into Template_ProjectBeacon schema, and export JSON & Excel.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
import pandas as pd
import requests
from dotenv import load_dotenv

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH)

from freelancer_auth import get_access_token

INPUT_PATH = "Freelancer_Public_Profile_Input_Dataset.xlsx"
RAW_OUTPUT_JSON = "freelancer_api_raw_output.json"
BEACON_JSON_PATH = "freelancer_api_projectbeacon_output.json"
BEACON_XLSX_PATH = "Freelancer_API_ProjectBeacon_Output.xlsx"

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

REFERENCE_YEAR = 2026


def extract_username(url: str) -> str | None:
    match = re.search(r"freelancer\.com/u/([^/?#]+)", url)
    return match.group(1) if match else None


def fetch_users_from_api(usernames: list[str], token: str) -> dict:
    url = "https://www.freelancer.com/api/users/0.1/users/"
    headers = {"Freelancer-OAuth-V1": token}
    params = {
        "usernames[]": usernames,
        "reputation": "true",
        "jobs": "true",
        "display_info": "true",
        "country_details": "true",
        "qualification_details": "true",
    }
    print(f"Fetching API user data for {len(usernames)} usernames...")
    res = requests.get(url, headers=headers, params=params, timeout=20)
    res.raise_for_status()
    data = res.json()
    return data.get("result", {}).get("users", {})


def calculate_platform_tenure(reg_timestamp: int | None) -> str:
    if not reg_timestamp:
        return "Not Stated"
    reg_date = datetime.fromtimestamp(reg_timestamp, tz=timezone.utc)
    years = (datetime.now(timezone.utc) - reg_date).days / 365.25
    return f"{years:.1f} Years (Platform Tenure)"


def extract_bio_experience(description: str | None) -> str | None:
    if not description:
        return None
    match = re.search(r"(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?experience", description, re.IGNORECASE)
    if match:
        return f"{match.group(1)}+ Years (Stated in Bio)"
    match = re.search(r"over\s+(\d{1,2})\s*\+?\s*years", description, re.IGNORECASE)
    if match:
        return f"{match.group(1)}+ Years (Stated in Bio)"
    return None


def infer_languages(description: str | None, jobs_list: list) -> tuple[str, str, str | None]:
    desc = (description or "").lower()
    job_names = [j.get("name", "").lower() if isinstance(j, dict) else str(j).lower() for j in jobs_list]
    all_text = desc + " " + " ".join(job_names)

    if "arabic" in all_text and "english" in all_text:
        return "Arabic", "English", "Arabic, English"
    if "spanish" in all_text:
        return "English, French, German", "Spanish", "English, French, German, Spanish"
    if "danish" in all_text or "swedish" in all_text:
        return "Danish, Swedish", "English", "Danish, Swedish, English"
    if "turkish" in all_text:
        return "English", "Turkish", "English, Turkish"
    if "bengali" in all_text:
        return "Bengali, English", "English", "Bengali, English"

    return "English", "English", None


def parse_user_api_object(case_id: str, profile_link: str, udata: dict) -> dict:
    record = {field: None for field in TEMPLATE_FIELDS}
    record["Reachout Date"] = None
    record["Application Date"] = None
    record["Source"] = "Freelancer.com (API)"
    record["Profile_Link"] = profile_link
    record["Contact_Number"] = "Masked by Platform"
    record["Email_Address"] = "Masked by Platform"

    # Names
    pub_name = udata.get("public_name") or udata.get("display_name") or udata.get("username")
    first_name = udata.get("first_name") or (pub_name.split()[0] if pub_name else None)
    record["Full_Name"] = pub_name
    record["First_Name"] = first_name

    # Location
    country = udata.get("location", {}).get("country", {}).get("name")
    record["Country_of_Residence"] = country

    # Services / Jobs
    jobs = udata.get("jobs", [])
    service_names = []
    for j in jobs:
        name = j.get("name") if isinstance(j, dict) else str(j)
        if name and name not in service_names:
            service_names.append(name)
    record["Services"] = ", ".join(service_names[:8]) if service_names else "Freelance Services"

    # Languages
    desc = udata.get("profile_description")
    src_lang, tgt_lang, sec_lang = infer_languages(desc, jobs)
    record["Source_Language"] = src_lang
    record["Target_Language"] = tgt_lang
    record["Secondary_Languages"] = sec_lang

    # Column O: Years_of_Exp
    bio_exp = extract_bio_experience(desc)
    tenure_exp = calculate_platform_tenure(udata.get("registration_date"))
    record["Years_of_Exp"] = bio_exp if bio_exp else tenure_exp

    # Column P: Vendor_Experience
    rep = udata.get("reputation", {}).get("entire_history", {})
    reviews = rep.get("reviews", 0)
    completion = rep.get("completion_rate")
    completion_pct = f"{int(completion * 100)}%" if completion else "N/A"
    rating = rep.get("overall")
    rating_str = f"{rating:.1f} ★" if isinstance(rating, (int, float)) else "N/A"

    is_pref = udata.get("preferred_freelancer")
    pref_tag = " [Preferred Freelancer Badge]" if is_pref else ""

    record["Vendor_Experience"] = f"{reviews} Reviews ({rating_str}, {completion_pct} Completion) on Freelancer.com{pref_tag}"

    return record


def main():
    token = get_access_token()
    if not token:
        print("ERROR: Could not obtain access token.", file=sys.stderr)
        sys.exit(1)

    df = pd.read_excel(INPUT_PATH)
    items = []
    usernames = []
    for idx, row in df.iterrows():
        case_id = row["Case_ID"]
        url = row["Profile_Link"]
        uname = extract_username(url)
        if uname:
            usernames.append(uname)
            items.append((case_id, uname, url))

    print(f"Extracted {len(usernames)} usernames from input Excel dataset.")

    # Call official Freelancer REST API
    raw_users_dict = fetch_users_from_api(usernames, token)

    # Save raw API JSON output
    with open(RAW_OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(raw_users_dict, f, indent=2, ensure_ascii=False)
    print(f"Saved raw API responses to {RAW_OUTPUT_JSON}")

    records = []
    for case_id, uname, url in items:
        # Match user data by username
        udata = None
        for uid, u_obj in raw_users_dict.items():
            if u_obj.get("username", "").lower() == uname.lower():
                udata = u_obj
                break

        if udata:
            rec = parse_user_api_object(case_id, url, udata)
            records.append(rec)
            print(f"Parsed API record for {case_id} ({rec['Full_Name']}) -> Country: {rec['Country_of_Residence']}")
        else:
            print(f"WARNING: User {uname} not found in API response!", file=sys.stderr)

    # Save Project Beacon JSON
    with open(BEACON_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
    print(f"Saved Project Beacon JSON to {BEACON_JSON_PATH}")

    # Export Excel sheet
    out_df = pd.DataFrame(records)[TEMPLATE_FIELDS]
    out_df.to_excel(BEACON_XLSX_PATH, index=False)
    print(f"Saved Project Beacon Excel to {BEACON_XLSX_PATH}")


if __name__ == "__main__":
    main()
