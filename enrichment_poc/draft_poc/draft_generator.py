"""Draft generation — Lead + prompts -> Groq -> {subject?, body}.

Thin orchestration layer with light post-processing guardrails: if the model
drops a required brand link, we repair it rather than trust the model. This is
the "pipeline" step between the prompt builder and the evaluator.
"""

from __future__ import annotations

from dataclasses import dataclass

import prompt_builder as pb
from config import Config
from groq_client import GroqClient
from leads import Lead
from logger import get_logger

log = get_logger(__name__)


@dataclass
class Draft:
    """A generated draft plus provenance for logging / evaluation."""

    channel: str  # "email" | "linkedin"
    lead: Lead
    subject: str | None
    body: str
    model: str
    latency_ms: int
    prompt_tokens: int | None
    completion_tokens: int | None


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



def generate_email(client: GroqClient, cfg: Config, lead: Lead) -> Draft:
    system, user = pb.build_email_prompt(lead)
    completion = client.chat(
        system, user, model=cfg.gen_model,
        temperature=cfg.gen_temperature, json_mode=True, max_tokens=900,
    )
    data = _parse(client, completion.text)
    subject = (data.get("subject") or f"Freelance partnership with {pb.BRAND['company']}").strip()
    body = _ensure_links((data.get("body") or "").strip(), "email")
    return Draft(
        channel="email", lead=lead, subject=subject, body=body,
        model=completion.model, latency_ms=completion.latency_ms,
        prompt_tokens=completion.prompt_tokens, completion_tokens=completion.completion_tokens,
    )


def generate_linkedin(client: GroqClient, cfg: Config, lead: Lead) -> Draft:
    system, user = pb.build_linkedin_prompt(lead)
    completion = client.chat(
        system, user, model=cfg.gen_model,
        temperature=cfg.gen_temperature, json_mode=True, max_tokens=400,
    )
    data = _parse(client, completion.text)
    body = _ensure_links((data.get("body") or "").strip(), "linkedin")
    return Draft(
        channel="linkedin", lead=lead, subject=None, body=body,
        model=completion.model, latency_ms=completion.latency_ms,
        prompt_tokens=completion.prompt_tokens, completion_tokens=completion.completion_tokens,
    )


def _parse(client: GroqClient, text: str) -> dict:
    import json

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    log.warning("Draft was not valid JSON; treating whole output as body.")
    return {"body": text}
