"""ATAA Directory parser."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from parsers._context_utils import strip_page_boilerplate
from parsers.base import BaseParser


class AtaaParser(BaseParser):
    """Parser for ATAA directory profile pages."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        raw_content = raw_data.get("raw_content", "") if isinstance(raw_data, dict) else str(raw_data)
        record: Dict[str, Any] = {
            "Source": "ATAA",
            "Profile_Link": profile_link,
        }

        if not raw_content:
            return record

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

        return record

    def build_context(self, profile_link: str, raw_data: Any) -> Optional[str]:
        raw_content = raw_data.get("raw_content", "") if isinstance(raw_data, dict) else str(raw_data)
        return strip_page_boilerplate(raw_content)

    @staticmethod
    def _extract_full_name(raw_content: str) -> Optional[str]:
        for line in raw_content.splitlines():
            line = line.strip()
            if line.startswith("# ") and "ataa" not in line.lower():
                return line[2:].strip()
        return None

    @staticmethod
    def _extract_email(raw_content: str) -> Optional[str]:
        match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", raw_content)
        return match.group(0) if match else None

    @staticmethod
    def _extract_phone(raw_content: str) -> Optional[str]:
        match = re.search(r"[\+]\d{1,3}[\s\d-]{7,}", raw_content)
        return match.group(0) if match else None
