"""Draft generation layer — Lead + rate context -> Claude -> {subject?, body}.

Synced 1-to-1 with draft_poc/draft_generator.py.
Includes _ensure_links() guardrail to guarantee brand URLs survive generation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from claude_client import ClaudeClient
from config import Config
from core.leads import Lead
from logger import get_logger
from prompts import prompt_builder as pb

log = get_logger(__name__)


@dataclass
class Draft:
    """A generated draft plus provenance for logging / evaluation."""

    channel: str  # "email" | "linkedin"
    lead: Lead
    subject: Optional[str]
    body: str
    model: str
    latency_ms: int
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    rate_match: Optional[Dict[str, Any]] = None
    rate_flag: Optional[str] = None


def _ensure_links(body: str, channel: str) -> str:
    """Guardrail: make sure the canonical brand links survived generation."""
    text = body
    if pb.BRAND["apply_url"] not in text and "app.global3.io/apply" not in text:
        sep = " " if channel == "linkedin" else "\n\n"
        text += f"{sep}Apply here: {pb.BRAND['apply_url']}"
    if pb.BRAND["site"] not in text:
        sep = " " if channel == "linkedin" else "\n\n"
        text += f"{sep}Visit: {pb.BRAND['site']}"
    return text.strip()


def generate_email(client: ClaudeClient, cfg: Config, lead: Lead, rate_match: Optional[Dict[str, Any]] = None, rate_flag: Optional[str] = None) -> Draft:
    """Generate an outreach email draft."""
    system, user = pb.build_email_prompt(lead, rate_match)
    completion = client.chat(
        system, user, model=cfg.gen_model,
        temperature=cfg.gen_temperature, json_mode=True, max_tokens=900,
    )
    data = _parse(completion.text)
    subject = (data.get("subject") or f"Freelance partnership with {pb.BRAND['company']}").strip()
    body = _ensure_links((data.get("body") or "").strip(), "email")
    return Draft(
        channel="email", lead=lead, subject=subject, body=body,
        model=completion.model, latency_ms=completion.latency_ms,
        prompt_tokens=completion.prompt_tokens, completion_tokens=completion.completion_tokens,
        rate_match=rate_match, rate_flag=rate_flag,
    )


def generate_linkedin(client: ClaudeClient, cfg: Config, lead: Lead, rate_match: Optional[Dict[str, Any]] = None, rate_flag: Optional[str] = None) -> Draft:
    """Generate a LinkedIn connection note draft."""
    system, user = pb.build_linkedin_prompt(lead, rate_match)
    completion = client.chat(
        system, user, model=cfg.gen_model,
        temperature=cfg.gen_temperature, json_mode=True, max_tokens=400,
    )
    data = _parse(completion.text)
    body = _ensure_links((data.get("body") or "").strip(), "linkedin")
    return Draft(
        channel="linkedin", lead=lead, subject=None, body=body,
        model=completion.model, latency_ms=completion.latency_ms,
        prompt_tokens=completion.prompt_tokens, completion_tokens=completion.completion_tokens,
        rate_match=rate_match, rate_flag=rate_flag,
    )


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    log.warning("Draft output was not valid JSON; treating whole output as body.")
    return {"body": text}
