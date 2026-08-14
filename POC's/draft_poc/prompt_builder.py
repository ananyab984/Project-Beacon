"""Prompt builder — the layer that turns an enriched Lead into channel prompts.

Personalization strategy = "personalize within the template": the model keeps
Global3's structure, links and sign-off, and only tailors the opening + phrasing
to the specific linguist using the provided facts. It is forbidden from
inventing anything not present in those facts (anti-hallucination).
"""

from __future__ import annotations

from leads import Lead

# --- Brand constants (single source of truth for every draft) ---------------
BRAND = {
    "company": "Global3",
    "site": "global3.io",
    "apply_url": "https://app.global3.io/apply",
    "contact_email": "resources@global3.io",
    "email_sign_off": "Best regards,\nResources Team",
    "team": "Resource Management team at Global3",
}

# Hard length guidance surfaced to the model (the evaluator enforces the caps).
LINKEDIN_CHAR_TARGET = "STRICTLY under 280 characters total (LinkedIn connection note hard cap is 300 characters)"
EMAIL_WORD_TARGET = "roughly 120-180 words"

# --- Shared brand-voice + anti-hallucination rules --------------------------
_VOICE_RULES = f"""You write outreach for {BRAND['company']}, a company that builds long-term
partnerships with freelance linguists (translators, subtitlers, audio-description
specialists, etc.). Voice: warm, professional, respectful, concise. No hype, no
salesy buzzwords, no exaggerated claims.

STRICT RULES:
- Use ONLY the facts provided in LEAD FACTS. Do NOT invent achievements, employers,
  projects, credentials, or numbers.
- Ground all personalization directly in listed attributes (e.g., 'your work in Audio Description',
  'your background in English and Polish', 'your 16 years of experience'). Do NOT add unstated
  subjective titles like 'renowned expert' or 'master specialist'.
- Keep {BRAND['company']}'s structure, links and sign-off intact:
  site {BRAND['site']}, apply portal {BRAND['apply_url']}.
- Exactly ONE clear, low-friction call to action.
- Return STRICT JSON only — no markdown, no commentary outside the JSON."""

# --- Few-shot exemplars (the user's real, approved templates) ---------------
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
    "Hi [Name], we noticed your background in [language/service] and would love to introduce you to "
    f"{BRAND['company']}. Learn more at {BRAND['site']} and apply to partner with us here: {BRAND['apply_url']}"
)


def _facts_block(lead: Lead) -> str:
    """Render the lead's grounding facts as a compact, labeled block."""
    lines = [f"- {k}: {v}" for k, v in lead.grounding_facts().items()]
    return "\n".join(lines)


def build_email_prompt(lead: Lead) -> tuple[str, str]:
    """Return (system, user) prompts for a long-form email draft."""
    system = _VOICE_RULES
    user = f"""Write a personalized outreach EMAIL to this freelance linguist.

LEAD FACTS (the only facts you may use):
{_facts_block(lead)}

CHANNEL: Email (long-form, {EMAIL_WORD_TARGET}).
Must include: a personalized opening mentioning their language or service, {BRAND['site']}, the apply portal
link {BRAND['apply_url']}, the contact {BRAND['contact_email']}, and the sign-off "Resources Team".

STRUCTURE TO FOLLOW:
---
{_EMAIL_EXEMPLAR}
---

Return STRICT JSON exactly:
{{"subject": "<a specific, 2-6 word subject line>", "body": "<the email body>"}}"""
    return system, user


def build_linkedin_prompt(lead: Lead) -> tuple[str, str]:
    """Return (system, user) prompts for a short LinkedIn draft."""
    system = _VOICE_RULES
    user = f"""Write a personalized outreach LINKEDIN connection note to this freelance linguist.

LEAD FACTS (the only facts you may use):
{_facts_block(lead)}

CHANNEL: LinkedIn connection note ({LINKEDIN_CHAR_TARGET}).
CRITICAL REQUIREMENT: Total text length MUST NOT EXCEED 270 CHARACTERS. No subject line.

STRUCTURE TO FOLLOW (keep it concise and within character limit):
---
{_LINKEDIN_EXEMPLAR}
---

Return STRICT JSON exactly:
{{"body": "<the LinkedIn message under 270 chars>"}}"""
    return system, user

