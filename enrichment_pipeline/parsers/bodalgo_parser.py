"""Bodalgo response parser."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from parsers._context_utils import strip_page_boilerplate
from parsers.base import BaseParser

SERVICE_KEYWORDS = {
    "translation": "Translation",
    "translator": "Translation",
    "subtitling": "Subtitling",
    "closed caption": "CC",
    "audio description": "AD",
    "dubbing": "Dubbing",
}

YEARS_OF_EXP_PATTERNS = [
    r"over\s+(\d{1,2})\s*(?:\+\s*)?years?",
    r"more than\s+(\d{1,2})\s*years?",
    r"(\d{1,2})\s*\+\s*years? of experience",
    r"(\d{1,2})\s*years?\s*(?:of\s+)?experience",
]


class BodalgoParser(BaseParser):
    """Parser for Bodalgo voiceover & translation profile pages."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        raw_content = raw_data.get("raw_content", "") if isinstance(raw_data, dict) else str(raw_data)
        record: Dict[str, Any] = {
            "Source": "Bodalgo",
            "Profile_Link": profile_link,
        }

        if not raw_content or "deleted permanently" in raw_content:
            return record

        body = self._extract_body(raw_content)

        full_name = self._extract_full_name(raw_content)
        if full_name:
            record["Full_Name"] = full_name
            record["First_Name"] = full_name.split()[0]

        mother_tongues = self._extract_bracket_list(raw_content, "Mother tongues", ["Dialects", "Foreign languages", "\n##"])
        if mother_tongues:
            record["Source_Language"] = mother_tongues[0]

        sec_langs = self._extract_foreign_languages(raw_content)
        if sec_langs:
            record["Secondary_Languages"] = sec_langs

        services = self._extract_services(raw_content, body)
        if services:
            record["Services"] = services

        years = self._extract_years_of_exp(body)
        if years is not None:
            record["Years_of_Exp"] = years

        vendor_exp = self._extract_vendor_exp(body)
        if vendor_exp:
            record["Vendor_Experience"] = vendor_exp

        return record

    def build_context(self, profile_link: str, raw_data: Any) -> Optional[str]:
        raw_content = raw_data.get("raw_content", "") if isinstance(raw_data, dict) else str(raw_data)
        return strip_page_boilerplate(raw_content, cutoff_markers=["You are about to flag this profile"])

    @staticmethod
    def _extract_body(raw_content: str) -> str:
        pos = raw_content.find("You are about to flag this profile")
        return raw_content[:pos] if pos != -1 else raw_content

    @staticmethod
    def _extract_full_name(raw_content: str) -> Optional[str]:
        for line in raw_content.splitlines():
            line = line.strip()
            if line.startswith("# ") and "gone" not in line.lower():
                return line[2:].strip()
        return None

    @staticmethod
    def _extract_bracket_list(raw_content: str, label: str, stop_labels: list) -> List[str]:
        idx = raw_content.find(label)
        if idx == -1:
            return []
        segment = raw_content[idx + len(label):]
        stop_idx = len(segment)
        for stop_label in stop_labels:
            pos = segment.find(stop_label)
            if pos != -1:
                stop_idx = min(stop_idx, pos)
        return re.findall(r"\[([^\]]+)\]", segment[:stop_idx])

    @staticmethod
    def _extract_foreign_languages(raw_content: str) -> Optional[str]:
        match = re.search(r"Foreign languages\s+([A-Za-z][A-Za-z ,/]*?)(?:\n|##|$)", raw_content)
        return match.group(1).strip() if match else None

    def _extract_services(self, raw_content: str, body: str) -> Optional[str]:
        voice_tags = self._extract_bracket_list(raw_content, "Voice usage", ["Pitch", "Mother tongues", "\n##"])
        services = list(dict.fromkeys(voice_tags))
        lower_body = body.lower()
        for kw, label in SERVICE_KEYWORDS.items():
            if kw in lower_body and label not in services:
                services.append(label)
        return ", ".join(services) if services else None

    @staticmethod
    def _extract_years_of_exp(body: str) -> Optional[int]:
        for pattern in YEARS_OF_EXP_PATTERNS:
            match = re.search(pattern, body, re.IGNORECASE)
            if match:
                return int(match.group(1))
        return None

    @staticmethod
    def _extract_vendor_exp(body: str) -> Optional[str]:
        match = re.search(r"clients?\s+(?:include|consist of|such as)[:\s]*(.+?)(?:\n##|\n×|\Z)", body, re.IGNORECASE | re.DOTALL)
        if match:
            raw_list = match.group(1).replace("\n-", ",").replace("\n", " ")
            raw_list = re.sub(r"\s{2,}", " ", raw_list).strip(" ,")
            if raw_list:
                return raw_list
        return None
