"""Ada Directory HTML/Markdown parser."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from parsers.base import BaseParser

REFERENCE_YEAR = 2026

FURTHER_INFO_MARKER = "## Further Info:"
BODY_END_MARKERS = ["###### Audio Description Association", "bottom of page"]
ZERO_WIDTH_SPACE = "​"

WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
}

YEARS_OF_EXP_PATTERNS = [
    r"over\s+(\d{1,2})\s*\+?\s*years?",
    r"with\s+(\d{1,2})\s*\+?\s*years?",
    r"(\d{1,2})\s*\+?\s*years?\s*(?:of\s+)?experience",
]

COUNTRY_NAMES = [
    "Canada", "Brazil", "United States", "USA", "Australia", "Ireland",
    "France", "Germany", "Poland", "Spain", "Italy", "Netherlands",
    "New Zealand", "South Africa", "United Kingdom", "UK",
]


class AdaParser(BaseParser):
    """Parser for Ada audio description directory profiles."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        raw_content = raw_data.get("raw_content", "") if isinstance(raw_data, dict) else str(raw_data)
        record: Dict[str, Any] = {
            "Source": "Ada",
            "Profile_Link": profile_link,
        }

        if not raw_content:
            return record

        body = self._extract_body(raw_content)

        full_name = self._extract_full_name(raw_content)
        if full_name:
            record["Full_Name"] = full_name
            record["First_Name"] = full_name.split()[0]

        email = self._extract_email(raw_content)
        if email:
            record["Email_Address"] = email

        phone = self._extract_phone(raw_content)
        if phone:
            record["Contact_Number"] = phone

        services = self._extract_services(raw_content)
        if services:
            record["Services"] = services

        years = self._extract_years_of_exp(body)
        if years is not None:
            record["Years_of_Exp"] = years

        vendor_exp = self._extract_vendor_exp(body)
        if vendor_exp:
            record["Vendor_Experience"] = vendor_exp

        record["Country_of_Residence"] = self._extract_country(raw_content, phone)

        source_lang, target_lang, secondary_lang = self._extract_languages(body)
        if source_lang:
            record["Source_Language"] = source_lang
        if target_lang:
            record["Target_Language"] = target_lang
        if secondary_lang:
            record["Secondary_Languages"] = secondary_lang

        return record

    @staticmethod
    def _extract_body(raw_content: str) -> str:
        end = len(raw_content)
        for marker in BODY_END_MARKERS:
            pos = raw_content.find(marker)
            if pos != -1:
                end = min(end, pos)
        return raw_content[:end]

    @staticmethod
    def _extract_full_name(raw_content: str) -> Optional[str]:
        for line in raw_content.splitlines():
            line = line.strip()
            if line.startswith("# "):
                name = line[2:].strip()
                return name.title() if name.isupper() else name
        return None

    @staticmethod
    def _extract_email(raw_content: str) -> Optional[str]:
        idx = raw_content.find(FURTHER_INFO_MARKER)
        segment = raw_content[:idx] if idx != -1 else raw_content
        match = re.search(r"\[([^\]]+@[^\]]+)\]\(mailto:", segment)
        return match.group(1).strip() if match else None

    @staticmethod
    def _further_info_lines(raw_content: str) -> List[str]:
        idx = raw_content.find(FURTHER_INFO_MARKER)
        if idx == -1:
            return []
        segment = raw_content[idx + len(FURTHER_INFO_MARKER):]
        end = len(segment)
        for marker in BODY_END_MARKERS:
            pos = segment.find(marker)
            if pos != -1:
                end = min(end, pos)
        lines = []
        for line in segment[:end].splitlines():
            stripped = line.strip().replace(ZERO_WIDTH_SPACE, "")
            if stripped:
                lines.append(stripped)
        return lines

    def _extract_phone(self, raw_content: str) -> Optional[str]:
        for line in self._further_info_lines(raw_content):
            if re.fullmatch(r"[+\d][\d\s]{5,}", line):
                return line
        return None

    def _extract_services(self, raw_content: str) -> Optional[str]:
        tags_line = None
        for line in self._further_info_lines(raw_content):
            if re.fullmatch(r"[+\d][\d\s]{5,}", line) or line.startswith("["):
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

    @staticmethod
    def _extract_years_of_exp(body: str) -> Optional[int]:
        for pattern in YEARS_OF_EXP_PATTERNS:
            match = re.search(pattern, body, re.IGNORECASE)
            if match:
                return int(match.group(1))
        match = re.search(r"since (\d{4})", body)
        if match:
            return REFERENCE_YEAR - int(match.group(1))
        return None

    @staticmethod
    def _extract_vendor_exp(body: str) -> Optional[str]:
        match = re.search(r"clients?\s+(?:include|consist of|such as)[:\s]*(.+?)(?:\.|\n)", body, re.IGNORECASE)
        if match:
            raw_list = re.sub(r"\s{2,}", " ", match.group(1)).strip(" ,")
            if raw_list:
                return raw_list
        if re.search(r"\bfreelance\b", body, re.IGNORECASE):
            return "Freelance"
        return None

    @staticmethod
    def _extract_country(raw_content: str, phone: Optional[str]) -> str:
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
        return "United Kingdom"

    @staticmethod
    def _extract_languages(body: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        found = []
        for lang in ["Polish", "French", "German", "Spanish", "Italian", "Portuguese", "Welsh"]:
            if re.search(rf"\b{lang}\b", body):
                found.append(lang)
        if not found:
            return "English", "English", None
        langs = ", ".join(["English"] + found)
        return langs, langs, ", ".join(found)
