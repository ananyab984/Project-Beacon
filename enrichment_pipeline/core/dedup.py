"""Batch-scoped duplicate / identity-resolution candidate detection (the "Danny M rule" stage).

Multi-stage filtering pipeline, cheapest/most-certain checks first:

  1. Exact match (email or phone, normalized) -> immediate duplicate, no AI call.
  2. Blocking -- cheap name-prefix/email-domain filtering narrows the remaining prior
     leads down to a shortlist (default cap: 20) worth a closer look.
  3. Semantic narrowing -- name/email-username similarity scoring ranks that shortlist
     and keeps only the top candidates (default cap: 10).
  4. AI judgment -- Groq sees ONLY that narrowed shortlist (never the whole batch) and
     makes the actual same-person decision with its own confidence score.
  5. Threshold -- a match is flagged only if the LLM's own confidence >= the configured
     threshold.

Stages 1-3 are deterministic candidate GENERATION (which leads are even worth asking
about) -- they never decide duplicate-or-not themselves. Stage 4 is the only place the
duplicate/not-duplicate judgment is made, and it's made entirely by the model. Never
merges or mutates leads -- only flags candidates for a human to resolve later.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple, TypedDict

from config import Config, load_config
from core.dedup_client import DedupGroqClient, DedupGroqError
from core.schema import is_empty_value
from logger import get_logger

log = get_logger(__name__)

# Step 2 -- blocking: cap the shortlist before spending any similarity scoring on it.
BLOCKING_MAX_CANDIDATES = 20
# Step 3 -- semantic narrowing: cap the shortlist actually shown to the LLM.
NARROWING_MAX_CANDIDATES = 10
# Step 2 -- how many leading characters of a normalized name token must match to block-in.
NAME_PREFIX_LEN = 4


class DuplicateCandidate(TypedDict):
    lead_a_index: int
    lead_b_index: int
    lead_a: Dict[str, Any]
    lead_b: Dict[str, Any]
    match_score: float
    threshold_used: float
    match_reason: str  # "exact_match" | "llm_judgment"
    matched_fields: List[str]
    reasoning: str
    flagged_for_review: bool
    resolution: Dict[str, Any]


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _normalize_text(v: Any) -> str:
    return re.sub(r"\s+", " ", _strip_accents(str(v)).strip().casefold())


def _normalize_email(v: Any) -> str:
    return _normalize_text(v) if not is_empty_value(v) else ""


def _normalize_phone(v: Any) -> str:
    return re.sub(r"[^\d]", "", str(v)) if not is_empty_value(v) else ""


def _email_username(v: Any) -> str:
    email = _normalize_email(v)
    return email.split("@")[0] if "@" in email else email


def _name_tokens(lead: Dict[str, Any]) -> Tuple[str, str]:
    """Best-effort (first, last) name tokens. No dedicated last-name field exists in the
    13-field schema, so last name is derived from the last token of Full_Name -- fine for
    blocking (a coarse, high-recall step), not precise enough to persist or trust alone.
    """
    first = _normalize_text(lead.get("First_Name")) if not is_empty_value(lead.get("First_Name")) else ""
    full = _normalize_text(lead.get("Full_Name")) if not is_empty_value(lead.get("Full_Name")) else ""
    full_parts = full.split()
    if not first and full_parts:
        first = full_parts[0]
    last = full_parts[-1] if len(full_parts) > 1 else ""
    return first, last


def _name_similarity(lead_a: Dict[str, Any], lead_b: Dict[str, Any]) -> float:
    """Accent/case/whitespace-insensitive full-name similarity, tolerant of token reordering."""
    a = _normalize_text(lead_a.get("Full_Name")) if not is_empty_value(lead_a.get("Full_Name")) else ""
    b = _normalize_text(lead_b.get("Full_Name")) if not is_empty_value(lead_b.get("Full_Name")) else ""
    if not a or not b:
        return 0.0
    direct = difflib.SequenceMatcher(None, a, b).ratio()
    reordered = difflib.SequenceMatcher(None, " ".join(sorted(a.split())), " ".join(sorted(b.split()))).ratio()
    return max(direct, reordered)


def _email_username_similarity(lead_a: Dict[str, Any], lead_b: Dict[str, Any]) -> float:
    a, b = _email_username(lead_a.get("Email_Address")), _email_username(lead_b.get("Email_Address"))
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _find_exact_matches(tested_lead: Dict[str, Any], prior_leads: List[Dict[str, Any]]) -> List[Tuple[int, str]]:
    """Step 1: exact (normalized) email or phone match. Returns [(prior_index, matched_field)]."""
    hits: List[Tuple[int, str]] = []
    tested_email = _normalize_email(tested_lead.get("Email_Address"))
    tested_phone = _normalize_phone(tested_lead.get("Contact_Number"))
    for j, candidate in enumerate(prior_leads):
        if tested_email and tested_email == _normalize_email(candidate.get("Email_Address")):
            hits.append((j, "Email_Address"))
        elif tested_phone and tested_phone == _normalize_phone(candidate.get("Contact_Number")):
            hits.append((j, "Contact_Number"))
    return hits


def _block_candidates(tested_lead: Dict[str, Any], prior_leads: List[Dict[str, Any]], exclude: set) -> List[int]:
    """Step 2: cheap name-prefix/email-domain filter. Returns prior-list indices, capped."""
    t_first, t_last = _name_tokens(tested_lead)
    t_email_domain = _normalize_email(tested_lead.get("Email_Address")).split("@")[-1] if "@" in _normalize_email(tested_lead.get("Email_Address")) else ""

    blocked: List[int] = []
    for j, candidate in enumerate(prior_leads):
        if j in exclude:
            continue
        c_first, c_last = _name_tokens(candidate)
        prefix_hit = (
            (t_first and c_first and t_first[:NAME_PREFIX_LEN] == c_first[:NAME_PREFIX_LEN])
            or (t_last and c_last and t_last[:NAME_PREFIX_LEN] == c_last[:NAME_PREFIX_LEN])
        )
        domain_hit = False
        if t_email_domain:
            c_email = _normalize_email(candidate.get("Email_Address"))
            domain_hit = "@" in c_email and c_email.split("@")[-1] == t_email_domain
        if prefix_hit or domain_hit:
            blocked.append(j)
        if len(blocked) >= BLOCKING_MAX_CANDIDATES:
            break
    return blocked


def _narrow_candidates(tested_lead: Dict[str, Any], prior_leads: List[Dict[str, Any]], blocked_indices: List[int]) -> List[int]:
    """Step 3: rank the blocked set by name/email-username similarity, keep the top few."""
    scored = [
        (j, max(_name_similarity(tested_lead, prior_leads[j]), _email_username_similarity(tested_lead, prior_leads[j])))
        for j in blocked_indices
    ]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [j for j, _score in scored[:NARROWING_MAX_CANDIDATES]]


def find_duplicate_candidates(
    leads: List[Dict[str, Any]],
    threshold: float = 0.8,
    client: Optional[DedupGroqClient] = None,
    config: Optional[Config] = None,
) -> List[DuplicateCandidate]:
    """For each lead (from the 2nd onward): exact-match short-circuit, then block + narrow
    the remaining prior leads to a small shortlist, then ask Groq to judge only that
    shortlist. `client`/`config` are injectable for testing.
    """
    need_client = None  # lazily constructed only if a non-exact-match shortlist ever needs it

    def _get_client() -> Optional[DedupGroqClient]:
        nonlocal need_client
        if client is not None:
            return client
        if need_client is None:
            cfg = config or load_config(require_keys=False)
            if not cfg.groq_api_key:
                log.info("Duplicate-detection AI stage skipped: GROQ_API_KEY not configured")
                need_client = False
            else:
                need_client = DedupGroqClient(cfg)
        return need_client or None

    candidates: List[DuplicateCandidate] = []

    for i in range(1, len(leads)):
        tested_lead = leads[i]
        prior_leads = leads[0:i]

        # Step 1: exact match -- immediate flag, no AI.
        exact_hits = _find_exact_matches(tested_lead, prior_leads)
        for j, field in exact_hits:
            candidates.append({
                "lead_a_index": i, "lead_b_index": j,
                "lead_a": tested_lead, "lead_b": prior_leads[j],
                "match_score": 1.0, "threshold_used": threshold, "match_reason": "exact_match",
                "matched_fields": [field],
                "reasoning": f"Exact match on {field} (normalized).",
                "flagged_for_review": True,
                "resolution": {"resolved": False, "resolution_type": None, "resolved_by": None, "resolved_at": None},
            })

        # Step 2: blocking (excludes leads already resolved as exact matches).
        exact_indices = {j for j, _field in exact_hits}
        blocked = _block_candidates(tested_lead, prior_leads, exclude=exact_indices)
        if not blocked:
            continue  # nothing plausible left -- no AI call for this lead

        # Step 3: semantic narrowing to the final shortlist.
        shortlist_indices = _narrow_candidates(tested_lead, prior_leads, blocked)
        if not shortlist_indices:
            continue

        groq_client = _get_client()
        if not groq_client:
            continue  # no key configured; exact-match results above still stand

        shortlist_leads = [prior_leads[j] for j in shortlist_indices]

        # Step 4: AI judgment on the shortlist only.
        try:
            response = groq_client.find_matches(tested_lead, shortlist_leads)
        except DedupGroqError as exc:
            log.error("Duplicate AI check failed for lead index %d: %s", i, exc)
            continue

        for match in response.get("matches") or []:
            try:
                shortlist_position = int(match["candidate_index"])
                confidence = float(match["confidence"])
            except (KeyError, TypeError, ValueError) as exc:
                log.warning("Skipping malformed match entry for lead index %d: %s (%s)", i, match, exc)
                continue

            if not (0 <= shortlist_position < len(shortlist_indices)):
                log.warning("Skipping match with out-of-range candidate_index=%s for lead index %d", shortlist_position, i)
                continue

            # Step 5: threshold on the LLM's own confidence.
            if confidence < threshold:
                continue

            original_index = shortlist_indices[shortlist_position]
            candidates.append({
                "lead_a_index": i, "lead_b_index": original_index,
                "lead_a": tested_lead, "lead_b": prior_leads[original_index],
                "match_score": confidence, "threshold_used": threshold, "match_reason": "llm_judgment",
                "matched_fields": match.get("matched_fields") or [],
                "reasoning": match.get("reasoning") or "",
                "flagged_for_review": True,
                "resolution": {"resolved": False, "resolution_type": None, "resolved_by": None, "resolved_at": None},
            })

    return candidates
