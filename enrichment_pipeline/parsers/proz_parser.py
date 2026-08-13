"""ProZ snippet response parser."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from parsers.base import BaseParser

LANG_PAIR_CODE_MAP = {
    "ara": "Arabic", "eng": "English", "esl": "Spanish", "fra": "French",
    "deu": "German", "ita": "Italian", "por": "Portuguese", "rus": "Russian",
}

NATIONALITY_TO_COUNTRY = {
    "american": "United States", "lebanese": "Lebanon", "syrian": "Syria",
    "croatian": "Croatia", "spanish": "Spain", "italian": "Italy",
}

LANG_PAIR_TITLE_PATTERN = re.compile(
    r"((?:[A-Z][a-zA-Z]+(?:,\s+|\s+and\s+))*[A-Z][a-zA-Z]+)\s+to\s+([A-Z][a-zA-Z]+)\b"
)


class ProzParser(BaseParser):
    """Parser for ProZ search snippet responses."""

    def parse(self, profile_link: str, raw_data: Any) -> Dict[str, Any]:
        primary = raw_data.get("primary_snippet") if isinstance(raw_data, dict) else None
        others = raw_data.get("other_snippets", []) if isinstance(raw_data, dict) else []

        record: Dict[str, Any] = {
            "Source": "ProZ",
            "Profile_Link": profile_link,
        }

        full_name = self._extract_full_name(primary, others)
        if full_name:
            record["Full_Name"] = full_name
            record["First_Name"] = full_name.split()[0]

        country = self._extract_country(primary, others)
        if country:
            record["Country_of_Residence"] = country

        services = self._extract_services(primary, others)
        if services:
            record["Services"] = services

        src_lang, tgt_lang, sec_lang = self._extract_languages(primary, others, full_name)
        if src_lang:
            record["Source_Language"] = src_lang
        if tgt_lang:
            record["Target_Language"] = tgt_lang
        if sec_lang:
            record["Secondary_Languages"] = sec_lang

        years = self._extract_years_of_exp(primary, others)
        if years is not None:
            record["Years_of_Exp"] = years

        vendor_exp = self._extract_vendor_exp(primary, others)
        if vendor_exp:
            record["Vendor_Experience"] = vendor_exp

        return record

    @staticmethod
    def _all_texts(primary: Optional[dict], others: list) -> List[str]:
        texts = []
        if primary:
            texts.append(primary.get("title") or "")
            texts.append(primary.get("content") or "")
        for snippet in others:
            if isinstance(snippet, dict):
                texts.append(snippet.get("title") or "")
                texts.append(snippet.get("content") or "")
        return [t for t in texts if t]

    def _extract_full_name(self, primary: Optional[dict], others: list) -> Optional[str]:
        for text in self._all_texts(primary, others):
            match = re.search(r"\(Translator Profile - ([^)]+)\)", text)
            if match:
                return match.group(1).strip()
            match = re.match(r"^(.+?)\s+-\s+KudoZ", text)
            if match:
                return match.group(1).strip()
        return None

    def _extract_languages(self, primary: Optional[dict], others: list, full_name: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        title = (primary or {}).get("title") or ""
        content = (primary or {}).get("content") or ""
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
        return None, None, None

    def _extract_country(self, primary: Optional[dict], others: list) -> Optional[str]:
        for text in self._all_texts(primary, others):
            match = re.search(r"I am an? ([\w\s,]+?) citizen", text)
            if match:
                for nat, cty in NATIONALITY_TO_COUNTRY.items():
                    if nat in match.group(1).lower():
                        return cty
        return None

    def _extract_services(self, primary: Optional[dict], others: list) -> Optional[str]:
        for text in self._all_texts(primary, others):
            match = re.search(r"Services\s+([A-Z][\w/\s,]+?)\.", text)
            if match:
                return match.group(1).strip()
        return "Translation"

    def _extract_years_of_exp(self, primary: Optional[dict], others: list) -> Optional[int]:
        for text in self._all_texts(primary, others):
            match = re.search(r"(\d{1,2})\s*\+\s*years", text)
            if match:
                return int(match.group(1))
        return None

    def _extract_vendor_exp(self, primary: Optional[dict], others: list) -> Optional[str]:
        for text in self._all_texts(primary, others):
            match = re.search(r"helping to localize ([\w.]+) into (\w+)", text)
            if match:
                return f"{match.group(1)} (localization)"
        return None
