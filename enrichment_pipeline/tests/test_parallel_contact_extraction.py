"""Tests for Parallel's new email/phone extraction -- added on top of the
existing LeadProfile schema (providers/parallel_client.py) so Parallel can
pick up contact details that are genuinely visible on a profile page, which
it was never asked for before.

Covers the two things that matter most given the stated risk (a wrong
contact reaches a real, different person): the merge never overwrites an
existing value, and an absence-narrated string ("no email listed") is
dropped rather than written as fake data -- same guard certifications
already gets. Also pins the LinkedIn-specific log line that explains why
these fields are expected to stay empty there, so a recruiter reading logs
sees a documented platform restriction, not a silent unexplained miss.

Run: cd enrichment_pipeline && source .venv/bin/activate && pytest tests/test_parallel_contact_extraction.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from orchestrator import EnrichmentOrchestrator
from providers.parallel_client import LeadProfile


def _orch() -> EnrichmentOrchestrator:
    cfg = Config(brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="")
    return EnrichmentOrchestrator(cfg)


def test_schema_declares_email_and_phone():
    fields = LeadProfile.model_json_schema()["properties"]
    assert "email" in fields
    assert "phone" in fields


def test_schema_instructs_verbatim_only_never_infer():
    fields = LeadProfile.model_json_schema()["properties"]
    email_desc = fields["email"]["description"].lower()
    assert "never construct" in email_desc or "never" in email_desc and "infer" in email_desc
    assert "linkedin" in email_desc  # the platform caveat must live in the instructions the model actually receives


def test_merge_fills_email_and_phone_when_found():
    lead = {"Source": "PROZ", "Email_Address": None, "Contact_Number": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"email": "linguist@example.com", "phone": "+34 600 000 000"})
    assert lead["Email_Address"] == "linguist@example.com"
    assert lead["Contact_Number"] == "+34 600 000 000"
    assert field_sources["Email_Address"] == "parallel"
    assert field_sources["Contact_Number"] == "parallel"


def test_merge_never_overwrites_an_existing_contact():
    lead = {"Source": "PROZ", "Email_Address": "already-on-file@example.com", "Contact_Number": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"email": "different@example.com", "phone": None})
    assert lead["Email_Address"] == "already-on-file@example.com", "an existing contact must never be silently replaced"
    assert "Email_Address" not in field_sources, "untouched fields keep their prior provenance, not a fresh 'parallel' stamp"


def test_absence_prose_is_dropped_not_stored_as_fake_data():
    lead = {"Source": "PROZ", "Email_Address": None, "Contact_Number": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"email": "No email is listed on this profile.", "phone": None})
    assert lead.get("Email_Address") is None


def test_linkedin_with_no_contact_found_logs_the_platform_explanation():
    lead = {"Source": "LINKEDIN", "Email_Address": None, "Contact_Number": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"email": None, "phone": None})
    assert any("linkedin" in line.lower() and "login" in line.lower() for line in logs), "must explain the platform restriction, not fail silently"


def test_non_linkedin_with_no_contact_found_does_not_log_the_linkedin_explanation():
    lead = {"Source": "PROZ", "Email_Address": None, "Contact_Number": None}
    field_sources: dict = {}
    logs: list = []
    _orch()._merge_parallel_fields(lead, field_sources, logs, {"email": None, "phone": None})
    assert not any("login-gated" in line for line in logs)
