"""Draft generation layer — Lead + rate context -> Claude -> {subject?, body}.

The LLM is given ONLY `Lead.grounding_facts()` (every real enriched field the
lead record actually has: name, country, languages, services, years of
experience, current role/company) plus the approved template as a structural
pattern to follow -- never a hardcoded phrase spliced into the output. The
system prompt (prompts/prompt_builder.py) is strict about using nothing else,
so personalization is genuine (drawn from whatever facts are actually present)
without inventing employers, rates, or credentials that aren't in LEAD FACTS.

Includes _ensure_links() guardrail to guarantee brand URLs survive generation.
"""

from __future__ import annotations

import json
import re
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


_SPECIFICITY_RETRY_NOTE = (
    "Your previous draft didn't reference any specific named fact (a tool, certification, "
    "current title, employer, or -- when none of those exist -- a distinguishing phrase "
    "from about_snippet) even though one was available in LEAD FACTS. Regenerate the draft "
    "and this time explicitly use it, per the HARD REQUIREMENT rules above."
)


def _about_snippet_phrases(about_snippet: str) -> list[str]:
    """Rough candidate distinguishing phrases from free-form About text, used
    only as the tier-2 fallback (see prompt_builder._VOICE_RULES) when no
    tier-1 concrete fact exists -- e.g. "project manager and multilingual
    content specialist" -> ["project manager", "multilingual content
    specialist"]. Heuristic, not exhaustive -- just enough to verify the
    model pulled *something* distinguishing rather than ignoring the field."""
    chunks = re.split(r",|;|\.\s|\band\b|\bwith\b|\bwho\b|\bwhere\b", about_snippet)
    phrases = []
    for chunk in chunks:
        phrase = chunk.strip(" .")
        words = phrase.split()
        if not words:
            continue
        # Truncate an overlong chunk to its first few words instead of
        # discarding it outright -- still a meaningful distinguishing phrase.
        if len(words) > 6:
            words = words[:6]
            phrase = " ".join(words)
        if len(words) >= 2 and 8 <= len(phrase) <= 60:
            phrases.append(phrase)
    return phrases


def _experience_role_facts(experience_history: str) -> list[str]:
    """Extract "title" and "company" tokens from each formatted role entry
    (see linkedin_parser._extract_experience_history's "Title at Company
    (dates): description" shape) as individually checkable fact strings --
    finer-grained than the whole line, since the model paraphrases around
    the raw text rather than reproducing it verbatim."""
    facts: list[str] = []
    for role in experience_history.split("; "):
        header = role.split(":", 1)[0].strip()
        match = re.match(r"^(.*?)\s+at\s+(.+?)(?:\s*\(.*\))?$", header)
        if match:
            title, company = match.group(1).strip(), match.group(2).strip()
            if title:
                facts.append(title)
            if company and company.lower() != pb.BRAND["company"].lower():
                facts.append(company)
        elif header:
            facts.append(header)
    return facts


_CONTEXT_FACT_KEYS = {"title", "name", "issuer", "subtitle", "school", "field", "degree", "company"}


def _full_context_facts(full_profile_context: str) -> list[str]:
    """Tier-3 fallback: pull candidate specific strings (award titles,
    institution names, skill names, ...) out of the raw JSON blob
    (`linkedin_parser._build_full_profile_context`) by walking it for values
    under name-ish keys -- used only when tiers 1 and 2 are both empty, so
    the retry mechanism can still catch the model ignoring a real detail
    that exists only in the raw context, not in the curated fields."""
    try:
        data = json.loads(full_profile_context)
    except (json.JSONDecodeError, TypeError):
        return []

    found: list[str] = []

    def _walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in _CONTEXT_FACT_KEYS and isinstance(v, str) and v.strip():
                    found.append(v.strip())
                else:
                    _walk(v)
        elif isinstance(obj, list):
            for item in obj:
                _walk(item)

    _walk(data)
    return found


def _specific_fact_strings(lead: Lead) -> list[str]:
    """Concrete, named facts a draft can point to -- used to verify the model
    actually cited something specific rather than only a generic category.
    Tier 1 (tools/certifications/title/employer/experience_history) takes
    priority; falls back to about_snippet-derived phrases (tier 2), then to
    full_profile_context-derived facts (tier 3), only when the prior tier is
    empty -- mirrors prompt_builder._VOICE_RULES' three-tier specificity
    requirement."""
    facts: list[str] = []
    facts.extend(lead.tools_software)
    facts.extend(lead.certifications)
    if lead.current_title:
        facts.append(lead.current_title)
    if lead.vendor_experience:
        # Exclude our own company name -- it appears in the boilerplate
        # brand references regardless of personalization, so it would
        # trivially "pass" the check without the draft actually being
        # personalized to this lead.
        facts.extend(
            c.strip() for c in lead.vendor_experience.split(",")
            if c.strip() and c.strip().lower() != pb.BRAND["company"].lower()
        )
    if lead.experience_history:
        facts.extend(_experience_role_facts(lead.experience_history))
    facts = [f for f in facts if f]
    if facts:
        return facts
    if lead.about_snippet:
        tier2 = _about_snippet_phrases(lead.about_snippet)
        if tier2:
            return tier2
    if lead.full_profile_context:
        return _full_context_facts(lead.full_profile_context)
    return []


def _has_specific_fact(body: str, facts: list[str]) -> bool:
    lowered = body.lower()
    return any(f.lower() in lowered for f in facts)


def _ensure_links(body: str, channel: str) -> str:
    """Guardrail: make sure the canonical brand links survived generation.

    LinkedIn connection notes are hard-capped at 200 characters (see
    prompt_builder.LINKEDIN_CHAR_TARGET) -- only the apply link is enforced
    there, since it's the one actual call to action; the separate "Visit:
    site" line email gets would otherwise burn chars that should go to the
    lead's actual enriched facts (e.g. years of experience).
    """
    text = body
    if pb.BRAND["apply_url"] not in text and "app.global3.io/apply" not in text:
        sep = " " if channel == "linkedin" else "\n\n"
        text += f"{sep}Apply here: {pb.BRAND['apply_url']}"
    if channel != "linkedin" and pb.BRAND["site"] not in text:
        text += f"\n\nVisit: {pb.BRAND['site']}"
    return text.strip()


def generate_email(client: ClaudeClient, cfg: Config, lead: Lead, rate_match: Optional[Dict[str, Any]] = None, rate_flag: Optional[str] = None) -> Draft:
    """Generate an outreach email draft, personalized from the lead's real enriched facts."""
    system, user = pb.build_email_prompt(lead, rate_match)
    completion = client.chat(
        system, user, model=cfg.gen_model,
        temperature=cfg.gen_temperature, json_mode=True, max_tokens=900,
    )
    data = _parse(completion.text)

    specific_facts = _specific_fact_strings(lead)
    if specific_facts and not _has_specific_fact(data.get("body") or "", specific_facts):
        log.warning("Email draft for %s cited no specific fact from %s -- regenerating once", lead.first_name, specific_facts)
        retry_user = f"{user}\n\n{_SPECIFICITY_RETRY_NOTE}"
        completion = client.chat(
            system, retry_user, model=cfg.gen_model,
            temperature=cfg.gen_temperature, json_mode=True, max_tokens=900,
        )
        data = _parse(completion.text)
        if not _has_specific_fact(data.get("body") or "", specific_facts):
            log.warning("Retry for %s still cited no specific fact; keeping it as best-effort", lead.first_name)

    subject = (data.get("subject") or f"Freelance partnership with {pb.BRAND['company']}").strip()
    body = _ensure_links((data.get("body") or "").strip(), "email")
    return Draft(
        channel="email", lead=lead, subject=subject, body=body,
        model=completion.model, latency_ms=completion.latency_ms,
        prompt_tokens=completion.prompt_tokens, completion_tokens=completion.completion_tokens,
        rate_match=rate_match, rate_flag=rate_flag,
    )


def generate_linkedin(client: ClaudeClient, cfg: Config, lead: Lead, rate_match: Optional[Dict[str, Any]] = None, rate_flag: Optional[str] = None) -> Draft:
    """Generate a LinkedIn connection note draft, personalized from the lead's real enriched facts."""
    system, user = pb.build_linkedin_prompt(lead, rate_match)
    completion = client.chat(
        system, user, model=cfg.gen_model,
        temperature=cfg.gen_temperature, json_mode=True, max_tokens=400,
    )
    data = _parse(completion.text)

    specific_facts = _specific_fact_strings(lead)
    if specific_facts and not _has_specific_fact(data.get("body") or "", specific_facts):
        log.warning("LinkedIn draft for %s cited no specific fact from %s -- regenerating once", lead.first_name, specific_facts)
        retry_user = f"{user}\n\n{_SPECIFICITY_RETRY_NOTE}"
        completion = client.chat(
            system, retry_user, model=cfg.gen_model,
            temperature=cfg.gen_temperature, json_mode=True, max_tokens=400,
        )
        data = _parse(completion.text)
        if not _has_specific_fact(data.get("body") or "", specific_facts):
            log.warning("Retry for %s still cited no specific fact; keeping it as best-effort", lead.first_name)

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
