"""LinkedIn Bright Data response parser."""

from __future__ import annotations

import json
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


def _join_skills(val: Any) -> Optional[str]:
    if not isinstance(val, list):
        return str(val) if val else None
    names = []
    for item in val:
        if isinstance(item, dict):
            names.append(item.get("name") or item.get("title") or "")
        elif item:
            names.append(str(item))
    res = ", ".join(n for n in names if n)
    return res if res else None


def _join_titled(val: Any) -> Optional[str]:
    if not isinstance(val, list):
        return str(val) if val else None
    out = []
    for item in val:
        if isinstance(item, dict):
            title = item.get("title") or item.get("name") or ""
            subtitle = item.get("subtitle")
            out.append(f"{title} ({subtitle})" if subtitle else title)
        elif item:
            out.append(str(item))
    res = "; ".join(x for x in out if x)
    return res if res else None


def _stringify(val: Any) -> Optional[str]:
    if val is None or val == "":
        return None
    return str(val)


# FIELD_MAP: Output canonical field -> list of candidate source paths in Bright Data JSON
FIELD_MAP: Dict[str, Tuple[List[Tuple[str, ...]], Callable[[Any], Any]]] = {
    "Full_Name": ([("name",), ("full_name",)], _stringify),
    "First_Name": ([("first_name",)], _stringify),
    "Country_of_Residence": ([("country",), ("country_code",), ("location",)], _stringify),
    "Email_Address": ([("public_email",), ("email",), ("work_email",)], _stringify),
    "Contact_Number": ([("phone_number",), ("phone",)], _stringify),
    "Services": ([("skills",)], _join_skills),
    "Source_Language": ([("languages",)], _join_titled),
    "Secondary_Languages": ([("languages",)], _join_titled),
    "Vendor_Experience": ([("current_company", "name"), ("company",)], _stringify),
}


class LinkedInParser(BaseParser):
    """Parser for Bright Data LinkedIn JSON responses."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        profile = self._unwrap(raw_data)
        if not profile or not isinstance(profile, dict):
            return {"Source": "LinkedIn", "Profile_Link": profile_link}

        result: Dict[str, Any] = {
            "Source": "LinkedIn",
            "Profile_Link": profile_link,
        }

        for canonical_field, (paths, transform) in FIELD_MAP.items():
            val = self._first_present(profile, paths)
            if val is not None:
                transformed = transform(val)
                if transformed is not None:
                    result[canonical_field] = transformed

        return result

    @staticmethod
    def _unwrap(raw: Any) -> Dict[str, Any]:
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], dict):
            return raw[0]
        return {}

    @staticmethod
    def _first_present(profile: dict, paths: List[Tuple[str, ...]]) -> Any:
        for path in paths:
            val = _safe_get(profile, *path)
            if val not in (None, "", [], {}):
                return val
        return None
