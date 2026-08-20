"""Normalized Lead dataclass and record parser, synced 1-to-1 with draft_poc/leads.py."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from logger import get_logger

log = get_logger(__name__)


def _clean(value: Any) -> Optional[str]:
    """Trim strings; treat empty / 'null' / 'n/a' / '[Missing Input]' as missing."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"null", "none", "n/a", "na", "-", "[missing input]", "missing"}:
        return None
    return s


def _split_list(value: Any) -> List[str]:
    s = _clean(value)
    if not s:
        return []
    return [p.strip() for p in s.replace(";", ",").split(",") if p.strip()]


def _to_int(value: Any) -> Optional[int]:
    s = _clean(value)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


@dataclass(frozen=True)
class Lead:
    """A normalized, enriched lead — the sole read-only input to draft generation."""

    first_name: str
    case_id: Optional[str] = None
    full_name: Optional[str] = None
    country: Optional[str] = None
    source: Optional[str] = None
    profile_link: Optional[str] = None
    email: Optional[str] = None
    services: List[str] = field(default_factory=list)
    source_language: Optional[str] = None
    target_language: Optional[str] = None
    secondary_languages: List[str] = field(default_factory=list)
    years_of_exp: Optional[int] = None
    vendor_experience: Optional[str] = None
    enrichment_status: Optional[str] = None
    headline: Optional[str] = None
    about_snippet: Optional[str] = None
    current_title: Optional[str] = None
    tools_software: List[str] = field(default_factory=list)
    certifications: List[str] = field(default_factory=list)

    @property
    def primary_language(self) -> str:
        """Best single 'language' label for the outreach."""
        return self.target_language or self.source_language or "language"

    @property
    def has_email(self) -> bool:
        """True if the lead has a valid email address."""
        return bool(self.email and "@" in self.email)

    @property
    def has_linkedin(self) -> bool:
        """True only if the lead has a genuine LinkedIn profile URL (not just any profile link)."""
        if not self.profile_link:
            return False
        link = self.profile_link.lower()
        return "linkedin.com/in/" in link or "linkedin.com/pub/" in link

    @property
    def is_enriched(self) -> bool:
        """True if the lead is enriched."""
        if self.enrichment_status:
            status = self.enrichment_status.strip().lower()
            if status in {"no public data", "pending", "failed", "invalid"}:
                return False
            if status in {"enriched", "ok", "complete", "enrichment_complete"}:
                return True
        has_real_name = bool(self.first_name and self.first_name.lower() not in {"there", "test"})
        has_details = bool(self.services or self.source_language or self.target_language or self.years_of_exp or self.email)
        return has_real_name and has_details

    def grounding_facts(self) -> Dict[str, str]:
        """The ONLY facts the model is allowed to use, as a flat dict."""
        facts: Dict[str, str] = {"first_name": self.first_name}
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
        if self.current_title:
            facts["current_title"] = self.current_title
        if self.headline:
            facts["headline"] = self.headline
        if self.tools_software:
            facts["tools_software"] = ", ".join(self.tools_software)
        if self.certifications:
            facts["certifications"] = ", ".join(self.certifications)
        if self.about_snippet:
            facts["about_snippet"] = self.about_snippet
        return facts


@dataclass
class ChannelEligibility:
    """Result of the automatic-trigger eligibility gate for one (lead, channel) pair."""

    channel: str
    eligible: bool
    reason: str  # "OK" | "NO_EMAIL" | "NO_LINKEDIN_PROFILE" | "MANUAL_OVERRIDE" | "UNKNOWN_CHANNEL:<x>"
    manual_override: bool = False


def check_channel_eligibility(lead: Lead, channel: str, manual_override: bool = False) -> ChannelEligibility:
    """Does `lead` have the contact data required to auto-generate a draft for `channel`?

    Bypassed unconditionally when manual_override=True (an explicit recruiter-selected
    trigger gets full discretion once a lead has been explicitly chosen).
    """
    if manual_override:
        return ChannelEligibility(channel=channel, eligible=True, reason="MANUAL_OVERRIDE", manual_override=True)
    if channel == "email":
        return ChannelEligibility(channel=channel, eligible=lead.has_email,
                                   reason="OK" if lead.has_email else "NO_EMAIL")
    if channel == "linkedin":
        return ChannelEligibility(channel=channel, eligible=lead.has_linkedin,
                                   reason="OK" if lead.has_linkedin else "NO_LINKEDIN_PROFILE")
    return ChannelEligibility(channel=channel, eligible=False, reason=f"UNKNOWN_CHANNEL:{channel}")


def from_record(rec: Dict[str, Any]) -> Lead:
    """Normalize one raw enriched-lead record."""
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
        enrichment_status=_clean(rec.get("Enrichment_Status")) or _clean(rec.get("enrichment_status")),
        headline=_clean(rec.get("Headline")) or _clean(rec.get("headline")),
        about_snippet=_clean(rec.get("About_Snippet")) or _clean(rec.get("about_snippet")),
        current_title=_clean(rec.get("Current_Title")) or _clean(rec.get("current_title")),
        tools_software=_split_list(rec.get("Tools_Software") or rec.get("tools_software")),
        certifications=_split_list(rec.get("Certifications") or rec.get("certifications")),
    )


def load_leads_from_file(path: str) -> List[Lead]:
    """Load and normalize leads from JSON, XLSX, or CSV file."""
    if not os.path.exists(path):
        log.warning("File does not exist: %s", path)
        return []

    ext = os.path.splitext(path)[1].lower()
    records: List[Dict[str, Any]] = []

    if ext == ".json":
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if isinstance(raw, list):
            records = [r for r in raw if isinstance(r, dict)]
        elif isinstance(raw, dict):
            records = [raw]
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


def load_leads(paths: str | List[str], limit: Optional[int] = None, only_enriched: bool = True) -> List[Lead]:
    """Load and normalize enriched leads from one or multiple file paths."""
    file_paths = [p.strip() for p in paths.split(",")] if isinstance(paths, str) else paths

    all_leads: List[Lead] = []
    seen_ids: set = set()

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

    log.info("Loaded %d enriched leads from source file(s)", len(all_leads))
    return all_leads

