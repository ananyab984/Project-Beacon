from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from logger import get_logger

log = get_logger(__name__)


def _clean(value: Any) -> str | None:
    """Trim strings; treat empty / 'null' / 'n/a' / '[Missing Input]' as missing."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"null", "none", "n/a", "na", "-", "[missing input]", "missing"}:
        return None
    return s


def _split_list(value: Any) -> list[str]:
    s = _clean(value)
    if not s:
        return []
    return [p.strip() for p in s.replace(";", ",").split(",") if p.strip()]


def _to_int(value: Any) -> int | None:
    s = _clean(value)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


@dataclass(frozen=True)
class Lead:
    """A normalized, enriched lead — the sole input to draft generation."""

    first_name: str
    case_id: str | None = None
    full_name: str | None = None
    country: str | None = None
    source: str | None = None
    profile_link: str | None = None
    email: str | None = None
    services: list[str] = field(default_factory=list)
    source_language: str | None = None
    target_language: str | None = None
    secondary_languages: list[str] = field(default_factory=list)
    years_of_exp: int | None = None
    vendor_experience: str | None = None
    enrichment_status: str | None = None
    enrichment_notes: str | None = None

    @property
    def primary_language(self) -> str:
        """Best single 'language' label for the outreach (target > source)."""
        return self.target_language or self.source_language or "language"

    @property
    def has_email(self) -> bool:
        """True if the lead has a valid email address."""
        return bool(self.email and "@" in self.email)

    @property
    def has_linkedin(self) -> bool:
        """True if the lead has a LinkedIn profile link or is sourced from LinkedIn."""
        if self.profile_link and "linkedin.com" in self.profile_link.lower():
            return True
        if self.source and "linkedin" in self.source.lower():
            return True
        return bool(self.profile_link)

    @property
    def is_enriched(self) -> bool:
        """True if the lead is enriched (not Pending, not No public data)."""
        if self.enrichment_status:
            status = self.enrichment_status.strip().lower()
            if status in {"no public data", "pending", "failed", "invalid"}:
                return False
            if status in {"enriched", "ok", "complete"}:
                return True
        # Fallback check: lead has real name and at least some enriched attributes
        has_real_name = bool(self.first_name and self.first_name.lower() not in {"there", "test"})
        has_details = bool(self.services or self.source_language or self.target_language or self.years_of_exp or self.email)
        return has_real_name and has_details

    def grounding_facts(self) -> dict[str, str]:
        """The ONLY facts the model is allowed to use, as a flat dict."""
        facts: dict[str, str] = {"first_name": self.first_name}
        if self.full_name:
            facts["full_name"] = self.full_name
        if self.country:
            facts["country"] = self.country
        if self.target_language:
            facts["target_language"] = self.target_language
        if self.source_language:
            facts["source_language"] = self.source_language
        if self.secondary_languages:
            facts["secondary_languages"] = ", ".join(self.secondary_languages)
        if self.services:
            facts["services"] = ", ".join(self.services)
        if self.years_of_exp is not None:
            facts["years_of_experience"] = f"{self.years_of_exp} years"
        if self.vendor_experience:
            facts["current_role_or_company"] = self.vendor_experience
        return facts


def from_record(rec: dict[str, Any]) -> Lead:
    """Normalize one raw enriched-lead record (handles JSON/XLSX/CSV schemas)."""
    return Lead(
        first_name=_clean(rec.get("First_Name")) or _clean(rec.get("first_name")) or "there",
        case_id=_clean(rec.get("Case_ID")),
        full_name=_clean(rec.get("Full_Name")) or _clean(rec.get("full_name")),
        country=_clean(rec.get("Country_of_Residence")) or _clean(rec.get("country")),
        source=_clean(rec.get("Source")) or _clean(rec.get("source")),
        profile_link=_clean(rec.get("Profile_Link")) or _clean(rec.get("profile_link")),
        email=_clean(rec.get("Email_Address")) or _clean(rec.get("email")),
        services=_split_list(rec.get("Services") or rec.get("services")),
        source_language=_clean(rec.get("Source_Language")) or _clean(rec.get("source_language")),
        target_language=_clean(rec.get("Target_Language")) or _clean(rec.get("target_language")),
        secondary_languages=_split_list(rec.get("Secondary_Languages") or rec.get("secondary_languages")),
        years_of_exp=_to_int(rec.get("Years_of_Exp") or rec.get("years_of_exp")),
        vendor_experience=_clean(rec.get("Vendor_Experience")) or _clean(rec.get("vendor_experience")),
        enrichment_status=_clean(rec.get("Enrichment_Status")),
        enrichment_notes=_clean(rec.get("Enrichment_Notes")),
    )


def load_leads_from_file(path: str) -> list[Lead]:
    """Load and normalize leads from JSON, XLSX, or CSV file."""
    if not os.path.exists(path):
        log.warning("File does not exist: %s", path)
        return []

    ext = os.path.splitext(path)[1].lower()
    records: list[dict[str, Any]] = []

    if ext == ".json":
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if isinstance(raw, list):
            records = [r for r in raw if isinstance(r, dict)]
    elif ext in {".xlsx", ".xls"}:
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if rows:
            headers = [str(h).strip() if h is not None else f"col_{idx}" for idx, h in enumerate(rows[0])]
            for r in rows[1:]:
                records.append(dict(zip(headers, r)))
    elif ext == ".csv":
        import csv

        with open(path, "r", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            records = list(reader)

    return [from_record(r) for r in records]


def load_leads(paths: str | list[str], limit: int | None = None, only_enriched: bool = True) -> list[Lead]:
    """Load and normalize enriched leads from one or multiple file paths."""
    if isinstance(paths, str):
        file_paths = [p.strip() for p in paths.split(",") if p.strip()]
    else:
        file_paths = paths

    all_leads: list[Lead] = []
    seen_ids: set[str] = set()

    for path in file_paths:
        leads = load_leads_from_file(path)
        for lead in leads:
            if only_enriched and not lead.is_enriched:
                continue
            key = lead.email or lead.profile_link or (lead.first_name + "_" + (lead.full_name or ""))
            if key not in seen_ids:
                seen_ids.add(key)
                all_leads.append(lead)

    if limit is not None:
        all_leads = all_leads[:limit]

    log.info("Loaded %d enriched leads from %d source file(s)", len(all_leads), len(file_paths))
    return all_leads


def filter_leads_for_channel(leads: list[Lead], channel: str) -> list[Lead]:
    """Filter leads according to channel eligibility:
    - 'email': lead must have an email address
    - 'linkedin': lead must have a LinkedIn profile link / ID
    """
    if channel == "email":
        filtered = [l for l in leads if l.has_email]
        log.info("Filtered %d email-capable leads out of %d total", len(filtered), len(leads))
        return filtered
    elif channel == "linkedin":
        filtered = [l for l in leads if l.has_linkedin]
        log.info("Filtered %d linkedin-capable leads out of %d total", len(filtered), len(leads))
        return filtered
    return leads

