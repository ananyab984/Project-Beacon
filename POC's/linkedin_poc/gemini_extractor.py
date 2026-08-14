"""LLM extraction layer (Gemini) over Bright Data's raw LinkedIn JSON.

Extracts EXACTLY two things from a single raw profile object:
  1. years_of_professional_experience
  2. contact_information (emails / phones / websites / other)

Hard anti-hallucination design:
  * temperature = 0, response_mime_type = application/json (deterministic JSON).
  * The prompt forbids guessing, inferring, computing from dates, or using
    outside knowledge. Anything not explicitly present -> null / empty.
  * The model must return the EXACT quoted substring that supports each value.
    If it cannot quote it from the data, it must return null. We additionally
    verify that quoted evidence actually appears in the raw payload and null
    out anything that doesn't (belt-and-suspenders against fabrication).

Uses the REST API so no extra SDK dependency is required.
"""

from __future__ import annotations

import json
import os
import re
import time

import requests

from logger import get_logger

log = get_logger(__name__)

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Big / irrelevant fields removed before sending (save tokens, no contact/exp signal).
_STRIP_KEYS = {
    "avatar", "default_avatar", "banner_image", "people_also_viewed",
    "similar_profiles", "linkedin_num_id", "memorialized_account", "influencer",
}

_INSTRUCTION = """You are a STRICT information-extraction system. You are given RAW scraped \
LinkedIn profile data as JSON. Extract EXACTLY two things and nothing else:

1. years_of_professional_experience: the total number of years of professional/work \
experience, ONLY if it is EXPLICITLY stated as text somewhere in the data (for example an \
"about"/summary sentence such as "over 30 years of experience", or a headline that states \
a number of years).

2. contact_information: any contact details that are EXPLICITLY present in the data — email \
addresses, phone numbers, personal or company websites, booking/scheduling links.

STRICT RULES — follow all of them:
- Return ONLY information that is explicitly present in the provided JSON.
- Do NOT guess, infer, estimate, compute, or fabricate anything.
- Do NOT calculate years of experience from start/end dates, education years, role \
durations, or the current date. If a number of years of experience is not explicitly \
written in words in the text, return null for it.
- Do NOT invent, complete, or normalize emails/phones/websites. Only report ones that \
appear verbatim in the data. If none are present, return empty lists.
- Do NOT use any outside knowledge.
- For every non-null value you return, include the EXACT verbatim substring from the data \
that supports it. If you cannot quote it directly from the data, return null instead.

Respond with STRICT JSON exactly matching this schema (no extra keys, no prose):
{
  "years_of_professional_experience": <integer or null>,
  "years_experience_evidence": <exact verbatim quote from the data, or null>,
  "contact_information": {
    "emails": [<string>, ...],
    "phones": [<string>, ...],
    "websites": [<string>, ...],
    "other": [<string>, ...]
  },
  "contact_evidence": <short note quoting where contact info was found, or null>
}
"""


class GeminiExtractor:
    def __init__(self, api_key: str | None = None, model: str | None = None,
                 timeout: int = 60, max_retries: int = 4):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is not set in the environment / .env")
        # gemini-flash-latest works on the free tier; 2.0-flash exhausts its
        # daily free quota quickly. Override with GEMINI_MODEL in .env if needed.
        self.model = model or os.getenv("GEMINI_MODEL", "").strip() or "gemini-flash-latest"
        self.timeout = timeout
        self.max_retries = max_retries

    def _slim(self, profile: dict) -> dict:
        return {k: v for k, v in profile.items() if k not in _STRIP_KEYS}

    @staticmethod
    def _retry_delay(resp: requests.Response, attempt: int) -> float:
        """Prefer the server's RetryInfo.retryDelay; else exponential backoff."""
        try:
            for d in resp.json().get("error", {}).get("details", []):
                if "RetryInfo" in d.get("@type", "") and d.get("retryDelay"):
                    m = re.match(r"([\d.]+)s", str(d["retryDelay"]))
                    if m:
                        return float(m.group(1)) + 1
        except (ValueError, KeyError):
            pass
        return min(2 ** attempt, 30)

    def extract(self, profile: dict) -> dict:
        """Call Gemini on one profile dict; return the validated extraction dict."""
        payload_json = json.dumps(self._slim(profile), ensure_ascii=False)
        body = {
            "contents": [{"parts": [
                {"text": _INSTRUCTION},
                {"text": "RAW PROFILE JSON:\n" + payload_json},
            ]}],
            "generationConfig": {
                "temperature": 0,
                "response_mime_type": "application/json",
            },
        }
        url = GEMINI_ENDPOINT.format(model=self.model)

        resp = None
        for attempt in range(self.max_retries + 1):
            resp = requests.post(url, params={"key": self.api_key}, json=body, timeout=self.timeout)
            # Retry transient failures: 429 (rate limit) and 5xx (overloaded).
            if resp.status_code != 429 and resp.status_code < 500:
                break
            if attempt == self.max_retries:
                raise RuntimeError(f"Gemini HTTP {resp.status_code} after {self.max_retries} retries: {resp.text[:200]}")
            delay = self._retry_delay(resp, attempt)
            log.warning("Gemini %d (transient); retry %d/%d after %.0fs",
                        resp.status_code, attempt + 1, self.max_retries, delay)
            time.sleep(delay)

        if resp.status_code != 200:
            raise RuntimeError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

        data = resp.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as exc:
            raise RuntimeError(f"Unexpected Gemini response: {json.dumps(data)[:300]}") from exc

        try:
            result = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Gemini did not return valid JSON: {text[:300]}") from exc

        return self._verify_against_source(result, payload_json)

    @staticmethod
    def _verify_against_source(result: dict, source_json: str) -> dict:
        """Belt-and-suspenders: null out any value whose evidence isn't in the source."""
        src = source_json.lower()

        # Years: require the evidence quote to actually appear in the raw data.
        ev = result.get("years_experience_evidence")
        if result.get("years_of_professional_experience") is not None:
            if not ev or ev.strip().lower() not in src:
                log.warning("Dropping years=%s: evidence not found verbatim in source (%r)",
                            result.get("years_of_professional_experience"), ev)
                result["years_of_professional_experience"] = None
                result["years_experience_evidence"] = None

        # Contact: keep only items that appear verbatim in the raw data.
        ci = result.get("contact_information") or {}
        for field in ("emails", "phones", "websites", "other"):
            items = ci.get(field) or []
            kept = [x for x in items if isinstance(x, str) and x.strip().lower() in src]
            dropped = [x for x in items if x not in kept]
            if dropped:
                log.warning("Dropping unverifiable %s: %s", field, dropped)
            ci[field] = kept
        result["contact_information"] = ci
        return result
