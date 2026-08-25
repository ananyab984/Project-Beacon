"""Normalized Lead dataclass and record parser, synced 1-to-1 with draft_poc/leads.py."""

from __future__ import annotations

import json
import os
import re
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


def _as_list(value: Any) -> List[Any]:
    """Clay's list-shaped fields (experience/education/languages/courses)
    arrive already parsed as a JSON array by FastAPI/Pydantic -- just guard
    against a missing or malformed value rather than assuming the shape."""
    return value if isinstance(value, list) else []


def _to_int(value: Any) -> Optional[int]:
    s = _clean(value)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _label_of(entry: Any) -> str:
    """A language/course entry may be a plain string or a dict (Clay's real
    payloads use both depending on the field) -- extract a readable label
    either way, or "" if there's nothing usable."""
    if isinstance(entry, str):
        return entry.strip()
    if isinstance(entry, dict):
        return str(entry.get("language") or entry.get("name") or entry.get("title") or "").strip()
    return ""


# Must match prompt_builder.BRAND["company"] (lowercased) -- kept as a plain
# constant here rather than imported, since prompt_builder imports Lead from
# this module and importing back would create a circular import.
_OWN_COMPANY_NAMES = {"global3"}


def _role_highlight(entry: Dict[str, Any], max_chars: int = 220) -> str:
    """Extract a short, specific excerpt from a role's free-text summary --
    confirmed against real Clay data (Avik Chakraborty's "Enrich person"
    payload) that these summaries carry genuinely specific, quotable detail
    (named shows, companies, technologies -- e.g. "lent my voice for
    Paramount Pictures' Kung Fu Panda") that generic title/company/dates
    completely misses. Strips bullet markers/newlines, then truncates at a
    sentence or word boundary (never mid-word) so the excerpt reads cleanly
    -- the drafting prompt is responsible for picking the single best detail
    out of this, not for using the whole thing.
    """
    raw = entry.get("summary") or entry.get("Summary") or entry.get("description")
    if not raw or not isinstance(raw, str):
        return ""
    # Bullet markers (•, -, *) and newlines collapse to a single space so
    # multi-line bullet lists read as one flowing excerpt instead of
    # fragmenting mid-sentence at the truncation point.
    text = re.sub(r"[••\n\r]+", " ", raw).strip()
    text = re.sub(r"\s{2,}", " ", text)
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    # Prefer cutting at the last sentence boundary; fall back to word boundary.
    for boundary in (". ", ", "):
        idx = truncated.rfind(boundary)
        if idx > max_chars * 0.4:
            return truncated[: idx + 1].rstrip()
    idx = truncated.rfind(" ")
    return (truncated[:idx] if idx > 0 else truncated).rstrip() + "…"


def _format_role(entry: Dict[str, Any]) -> str:
    """One Clay experience/role entry -> 'Title at Company (start–end): highlight'.
    Defensive about key naming (confirmed both snake_case and camelCase
    appear in real captured Clay payloads depending on which action produced
    them) -- omits whatever piece is missing rather than guessing.
    """
    title = entry.get("title") or entry.get("Title")
    company = entry.get("company") or entry.get("Company") or entry.get("org")
    start = entry.get("startDate") or entry.get("start_date")
    end = entry.get("endDate") or entry.get("end_date")
    label_parts = [str(title)] if title else []
    if company:
        label_parts.append(f"at {company}")
    label = " ".join(label_parts)
    if not label:
        return ""
    if start:
        label = f"{label} ({start}–{end or 'present'})"
    highlight = _role_highlight(entry)
    if highlight:
        return f"{label}: {highlight}"
    return label


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
    # Clay's full-fidelity enrichment -- specific past roles/companies/dates,
    # not the lossy thin summary above. Each entry is whatever dict shape
    # Clay's "Enrich person" action returned (title/company/start_date/
    # end_date, etc. -- confirmed against real captured payloads); rendered
    # into a concise, specific grounding fact in grounding_facts() below.
    experience: List[Dict[str, Any]] = field(default_factory=list)
    education: List[Dict[str, Any]] = field(default_factory=list)
    languages: List[str] = field(default_factory=list)
    courses: List[str] = field(default_factory=list)
    # The COMPLETE raw Clay payload, verbatim, on top of the curated fields
    # above -- deliberately included so the model can mine anything not
    # explicitly modeled by this dataclass (connections, volunteering,
    # structured_location, etc.), rather than a code-level decision in
    # advance about what's "relevant". Rendered as a labeled supplementary
    # block in the prompt (see prompt_builder._full_clay_block), still bound
    # by the same "never invent, only use what's literally present" rule.
    clay_full_data: Optional[Dict[str, Any]] = None
    # Same principle, extended to the primary scrape source (Bright Data for
    # LinkedIn, Tavily for ProZ/ATA/etc.) -- shape varies by provider (Bright
    # Data returns a list, Tavily a dict), so this is `Any`, not `Dict`.
    raw_scrape_data: Optional[Any] = None

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
        # Clay's richer data -- rendered concisely (most recent 1-2 roles,
        # not the whole array) so the model has specific, named material to
        # draw on without the prompt ballooning. Never invents structure:
        # if a field is missing from an entry, it's just omitted, same
        # discipline as every other fact here.
        if self.experience:
            # Skip roles at our own company -- confirmed against real test
            # data that a lead's most recent entry can be a role at Global3
            # itself (e.g. a current/former contractor), which would make for
            # a nonsensical "personalization" ("we noticed you work at us").
            # Must match prompt_builder.BRAND["company"] (not imported
            # directly -- prompt_builder already imports Lead from here, so
            # importing back would be circular).
            external_entries = [
                e for e in self.experience
                if isinstance(e, dict) and str(e.get("company") or e.get("Company") or "").strip().lower() not in _OWN_COMPANY_NAMES
            ]
            top_roles = [r for r in (_format_role(e) for e in external_entries[:2]) if r]
            if top_roles:
                facts["recent_experience"] = "; ".join(top_roles)
        if self.education and isinstance(self.education[0], dict):
            edu = self.education[0]
            # `school_name` confirmed as the real key in captured Clay data
            # (not `school`) -- kept both for defensiveness.
            inst = edu.get("institution") or edu.get("school_name") or edu.get("school")
            degree = edu.get("degree")
            field_of_study = edu.get("field_of_study")
            edu_parts = [x for x in (degree, field_of_study, inst) if x and str(x).lower() != "not specified"]
            if edu_parts:
                facts["education"] = ", ".join(edu_parts)
        if self.languages:
            facts["additional_languages_spoken"] = ", ".join(_label_of(l) for l in self.languages[:5] if _label_of(l))
        if self.courses:
            facts["courses_completed"] = ", ".join(_label_of(c) for c in self.courses[:3] if _label_of(c))
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
        experience=_as_list(rec.get("Clay_Experience")),
        education=_as_list(rec.get("Clay_Education")),
        languages=_as_list(rec.get("Clay_Languages")),
        courses=_as_list(rec.get("Clay_Courses")),
        clay_full_data=rec.get("Clay_Full_Data") if isinstance(rec.get("Clay_Full_Data"), dict) else None,
        raw_scrape_data=rec.get("Raw_Scrape_Data") if rec.get("Raw_Scrape_Data") else None,
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

