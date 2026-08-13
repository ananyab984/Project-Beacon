"""LinkedIn Bright Data response parser with deep contact info & experience extraction."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from parsers.base import BaseParser


def _safe_get(data: Any, *keys: str) -> Any:
    curr = data
    for k in keys:
        if isinstance(curr, dict) and k in curr:
            curr = curr[k]
        elif isinstance(curr, list) and k.isdigit():
            idx = int(k)
            if 0 <= idx < len(curr):
                curr = curr[idx]
            else:
                return None
        else:
            return None
    return curr


def _stringify(val: Any) -> Optional[str]:
    if val is None or val == "":
        return None
    if isinstance(val, dict):
        return val.get("email") or val.get("phone") or val.get("name") or str(val)
    if isinstance(val, list) and len(val) > 0:
        first = val[0]
        if isinstance(first, dict):
            return first.get("email") or first.get("phone") or first.get("name") or str(first)
        return str(first)
    return str(val)


# BrightData's LinkedIn "Contact Info" popup is only reliably present in the
# scrape when the profile owner has made it public; its shape has varied
# across BrightData dataset versions ("contact_info" object, flat top-level
# fields, or a generic "contacts"/"contact" list of {type, value} entries).
# All of these are checked so the deterministic parser -- not the LLM
# fallback -- is what resolves contact info whenever BrightData actually has it.
_CONTACT_INFO_KEYS = ("contact_info", "contactInfo", "contacts", "contact")


def _contact_info_values(profile: dict, *field_names: str) -> List[str]:
    """Collect every plausible value for one or more field names out of every
    known shape of the LinkedIn contact-info section."""
    values: List[str] = []
    for key in _CONTACT_INFO_KEYS:
        section = profile.get(key)
        if section is None:
            continue
        if isinstance(section, dict):
            for name in field_names:
                v = section.get(name)
                if v:
                    values.append(_stringify(v) or "")
                # plural/list variant, e.g. contact_info.emails[0]
                v_list = section.get(name + "s")
                if isinstance(v_list, list):
                    values.extend(_stringify(x) or "" for x in v_list)
        elif isinstance(section, list):
            # generic [{type: "email", value: "..."}] / [{label, text}] shape
            for entry in section:
                if not isinstance(entry, dict):
                    continue
                kind = str(entry.get("type") or entry.get("label") or "").lower()
                if any(name in kind for name in field_names):
                    v = entry.get("value") or entry.get("text") or entry.get("data")
                    if v:
                        values.append(_stringify(v) or "")
    return [v for v in values if v]


def _extract_email(profile: dict) -> Optional[str]:
    """Deep search for email address in Bright Data LinkedIn payload."""
    candidates = [
        profile.get("public_email"),
        profile.get("email"),
        profile.get("work_email"),
        profile.get("personal_email"),
        profile.get("linkedin_email"),
        _safe_get(profile, "contact_info", "email"),
        _safe_get(profile, "contact_info", "emails", "0"),
        _safe_get(profile, "emails", "0"),
        *_contact_info_values(profile, "email"),
    ]
    for c in candidates:
        if c:
            s = _stringify(c)
            if s and "@" in s:
                match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', s)
                if match:
                    return match.group(0)

    # Fallback: Regex scan across every text field the About/Contact sections
    # could plausibly live under (BrightData has used all of these at times).
    text_blob = " ".join([
        str(profile.get("about") or ""),
        str(profile.get("summary") or ""),
        str(profile.get("summary_text") or ""),
        str(profile.get("bio") or ""),
        str(profile.get("description") or ""),
        str(profile.get("contact_info") or ""),
        str(profile.get("websites") or ""),
    ])
    match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text_blob)
    return match.group(0) if match else None


def _extract_phone(profile: dict) -> Optional[str]:
    """Deep search for phone number in Bright Data LinkedIn payload."""
    candidates = [
        profile.get("phone_number"),
        profile.get("phone"),
        profile.get("mobile_phone"),
        profile.get("telephone"),
        _safe_get(profile, "contact_info", "phone"),
        _safe_get(profile, "contact_info", "phones", "0"),
        _safe_get(profile, "phones", "0"),
        *_contact_info_values(profile, "phone", "mobile", "tel"),
    ]
    for c in candidates:
        if c:
            s = _stringify(c)
            if s:
                return s
    return None


# Every text field an "About"-equivalent section has appeared under across
# BrightData's LinkedIn dataset revisions -- kept as one list so every
# deterministic (non-LLM) text-mining step below stays in sync.
_ABOUT_FIELD_NAMES = ("about", "summary", "summary_text", "bio", "description", "headline")


def _about_text_blob(profile: dict) -> str:
    return " ".join(str(profile.get(f) or "") for f in _ABOUT_FIELD_NAMES)


def _extract_years_of_experience(profile: dict) -> Optional[int]:
    """Extract years of experience from explicit fields, About section, or Experience list."""
    if profile.get("years_of_experience"):
        try:
            return int(profile["years_of_experience"])
        except (ValueError, TypeError):
            pass

    # Regex search in the About/Summary/Bio text (e.g. "10+ years of
    # experience", "8 years exp", "over 12 years").
    text_blob = _about_text_blob(profile)
    match = re.search(
        r'(?:over\s+)?(\d+)\+?\s*years?\s+(?:of\s+)?(?:experience|exp)',
        text_blob, re.IGNORECASE,
    )
    if match:
        try:
            return int(match.group(1))
        except (ValueError, TypeError):
            pass

    # Fallback: Count entries in experience array
    exp_list = profile.get("experience") or profile.get("positions") or []
    if isinstance(exp_list, list) and len(exp_list) > 0:
        return len(exp_list) * 2  # Estimate ~2 yrs per role

    return None


def _extract_vendor_experience(profile: dict) -> Optional[str]:
    """Extract company/vendor experience portfolio."""
    companies = []
    curr = profile.get("current_company")
    if isinstance(curr, dict):
        name = curr.get("name")
        if name:
            companies.append(name)
    elif curr:
        companies.append(str(curr))

    exp_list = profile.get("experience") or profile.get("positions") or []
    if isinstance(exp_list, list):
        for item in exp_list:
            if isinstance(item, dict):
                cname = item.get("company") or item.get("company_name")
                if cname and str(cname) not in companies:
                    companies.append(str(cname))

    if companies:
        return ", ".join(companies[:4])
    return profile.get("company") or None


class LinkedInParser(BaseParser):
    """Parser for Bright Data LinkedIn JSON responses with deep contact & experience extraction."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        profile = self._unwrap(raw_data)
        if not profile or not isinstance(profile, dict):
            return {"Source": "LinkedIn", "Profile_Link": profile_link}

        result: Dict[str, Any] = {
            "Source": "LinkedIn",
            "Profile_Link": profile_link,
        }

        # Name & Location
        full_name = profile.get("name") or profile.get("full_name")
        if full_name:
            result["Full_Name"] = str(full_name)
            result["First_Name"] = str(full_name).split(" ")[0]

        country = profile.get("country") or profile.get("location") or profile.get("country_code")
        if country:
            result["Country_of_Residence"] = str(country)

        # Contact Info (Email & Phone)
        email = _extract_email(profile)
        if email:
            result["Email_Address"] = email

        phone = _extract_phone(profile)
        if phone:
            result["Contact_Number"] = phone

        # Experience & Companies
        yoe = _extract_years_of_experience(profile)
        if yoe is not None:
            result["Years_of_Exp"] = yoe

        vendors = _extract_vendor_experience(profile)
        if vendors:
            result["Vendor_Experience"] = vendors

        # Skills & Languages
        skills = profile.get("skills")
        if isinstance(skills, list):
            names = [s.get("name") if isinstance(s, dict) else str(s) for s in skills if s]
            result["Services"] = ", ".join([n for n in names if n])
        elif skills:
            result["Services"] = str(skills)

        return result

    @staticmethod
    def _unwrap(raw: Any) -> Dict[str, Any]:
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], dict):
            return raw[0]
        return {}
