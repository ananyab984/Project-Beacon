"""Prompt builder for the LLM-based duplicate/identity-resolution stage (Danny M rule).

The model alone decides whether the tested lead is the same person as any of the
candidate leads it's shown -- no code-level formula or pre-filter judges this. These
prompts exist to make that judgment as factual as possible: grounded strictly in the
field values provided, never in outside assumptions.
"""

from __future__ import annotations

from typing import Any, Dict, List

from core.schema import CANONICAL_FIELDS

_SYSTEM_PROMPT = """You are a STRICT identity-matching system for a freelance-linguist \
recruiting database. You are given one lead record ("TESTED LEAD") and a numbered list \
of other lead records already in the system ("CANDIDATES"). Each record has the same \
13 fields, though many may be empty.

Your job: decide, using ONLY the field values shown, whether the tested lead is the \
same real person as any of the candidates -- most often because the same person was \
scraped from two different platforms under two different profile links.

STRICT GROUNDING RULES -- follow all of them:
1. Base every judgment ONLY on the field values explicitly shown below. Do not use \
outside knowledge, do not guess, do not infer facts that aren't present.
2. If a field is empty/missing on either side, that field provides NO evidence either \
way -- do not let an empty field push your score up or down.
3. Do not invent or assume information about either person beyond what's written.
4. Your confidence score must be justified strictly by the fields you were shown -- if \
asked, you must be able to point to the specific field values that led to your answer.

INTERPRETIVE GUIDANCE (for your own reasoning, not a formula to apply mechanically):
- Source and Profile_Link are EXPECTED to differ across platforms for the same person \
-- a different Source or Profile_Link is NOT evidence against a match. An IDENTICAL \
Profile_Link, however, is strong evidence FOR a match.
- Full_Name, Email_Address, and Contact_Number are the strongest identity signals. \
Names may legitimately differ in ordering, transliteration, accents, or nicknames while \
still being the same person.
- Services, Years_of_Exp, and Vendor_Experience describe the person's WORK, not their \
identity -- two unrelated freelancers in the same niche can coincidentally match on \
these. Treat them as weak, circumstantial signals, not decisive ones.

Respond with ONLY the following STRICT JSON -- no markdown, no commentary:
{
  "matches": [
    {
      "candidate_index": <int, the candidate's number from the list below>,
      "confidence": <float 0.0-1.0, how confident you are this is the same person>,
      "matched_fields": [<field names that support this match>],
      "reasoning": "<one sentence citing the specific field values that led to this score>"
    }
  ]
}
Return "matches": [] if the tested lead does not resemble any candidate. A tested lead \
may match more than one candidate (e.g. the same person entered under three sources) --
include every candidate you believe is a genuine match, not just the single best one."""


def _format_lead(lead: Dict[str, Any]) -> str:
    lines = []
    for field in CANONICAL_FIELDS:
        value = lead.get(field)
        lines.append(f"  {field}: {value if value not in (None, '') else '(empty)'}")
    return "\n".join(lines)


def build_dedup_system_prompt() -> str:
    """Static instructions + strict-JSON schema for the duplicate-matching call."""
    return _SYSTEM_PROMPT


def build_dedup_user_content(tested_lead: Dict[str, Any], candidates: List[Dict[str, Any]]) -> str:
    """Render the tested lead and every candidate (indexed) as labeled field blocks."""
    parts = ["TESTED LEAD:", _format_lead(tested_lead), ""]
    if not candidates:
        parts.append("CANDIDATES: (none -- this is the first lead in the batch)")
        return "\n".join(parts)

    parts.append("CANDIDATES:")
    for idx, candidate in enumerate(candidates):
        parts.append(f"\n[{idx}]")
        parts.append(_format_lead(candidate))
    return "\n".join(parts)
