"""Groq REST client for the waterfall's "format the raw provider output into
canonical fields" stage (map_profile). It only ever reads data the pipeline
already has, no live web search, which is exactly the kind of fast structured-extraction call
Groq is used for elsewhere in this pipeline (see core/dedup_client.py's
duplicate-matching stage).

Distinct from llm_fallback/client.py's ClaudeClient, which keeps Stage 6's
live web search (search_missing_fields) and English normalization
(translate_to_english) -- Groq has no equivalent web-search tool, so those
two stay on Claude.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import requests

from config import Config
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from logger import get_logger

log = get_logger(__name__)


class GroqMappingError(RuntimeError):
    """Failure during a Groq mapping/classification call.

    `permanent` mirrors ClaudeError's flag: True means the SAME request
    would fail the same way again (a genuine 4xx the API rejected outright),
    so a caller's re-attempt policy should never retry it."""

    def __init__(self, message: str, permanent: bool = False):
        super().__init__(message)
        self.permanent = permanent


class GroqMappingClient:
    """Groq chat-completions client for map_profile -- see its docstring."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.groq_api_key}",
                "Content-Type": "application/json",
            }
        )
        # See config.py's fast_provider_deadline_seconds: the shared default
        # 15s deadline left this client's retries structurally unreachable
        # (one 10s attempt + 1s backoff leaves ~4s of a 15s budget), same bug
        # Bright Data was pulled out of.
        self._policy = RetryPolicy(retries=config.max_retries, deadline_seconds=config.fast_provider_deadline_seconds)
        self._request_timeout = config.fast_provider_request_timeout

    # Canonical field -> (JSON response key, kind, what belongs in it).
    # Email_Address/Contact_Number are deliberately absent (a wrong contact
    # reaches a different real person -- those stay on their literal-only
    # path), and so is Years_of_Exp (computed in code from experience dates,
    # never asked of a model).
    PROFILE_FIELDS: Dict[str, tuple] = {
        "Headline": ("headline", "text", "the profile's headline/tagline"),
        "Current_Title": ("current_title", "text", "the current role's job title"),
        "About_Snippet": ("about", "text", "the About/Bio/Summary text, complete"),
        "Country_of_Residence": ("country", "text", "the country the person is based in, as the data names it"),
        "Services": ("services", "list", "services/specialties the profile lists (skills, services, specialties sections)"),
        "Tools_Software": ("tools_software", "list", "every tool, software product or platform named anywhere in the data"),
        "Certifications": ("certifications", "list", "certifications, licences and credentials listed"),
        "Vendor_Experience": ("vendor_experience", "list", "every company/employer named in the work history"),
        "Source_Language": ("source_language", "text", "the language translated FROM, only when the data states a direction (e.g. 'English > Spanish')"),
        "Target_Language": ("target_language", "text", "the language translated INTO, only when the data states a direction"),
        "Secondary_Languages": ("secondary_languages", "list", "every language the profile lists"),
    }

    def map_profile(self, raw_json: str) -> Dict[str, Any]:
        """Format raw provider output (Parallel + Bright Data/Tavily, as one
        JSON document) into the canonical enrichment fields. FORMATTING ONLY:
        the model sorts values that are already in the data into the right
        field and cleans them up -- it is told never to infer, guess or add
        anything, and orchestrator.py's grounding check then drops any value
        that does not literally appear in the raw data, so a value the model
        made up cannot land even if it ignores the instruction.

        Returns {canonical field: str | list[str]} with only the fields that
        had a value. Raises GroqMappingError on failure."""
        schema_lines = "\n".join(
            f'  "{key}": {"[<string>, ...]" if kind == "list" else "<string|null>"},  // {desc}'
            for key, kind, desc in self.PROFILE_FIELDS.values()
        )
        system = (
            "You are a data formatter. You receive raw JSON scraped from one person's profile "
            "(a LinkedIn or freelance-platform page) by one or more providers. Your ONLY job is "
            "to put the values that are ALREADY IN THIS DATA into the fields below, cleaned up "
            "(trimmed, de-duplicated, one item per list entry).\n\n"
            "RULES:\n"
            "- Copy values as they appear in the data. Never infer, guess, summarise, translate "
            "or add anything the data does not literally contain.\n"
            "- If the data has no value for a field, return null (or an empty list). Never a "
            "placeholder or a sentence about it being missing.\n"
            "- When two providers disagree, prefer the more complete value.\n\n"
            f"Respond with ONLY a JSON object of exactly this shape:\n{{\n{schema_lines}\n}}"
        )
        body = {
            "model": self.config.groq_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "RAW PROFILE DATA:\n\n" + raw_json},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "max_tokens": 8192,  # gpt-oss reasoning tokens count against this too
        }

        result = self._request(body, "profile mapping")
        mapped: Dict[str, Any] = {}
        for field, (key, kind, _) in self.PROFILE_FIELDS.items():
            value = result.get(key)
            if kind == "list":
                items = [str(v).strip() for v in value if v and str(v).strip()] if isinstance(value, list) else []
                if items:
                    mapped[field] = items
            elif value and str(value).strip():
                mapped[field] = str(value).strip()
        return mapped

    def _request(self, body: Dict[str, Any], label: str) -> Dict[str, Any]:
        log.info("Groq %s request START model=%s", label, self.config.groq_model)

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Groq %s retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                label, attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            return retry_with_backoff(lambda: self._request_once(body, label), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, GroqMappingError):
                raise cause from exc
            raise GroqMappingError(f"Groq {label} failed after retries: {cause if cause else exc}") from exc

    def _request_once(self, body: Dict[str, Any], label: str) -> Dict[str, Any]:
        try:
            resp = self.session.post(
                self.config.groq_base_url,
                json=body,
                timeout=self._request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self._request_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        if resp.status_code == 429 or resp.status_code >= 500:
            raise TransientError(f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            # A 4xx other than 429 means the API rejected this exact request
            # (bad model name, malformed body, auth) -- the same request
            # will fail the same way again, so this is never retried.
            raise GroqMappingError(f"Groq {label} failed: HTTP {resp.status_code}: {resp.text[:200]}", permanent=True) from exc

        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        try:
            result = json.loads(content)
        except json.JSONDecodeError as exc:
            raise TransientError(f"Malformed JSON in Groq response: {exc}") from exc
        log.info("Groq %s request SUCCESS", label)
        return result
