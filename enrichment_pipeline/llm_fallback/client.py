"""Claude (Anthropic) REST API client: English normalization (translate_to_english),
Tier 3's web-search fallback (search_missing_fields), and a local (no web search)
Services classification (classify_services)."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import requests

from config import Config
from core.resilience import RetryExhaustedError, RetryPolicy, TransientError, retry_with_backoff
from llm_fallback.prompt_builder import build_web_search_prompt
from logger import get_logger

log = get_logger(__name__)

# search_missing_fields always uses this model regardless of config.claude_model
# (which defaults to Haiku 4.5 for cost reasons on translate_to_english): the
# web_search_20260209 tool type requires Opus 5/4.8/4.7/4.6, Sonnet 5, or
# Sonnet 4.6 -- Haiku 4.5 isn't supported for it.
_WEB_SEARCH_MODEL = "claude-sonnet-5"


class ClaudeError(RuntimeError):
    """Failure during Claude API execution.

    `permanent` mirrors ParallelError's flag: True means the SAME request
    would fail the same way again (a genuine 4xx the model/API rejected
    outright), so a caller's re-attempt policy should never retry it. False
    (the default) covers everything that already went through
    retry_with_backoff's own retry budget and still failed (timeouts, 5xx,
    network errors) -- still worth a fresh attempt on a LATER pass, since the
    underlying cause may have been transient (a different search, a
    recovered upstream)."""

    def __init__(self, message: str, permanent: bool = False):
        super().__init__(message)
        self.permanent = permanent


def _extract_json_object(text: str) -> Dict[str, Any]:
    """Parse strict-JSON model output, salvaging a JSON object out of stray
    markdown fences or preamble if the model didn't return pure JSON.

    The Anthropic API has no `json_mode` flag equivalent to Groq's
    `response_format={"type": "json_object"}`, so the strict-JSON guarantee
    is replicated by (1) instructing the model explicitly in the prompt to
    return ONLY JSON, and (2) validating/salvaging the response here before
    it ever reaches verifier.py.
    """
    stripped = text.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    start, end = stripped.find("{"), stripped.rfind("}")
    if 0 <= start < end:
        return json.loads(stripped[start : end + 1])

    raise json.JSONDecodeError("No JSON object found in model output", stripped, 0)


class ClaudeClient:
    """Claude (Anthropic Messages API) client for targeted field extraction."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "x-api-key": config.claude_api_key,
                "anthropic-version": config.anthropic_version,
                "Content-Type": "application/json",
            }
        )
        self._policy = RetryPolicy(retries=config.max_retries)

    def search_missing_fields(
        self, missing_fields: List[str], full_name: str, profile_link: str, source_platform: str
    ) -> Dict[str, Any]:
        """Tier 3: ask Claude to use its web_search server tool to find
        specific missing fields about a named person -- fired only when
        Bright Data/Tavily and Parallel have both come up thin (see
        orchestrator.py's MAX_FIELDS_BEFORE_WEBSEARCH gate), so there's no
        scraped source text left for a raw-text extraction to mine. Ported
        from the abandoned feat/linkedin-websearch-fallback branch (commit
        2da2456), generalized beyond LinkedIn.

        No `system` field: confirmed in that branch's own testing that
        combining a system prompt / forced-JSON instruction with server tool
        use made the model skip calling the tool entirely and hallucinate a
        schema-shaped answer instead. The JSON instruction lives in the
        prompt text, and the result is salvaged from the final text block via
        the same _extract_json_object/_request_once path every Claude call
        here shares.

        Own retry policy and per-request timeout: a single call runs several
        server-side search rounds and legitimately takes minutes -- the
        default 15s RetryPolicy and short request_timeout would abort a call
        that's genuinely still working. See config.py's
        claude_websearch_deadline_seconds.

        `max_uses` and the retry count are both sized to the 240s request
        timeout rather than chosen independently, because the first version
        of this stage set them independently and the arithmetic never worked:

          - 8 search rounds cannot finish inside 240s. Measured live
            2026-09-08 on two real thin leads (Martin Godart, Omaima Atef --
            both LinkedIn profiles blocked to Bright Data AND to Parallel's
            browsing agent, which is exactly the case this stage exists for):
            the request hit the 240s timeout BOTH times. Stage 6 has never
            once returned a result. 3 rounds fits the budget, so the stage
            gets a real chance to answer instead of structurally timing out.

          - `retries=1` could never run. One attempt consumes the full 240s
            of a 300s deadline, leaving 60s for an attempt that needs 240s,
            so retry_with_backoff starts it and the deadline kills it
            mid-flight: 10:14:15 start -> 10:18:16 timeout -> 10:19:15
            deadline, 60s spent on a call that could not have finished.
            Dropping it takes the worst case from 300s to 240s and loses
            nothing -- a genuine retry already happens on a LATER pass via
            the `_websearch_fallback: failed_transient:n` marker, which is
            where re-attempts for this stage are actually budgeted.

        Per-lead cost is the whole point: this stage fires only for leads
        every earlier tier came up thin on, so its latency lands entirely on
        the leads that already look slowest to a recruiter watching the row.
        """
        prompt = build_web_search_prompt(missing_fields, full_name, profile_link, source_platform)
        body = {
            "model": _WEB_SEARCH_MODEL,
            "max_tokens": 4096,
            # 3, not 8: see the budget note above -- 8 rounds cannot finish
            # inside `request_timeout` and timed out on every real call.
            "tools": [{"type": "web_search_20260209", "name": "web_search", "max_uses": 3}],
            "messages": [{"role": "user", "content": prompt}],
        }
        # retries=0 -> exactly one attempt. A second one cannot fit inside the
        # deadline (see the budget note above), so allowing it only spent
        # wall-clock on a call guaranteed to be killed mid-flight.
        policy = RetryPolicy(retries=0, deadline_seconds=self.config.claude_websearch_deadline_seconds)
        request_timeout = max(self.config.request_timeout, 240)

        log.info("Claude web_search fallback START name=%r fields=%s", full_name, missing_fields)

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Claude web_search fallback retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, policy.retries, delay, exc,
            )

        try:
            result = retry_with_backoff(
                lambda: self._request_once(body, timeout=request_timeout), policy=policy, on_retry=on_retry
            )
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ClaudeError):
                raise cause from exc
            raise ClaudeError(f"Claude web_search fallback failed after retries: {cause if cause else exc}") from exc

        log.info("Claude web_search fallback SUCCESS name=%r sources=%s", full_name, result.get("sources_used"))
        return result

    def translate_to_english(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Translate an enrichment payload's free text into English, keeping
        its shape and every detail it carries.

        A separate step from extraction on purpose. Asking Parallel to
        extract-and-translate in one pass made it do two jobs at once and
        quietly cost detail -- a phrase awkward to render in English came back
        flattened or missing, with no way to tell afterwards that anything had
        gone. So Parallel extracts faithfully in the profile's own language
        (see providers/parallel_client.py's LeadProfile) and this turns the
        result into English afterwards, which also leaves the original intact
        for the caller to keep alongside.

        Returns the same keys it was given. Raises ClaudeError, which the
        caller treats as "keep the untranslated payload" rather than as a
        failed enrichment -- source-language data is worth much more than no
        data.
        """
        system = (
            "You translate freelance-linguist profile data into English for an English-speaking "
            "recruiting team.\n\n"
            "RULES:\n"
            "- Return a JSON object with EXACTLY the same keys and the same structure as the input. "
            "Same array lengths, same nested object keys. Translate only the human-readable values.\n"
            "- Translate every piece of free text into natural English, preserving ALL detail: every "
            "named client, production, tool, number, date and claim survives the translation. Losing "
            "detail is the one unacceptable outcome -- if a phrase is hard to render, translate it "
            "plainly rather than dropping or summarising it.\n"
            "- Add nothing. Never introduce a fact, a qualifier or an achievement that isn't in the input.\n"
            "- Leave proper nouns exactly as written: company, school, production, brand and product "
            "names are not translated ('Televisió de Catalunya' stays 'Televisió de Catalunya'). "
            "Keep a credential's official name, and add a short English gloss in parentheses only if "
            "the original name alone would be meaningless to an English reader.\n"
            "- Country and language names DO become English ('España' -> 'Spain', 'Español' -> 'Spanish').\n"
            "- Text already in English is returned unchanged, character for character.\n"
            "- Preserve nulls as null and empty arrays as empty arrays. Never fill a gap."
        )
        strict_json_suffix = (
            "\n\nRespond with ONLY the JSON object. No markdown code fences, no preamble, "
            "no commentary. The response must start with '{' and end with '}'."
        )
        body = {
            "model": self.config.claude_model,
            "system": system + strict_json_suffix,
            "messages": [
                {
                    "role": "user",
                    "content": "PROFILE DATA TO TRANSLATE:\n\n"
                    + json.dumps(payload, ensure_ascii=False)[:12000],
                }
            ],
            "temperature": 0.0,
            "max_tokens": 2048,
        }

        log.info("Claude translation request START model=%s", self.config.claude_model)

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Claude translation retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            return retry_with_backoff(lambda: self._request_once(body), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ClaudeError):
                raise cause from exc
            raise ClaudeError(f"Claude translation failed after retries: {cause if cause else exc}") from exc

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
        it. Confirmed live: an "Audio Engineer at VSI / Voice & Script
        International" profile with a fully populated Headline/Current_Title/
        About from Parallel and BrightData still had a completely empty
        Services field, because "Audio Engineer"/"Sound Designer" isn't one
        of the ~15 fixed aliases -- and orchestrator.py's Stage 6 web-search
        fallback never got a chance to fix it either, since that stage is
        gated on overall lead thinness (MAX_FIELDS_BEFORE_WEBSEARCH), not on
        whether Services specifically is still missing.

        Raises ClaudeError on failure -- the caller treats that identically
        to "found nothing": Services stays empty, exactly as if this step
        hadn't run.
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
            "Owner' or 'Operations' do not name a real service on their own)."
        )
        strict_json_suffix = (
            '\n\nRespond with ONLY a JSON object of exactly this shape, no markdown fence, no '
            'commentary: {"services": [<string>, ...]}'
        )
        body = {
            "model": self.config.claude_model,
            "system": system + strict_json_suffix,
            "messages": [{"role": "user", "content": "PROFILE TEXT:\n\n" + profile_text[:6000]}],
            "temperature": 0.0,
            "max_tokens": 512,
        }

        log.info("Claude Services classification request START")

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Claude Services classification retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            result = retry_with_backoff(lambda: self._request_once(body), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ClaudeError):
                raise cause from exc
            raise ClaudeError(f"Claude Services classification failed after retries: {cause if cause else exc}") from exc

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
        Tavily, and Parallel have all had their turn -- reads whatever
        free text the pipeline already has and fills in only what that text
        directly supports, exactly as classify_services already does for
        Services. Deliberately fill-only: only asked about fields the
        caller has already confirmed are empty, and never asked to
        reconsider a field that already has a value from any source
        (enrichment or manual) -- this is purely a gap-filler for what
        nothing else found, not a verification pass over existing data.

        `missing_fields` must be a subset of `_MISSING_FIELD_SPECS`' keys --
        the prompt only ever asks about exactly those, so Claude has no
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
            "- Do not report anything outside the fields listed above, even if the text mentions it."
        )
        strict_json_suffix = (
            f'\n\nRespond with ONLY a JSON object of exactly this shape, no markdown fence, no '
            f'commentary:\n{{\n{schema_lines}\n}}'
        )
        body = {
            "model": self.config.claude_model,
            "system": system + strict_json_suffix,
            "messages": [{"role": "user", "content": "PROFILE TEXT:\n\n" + text[:6000]}],
            "temperature": 0.0,
            "max_tokens": 512,
        }

        log.info("Claude missing-fields extraction request START fields=%s", list(specs.keys()))

        def on_retry(exc: BaseException, attempt: int, delay: float) -> None:
            log.warning(
                "Claude missing-fields extraction retryable failure attempt=%d/%d, retrying in %.1fs (%s)",
                attempt + 1, self.config.max_retries, delay, exc,
            )

        try:
            result = retry_with_backoff(lambda: self._request_once(body), policy=self._policy, on_retry=on_retry)
        except RetryExhaustedError as exc:
            cause = exc.cause
            if isinstance(cause, ClaudeError):
                raise cause from exc
            raise ClaudeError(f"Claude missing-fields extraction failed after retries: {cause if cause else exc}") from exc

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

    def _request_once(self, body: Dict[str, Any], timeout: Optional[int] = None) -> Dict[str, Any]:
        effective_timeout = timeout if timeout is not None else self.config.request_timeout
        try:
            resp = self.session.post(
                self.config.claude_base_url,
                json=body,
                timeout=effective_timeout,
            )
        except requests.exceptions.Timeout as exc:
            raise TransientError(f"Request timed out after {effective_timeout}s") from exc
        except requests.exceptions.RequestException as exc:
            raise TransientError(f"Network error: {exc}") from exc

        if resp.status_code == 429 or resp.status_code >= 500:
            raise TransientError(
                f"HTTP {resp.status_code}: {resp.text[:200]}", status_code=resp.status_code
            )
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            # A 4xx other than 429 means the API rejected this exact request
            # (bad model name, malformed body, auth) -- the same request will
            # fail the same way again, so callers with a re-attempt policy
            # (search_missing_fields) must treat this as permanent, not retry it.
            raise ClaudeError(
                f"Claude LLM call failed: HTTP {resp.status_code}: {resp.text[:200]}", permanent=True
            ) from exc

        data = resp.json()
        content_blocks = data.get("content", [])
        text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
        try:
            result = _extract_json_object(text)
        except json.JSONDecodeError as exc:
            # Malformed JSON from the model is worth one retry (a rare
            # decoding slip, not a hard failure) -- matches the original
            # loop's behavior of catching json.JSONDecodeError as retryable.
            raise TransientError(f"Malformed JSON in Claude response: {exc}") from exc
        log.info("Claude LLM request SUCCESS")
        return result
