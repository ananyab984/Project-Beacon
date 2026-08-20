"""Prompt builder — personalizes the two approved templates using the lead's
real enriched data, never inventing facts beyond what's already known.

Personalization strategy: "personalize within the template": the model keeps
Global3's structure, links and sign-off, and only tailors the opening +
phrasing to the specific linguist using the facts actually provided.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from core.leads import Lead

# --- Brand constants (single source of truth for every draft) ---------------
BRAND = {
    "company": "Global3",
    "site": "global3.io",
    "apply_url": "https://app.global3.io/apply",
    "contact_email": "resources@global3.io",
    "email_sign_off": "Best regards,\nResources Team",
    "team": "Resource Management team at Global3",
}

LINKEDIN_CHAR_TARGET = "STRICTLY under 200 characters total (LinkedIn connection note hard cap on free accounts)"
EMAIL_WORD_TARGET = "roughly 120-180 words"

# --- Shared brand-voice + anti-hallucination rules --------------------------
_VOICE_RULES = f"""You write outreach for {BRAND['company']}, a company that builds long-term
partnerships with freelance linguists (translators, subtitlers, audio-description
specialists, etc.). Voice: warm, professional, respectful, concise. No hype, no
salesy buzzwords, no exaggerated claims.

STRICT RULES:
- Use ONLY the facts provided in LEAD FACTS below. Do NOT invent achievements, employers,
  projects, credentials, rates, or numbers that are not explicitly listed there.
- HARD REQUIREMENT — specificity: if LEAD FACTS contains any concrete, named detail --
  tools_software, certifications, current_title, headline, or a named company inside
  current_role_or_company -- the opening MUST name at least one of them explicitly.
  A draft that only paraphrases generically ("your experience in subtitling") when a
  specific tool, employer, or certification is available in LEAD FACTS is NOT acceptable.
  Weak (do not do this): "believe your background in subtitling would be a strong asset."
  Strong (do this instead): "particularly your hands-on experience with OOONA and WinCaps
  at Sfera Studios." Prefer the specific named fact over the generic category whenever
  one is present.
- If LEAD FACTS includes years of experience, services, languages, country, current
  role/company, or the specificity facts above, weave the ones that are actually present
  naturally into the opening -- do not list every fact mechanically, and do not mention a
  fact that is not in LEAD FACTS.
- about_snippet, when present, is background context for tone/angle only -- pull at most
  one short specific phrase from it if useful; never quote it at length.
- If a fact is absent from LEAD FACTS, simply don't mention it -- never guess, estimate,
  or use a generic placeholder in its place.
- NEVER fabricate, invent, or guess a rate figure. Rates are cited ONLY if provided in RATE CONTEXT.
  If RATE CONTEXT says 'No rate card match', do NOT mention any specific rate numbers or pricing figures.
- Keep {BRAND['company']}'s structure, links and sign-off intact:
  site {BRAND['site']}, apply portal {BRAND['apply_url']}.
- Exactly ONE clear, low-friction call to action.
- Before returning, verify: (1) at least one concrete named fact is used if one exists in
  LEAD FACTS, (2) no invented facts, (3) exactly one CTA, (4) structure/links/sign-off intact.
- Return STRICT JSON only — no markdown, no commentary outside the JSON."""

# --- Approved reference templates (the pattern every draft must follow) -----
_EMAIL_EXEMPLAR = (
    "Hi [Name],\n\nI hope this email finds you well.\n\n"
    f"I'm reaching out from the {BRAND['team']}. We recently reviewed your profile "
    "and believe your background in [language/service] would be a strong asset to our current and upcoming "
    "project pipelines.\n\nWe are actively looking to connect with talented freelance "
    "linguists who value long-term, meaningful collaboration over one-off "
    f"tasks. At {BRAND['company']}, we pride ourselves on building lasting partnerships "
    f"with our global network of professionals. You can find more details about our "
    f"mission and the scope of our work at {BRAND['site']}.\n\nIf you are open to "
    f"exploring a partnership, please submit your application through our portal so we "
    f"can align your profile with relevant opportunities: {BRAND['apply_url']}\n\n"
    f"Should you have any questions before applying, feel free to reach out to us at "
    f"{BRAND['contact_email']}.\n\n{BRAND['email_sign_off']}"
)

_LINKEDIN_EXEMPLAR = (
    "Hi [Name], noticed your [X yrs] in [language/service] -- we'd love to have you at "
    f"{BRAND['company']}. Apply here: {BRAND['apply_url']}"
)


def _facts_block(lead: Lead) -> str:
    """Render the lead's grounding facts as a compact, labeled block -- this
    is the ONLY data the model is given, and it already includes every real
    enriched field the Lead record has (years of experience, services,
    languages, country, current role/company) via Lead.grounding_facts()."""
    lines = [f"- {k}: {v}" for k, v in lead.grounding_facts().items()]
    return "\n".join(lines)


def _rate_block(rate_match: Optional[Dict[str, Any]]) -> str:
    if rate_match:
        return f"- Validated Rate Card: {rate_match.get('currency', 'USD')} ${rate_match.get('rate')} {rate_match.get('unit', 'per word')}"
    return "- Rate Context: No rate card match (Do NOT mention any dollar amount or rate figure)"


def build_email_prompt(lead: Lead, rate_match: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    """Return (system, user) prompts for a long-form email draft."""
    system = _VOICE_RULES
    user = f"""Write a personalized outreach EMAIL to this freelance linguist.

LEAD FACTS (the only facts you may use):
{_facts_block(lead)}

RATE CONTEXT:
{_rate_block(rate_match)}

CHANNEL: Email (long-form, {EMAIL_WORD_TARGET}).
Must include: a personalized opening naturally referencing whichever LEAD FACTS are
present (language, services, years of experience, current role/company -- only the
ones actually listed above), {BRAND['site']}, the apply portal link {BRAND['apply_url']},
the contact {BRAND['contact_email']}, and the sign-off "Resources Team". If LEAD FACTS
contains a concrete named detail (tools_software, certifications, current_title,
headline, or a company name), the opening must name at least one of them -- not only
the broad service category.

PATTERN TO FOLLOW (this is the approved structure -- match its shape, tone, links,
and sign-off; personalize the opening sentence with the real LEAD FACTS instead of
the bracketed placeholders):
---
{_EMAIL_EXEMPLAR}
---

Return STRICT JSON exactly:
{{"subject": "<a specific, 2-6 word subject line>", "body": "<the email body>"}}"""
    return system, user


def build_linkedin_prompt(lead: Lead, rate_match: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    """Return (system, user) prompts for a short LinkedIn draft."""
    system = _VOICE_RULES
    user = f"""Write a personalized outreach LINKEDIN connection note to this freelance linguist.

LEAD FACTS (the only facts you may use):
{_facts_block(lead)}

RATE CONTEXT:
{_rate_block(rate_match)}

CHANNEL: LinkedIn connection note ({LINKEDIN_CHAR_TARGET}).
CRITICAL REQUIREMENT: Total text length MUST NOT EXCEED 200 CHARACTERS, including the
apply link. No subject line.

PRIORITY (in order, given the tight character budget): 1) years of experience, if
present, MUST be worked into the note (e.g. "10 yrs in Dubbing") even briefly -- this is
the single most important fact to keep if something has to be cut for length; 2) if room
remains, prefer naming ONE concrete detail (a tool from tools_software, a certification,
or current_title) over a generic service category -- e.g. "10 yrs, OOONA-certified"
beats "10 yrs in subtitling" when both fit; 3) generic service category last, only if
there's still room. Prefer short numerals/abbreviations ("10 yrs", "German dubbing")
over full sentences to stay under the cap.

PATTERN TO FOLLOW (this is the approved structure -- match its shape and links;
personalize using the real LEAD FACTS instead of the bracketed placeholders,
trimming filler words rather than dropping the years-of-experience fact):
---
{_LINKEDIN_EXEMPLAR}
---

Return STRICT JSON exactly:
{{"body": "<the LinkedIn message, STRICTLY under 200 chars total>"}}"""
    return system, user
