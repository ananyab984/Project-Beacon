"""Generic parser for custom or unmapped sources."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from parsers.base import BaseParser


class GenericParser(BaseParser):
    """Generic fallback parser using regex heuristics over scraped web content."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        raw_content = raw_data.get("raw_content", "") if isinstance(raw_data, dict) else str(raw_data)
        record: Dict[str, Any] = {
            "Profile_Link": profile_link,
        }

        if not raw_content:
            return record

        email = self._extract_email(raw_content)
        if email:
            record["Email_Address"] = email

        phone = self._extract_phone(raw_content)
        if phone:
            record["Contact_Number"] = phone

        years = self._extract_years_of_exp(raw_content)
        if years is not None:
            record["Years_of_Exp"] = years

        return record

    @staticmethod
    def _extract_email(raw_content: str) -> Optional[str]:
        match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", raw_content)
        return match.group(0) if match else None

    @staticmethod
    def _extract_phone(raw_content: str) -> Optional[str]:
        match = re.search(r"[\+]\d{1,3}[\s\d-]{7,}", raw_content)
        return match.group(0) if match else None

    @staticmethod
    def _extract_years_of_exp(raw_content: str) -> Optional[int]:
        match = re.search(r"(\d{1,2})\s*\+\s*years?\s*(?:of\s+)?experience", raw_content, re.IGNORECASE)
        if match:
            return int(match.group(1))
        return None
