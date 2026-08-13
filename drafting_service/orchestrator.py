"""AI Message Drafting Pipeline Orchestrator."""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict
from typing import Any, Dict, List, Optional, TypedDict

from config import Config
from core.edit_logger import log_recruiter_edit
from core.leads import Lead, check_channel_eligibility, from_record
from core.rate_card import RateCardService
from claude_client import ClaudeClient
from draft_generator import Draft, generate_email, generate_linkedin
from evaluator import Evaluation, evaluate
from logger import get_logger

log = get_logger(__name__)


class PipelineDraftResult(TypedDict):
    draft_id: str
    channel: str
    lead_name: str
    subject: Optional[str]
    body: str
    verdict: str  # "SEND" | "HOLD" | "INELIGIBLE"
    evaluation: Dict[str, Any]
    flags: List[str]
    rate_applied: Optional[Dict[str, Any]]
    telemetry: Dict[str, Any]
    manual_override: bool


class DraftingOrchestrator:
    """6-Stage AI Message Drafting Pipeline Orchestrator."""

    def __init__(self, config: Config, rate_card: Optional[List[Dict[str, Any]]] = None):
        self.config = config
        self.client = ClaudeClient(config) if config.api_key else None
        self.rate_card_service = RateCardService(rate_card)

    def process_draft(
        self,
        lead_record: Dict[str, Any],
        channel: str = "email",
        manual_override: bool = False,
    ) -> PipelineDraftResult:
        start_time = time.monotonic()
        draft_id = f"draft_{uuid.uuid4().hex[:8]}"

        # Stage 1: Lead Ingestion
        lead = from_record(lead_record)

        # Stage 1.5: Automatic Eligibility Gate (bypassed entirely if manual_override)
        eligibility = check_channel_eligibility(lead, channel, manual_override=manual_override)
        if not eligibility.eligible:
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            log.info(
                "Drafting [%s] INELIGIBLE channel=%s lead=%s reason=%s",
                draft_id, channel, lead.first_name, eligibility.reason,
            )
            return {
                "draft_id": draft_id,
                "channel": channel,
                "lead_name": lead.first_name,
                "subject": None,
                "body": "",
                "verdict": "INELIGIBLE",
                "evaluation": {
                    "channel": channel,
                    "lead_name": lead.first_name,
                    "checks": [],
                    "programmatic_pass": False,
                    "send": False,
                    "flags": [eligibility.reason],
                },
                "flags": [eligibility.reason],
                "rate_applied": None,
                "telemetry": {
                    "model": None,
                    "latency_ms": 0,
                    "prompt_tokens": None,
                    "completion_tokens": None,
                    "total_execution_time_ms": elapsed_ms,
                },
                "manual_override": manual_override,
            }

        # Stage 2: Rate Card Lookup
        rate_match, rate_flag = self.rate_card_service.lookup_rate(
            source_lang=lead.source_language,
            target_lang=lead.target_language,
            service=lead.services[0] if lead.services else "Translation",
        )

        log.info("Drafting [%s] channel=%s lead=%s rate_match=%s", draft_id, channel, lead.first_name, bool(rate_match))

        # Stage 3: Prompt Building & LLM Generation, grounded strictly in
        # lead.grounding_facts() -- see prompts/prompt_builder.py's STRICT RULES.
        if not self.client:
            raise RuntimeError("CLAUDE_API_KEY is not configured in drafting service.")

        if channel == "email":
            draft = generate_email(self.client, self.config, lead, rate_match=rate_match, rate_flag=rate_flag)
        else:
            draft = generate_linkedin(self.client, self.config, lead, rate_match=rate_match, rate_flag=rate_flag)

        # Stage 4: Programmatic Rule Evaluation (evaluator.py)
        ev: Evaluation = evaluate(draft)

        # Stage 5: Approval Queue Formatting & Verdict Assignment
        verdict = "SEND" if ev.send else "HOLD"
        elapsed_ms = int((time.monotonic() - start_time) * 1000)

        telemetry = {
            "model": draft.model,
            "latency_ms": draft.latency_ms,
            "prompt_tokens": draft.prompt_tokens,
            "completion_tokens": draft.completion_tokens,
            "total_execution_time_ms": elapsed_ms,
        }

        log.info("Drafting [%s] complete -> verdict=%s (latency=%dms)", draft_id, verdict, elapsed_ms)

        return {
            "draft_id": draft_id,
            "channel": channel,
            "lead_name": lead.first_name,
            "subject": draft.subject,
            "body": draft.body,
            "verdict": verdict,
            "evaluation": ev.to_dict(),
            "flags": ev.flags,
            "rate_applied": rate_match,
            "telemetry": telemetry,
            "manual_override": manual_override,
        }

    def record_edit(self, draft_id: str, original_body: str, edited_body: str) -> Dict[str, Any]:
        """Stage 6: Record recruiter edits and compute similarity / edit-rate telemetry."""
        return log_recruiter_edit(draft_id, original_body, edited_body)
