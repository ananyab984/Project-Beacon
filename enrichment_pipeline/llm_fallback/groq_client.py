"""Groq REST client for the waterfall's "map already-extracted text onto
canonical fields" stages -- Services classification and the remaining-fields
fill-only extraction. Both only ever read text the pipeline already has, no
live web search, which is exactly the kind of fast structured-extraction call
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
    """Groq chat-completions client for classify_services and
    extract_missing_fields -- same method names, signatures, and return
    shapes as ClaudeClient's versions had, so orchestrator.py only needed to
    change WHICH client it calls, not how it calls it. Ported rather than
    duplicated: these two methods no longer exist on ClaudeClient."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.groq_api_key}",
                "Content-Type": "application/json",
            }
        )
        self._policy = RetryPolicy(retries=config.max_retries)

    def classify_services(self, profile_text: str) -> List[str]:
        """Identify the real professional service(s)/specialty a person
        provides, from already-extracted profile text (headline, current
        title, about/bio, certifications) -- no live web search, just a local
        read of text the pipeline already has.

        Exists because Services can be ANY real-world specialty (audio
        engineering, sound design, casting, voice direction... not just the
        fixed set of localization-industry terms
        parsers/service_aliases.py's keyword list recognizes), so a profile
        whose service is phrased in vocabulary that list doesn't cover would
        otherwise never get a Services value, however plainly the text states
        it.

        Raises GroqMappingError on failure -- the caller treats that
        identically to "found nothing": Services stays empty, exactly as if
        this step hadn't run.
        """
        system = (
            "You read a linguist/media-industry recruiting profile's already-extracted text and "
            "identify the real professional SERVICE(S) or SPECIALTY this person actually performs "
            "or offers -- e.g. Dubbing, Subtitling, Voice-over, Translation, Audio Engineering, "
            "Sound Design, Voice Direction, Casting, Video Editing, ADR, Localization, "
            "Interpretation, Copywriting, Project Management, or anything else a real profile "
            "could state. This is NOT limited to a fixed list -- report whatever the text actually "
            "supports, as short, concise service-category names (2-4 words each).\n\n"
            "RULES:\n"
            "- Only report a service the text directly supports (a stated job title, a described "
            "specialty, or explicit skills) -- never infer one from an employer's industry alone.\n"
            "- A title that MANAGES or RECRUITS FOR a specialty is not the same as PERFORMING it: "
            "'Localization Recruiter' or 'Dubbing Project Manager' do not mean the person dubs or "
            "localizes content themselves -- report a service only when the text shows the person "
            "does the work, not merely coordinates or hires for it. When genuinely ambiguous, "
            "prefer returning nothing over guessing.\n"
            "- Return SHORT names, not full sentences (e.g. 'Audio Engineering', not 'an audio "
            "engineer with 10 years of experience').\n"
            "- Return an EMPTY LIST if nothing in the text clearly supports a specific service -- "
            "never a placeholder, and never a guess from vague context alone (e.g. 'Business "
            "Owner' or 'Operations' do not name a real service on their own).\n\n"
            'Respond with ONLY a JSON object of exactly this shape: {"services": [<string>, ...]}'
        )
        body = {
            "model": self.config.groq_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "PROFILE TEXT:\n\n" + profile_text[:6000]},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "max_tokens": 512,
        }

        result = self._request(body, "Services classification")
        services = result.get("services")
        if not isinstance(services, list):
            return []
        return [str(s).strip() for s in services if s and str(s).strip()]

    # Maps each supported canonical field name to (JSON response key, kind).
    # "list" -> comma-joined string on return; "text" -> returned as-is.
    _MISSING_FIELD_SPECS: Dict[str, tuple] = {
        "Current_Title": ("current_title", "text"),
        "Tools_Software": ("tools_software", "list"),
        "Certifications": ("certifications", "list"),
        "Vendor_Experience": ("vendor_experience", "text"),
    }

    def extract_missing_fields(self, text: str, missing_fields: List[str]) -> Dict[str, str]:
        """Waterfall's last tier for whichever of Current_Title/Tools_Software/
        Certifications/Vendor_Experience are STILL empty after Bright Data,
        Tavily, and Parallel have all had their turn -- reads whatever free
        text the pipeline already has and fills in only what that text
        directly supports, exactly as classify_services already does for
        Services. Deliberately fill-only: only asked about fields the caller
        has already confirmed are empty, and never asked to reconsider a
        field that already has a value from any source (enrichment or
        manual) -- this is purely a gap-filler for what nothing else found,
        not a verification pass over existing data.

        `missing_fields` must be a subset of `_MISSING_FIELD_SPECS`' keys --
        the prompt only ever asks about exactly those, so the model has no
        opportunity to invent a value for a field the caller didn't request.
        Returns a dict keyed by canonical field name (not the JSON response
        key), containing only fields it found real support for -- omits the
        rest rather than returning nulls/empties for them.
        """
        specs = {f: self._MISSING_FIELD_SPECS[f] for f in missing_fields if f in self._MISSING_FIELD_SPECS}
        if not specs:
            return {}

        field_descriptions = {
            "current_title": "their current job title/role (a short string, e.g. 'Freelance Subtitler'), if the text names one",
            "tools_software": "specific tools or software they use (e.g. 'Trados', 'Adobe Audition', 'Subtitle Edit') -- not generic skills",
            "certifications": "named certifications, diplomas, or professional credentials -- not degrees from a university unless explicitly framed as a certification",
            "vendor_experience": "named companies/vendors/clients they've worked with or for (a short comma-separated list as one string)",
        }
        requested_keys = [spec[0] for spec in specs.values()]
        schema_lines = "\n".join(f'  "{k}": {"[<string>, ...]" if kind == "list" else "<string|null>"}' for k, (_, kind) in zip(requested_keys, specs.values()))
        asks = "\n".join(f"- {field_descriptions[k]}" for k in requested_keys)

        system = (
            "You read a linguist/media-industry recruiting profile's already-extracted text and "
            "extract ONLY the following, when the text directly supports it:\n" + asks + "\n\n"
            "RULES:\n"
            "- Only report something the text directly states -- never infer or guess from vague "
            "context.\n"
            "- Omit/null anything the text doesn't clearly support -- never a placeholder.\n"
            "- Do not report anything outside the fields listed above, even if the text mentions it.\n\n"
            f"Respond with ONLY a JSON object of exactly this shape:\n{{\n{schema_lines}\n}}"
        )
        body = {
            "model": self.config.groq_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "PROFILE TEXT:\n\n" + text[:6000]},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
            "max_tokens": 512,
        }

        result = self._request(body, "missing-fields extraction")
        found: Dict[str, str] = {}
        for canonical_field, (json_key, kind) in specs.items():
            value = result.get(json_key)
            if kind == "list":
                if isinstance(value, list):
                    items = [str(v).strip() for v in value if v and str(v).strip()]
                    if items:
                        found[canonical_field] = ", ".join(items)
            else:
                if value and str(value).strip():
                    found[canonical_field] = str(value).strip()
        return found

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
                timeout=self.config.request_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {self.config.request_timeout}s") from exc
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
