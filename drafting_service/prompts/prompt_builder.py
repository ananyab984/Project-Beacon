"""Prompt builder — personalizes the two approved templates using the lead's
real enriched data, never inventing facts beyond what's already known.

Personalization strategy: "personalize within the template": the model keeps
Global3's structure, links and sign-off, and only tailors the opening +
phrasing to the specific linguist using the facts actually provided.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple

from core.leads import Lead

# Generous but bounded -- this is a raw JSON dump of everything Clay returned,
# not curated prose, so it can legitimately run a few KB for a lead with a
# long work history. Capped so one unusually large profile can't blow the
# request; the curated grounding_facts() above already carries the highest-
# value specifics regardless, so truncation here only loses secondary detail.
_MAX_CLAY_BLOCK_CHARS = 6000

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
- NEVER splice two separate facts into one compound claim that isn't actually true. Each
  LEAD FACTS entry describes ONE thing -- current_title is their role NOW, recent_experience
  lists PAST roles at PAST employers. Do not attach current_title to a company name from
  recent_experience, or vice versa, unless a single fact entry states both together. Example
  of what NOT to do: current_title says "Sr. Project Coordinator" and recent_experience says
  "Project Manager at Acme Inc" -- writing "your background as Sr. Project Coordinator at
  Acme Inc" is FABRICATION even though both halves are individually true facts, because that
  exact pairing was never stated. If in doubt, keep facts in their own separate sentences
  rather than merging them into one claim.
- HARD REQUIREMENT — specificity: if LEAD FACTS contains any concrete, named detail --
  tools_software, certifications, current_title, headline, or a named company inside
  current_role_or_company -- the opening MUST name at least one of them explicitly.
  A draft that only paraphrases generically ("your experience in subtitling") when a
  specific tool, employer, or certification is available in LEAD FACTS is NOT acceptable.
  Weak (do not do this): "believe your background in subtitling would be a strong asset."
  Strong (do this instead): "particularly your hands-on experience with OOONA and WinCaps
  at Sfera Studios." Prefer the specific named fact over the generic category whenever
  one is present.
- recent_experience is the HIGHEST-VALUE source of specificity when present: each entry
  after the colon is a real excerpt from that person's own profile, and it names actual
  productions, clients, publications, technologies, ratings, or named projects -- not
  generic category words. The role title and company name are the WEAKEST part of this
  fact -- the text after the colon is where the real specificity lives, and it MUST be
  mined, not just the company name. Naming only the employer ("your experience at Absolute
  Translations") when the excerpt also contains something more distinctive ("360° language
  services," "Trustpilot rating of 4.8," "legal document translation") is NOT acceptable --
  pull the single most impressive or distinctive claim, number, or named detail out of the
  excerpt itself. Weak: "your work in dubbing and voice acting" or "your experience at
  Acme Inc." Also weak (company name only, ignoring richer detail that was available):
  "your background at Absolute Translations." Strong: "your voice work for Paramount
  Pictures' Kung Fu Panda," "the 800+ scripts you translated for National Geographic
  Channel Bengali," or "Absolute Translations' 4.8 Trustpilot rating in legal
  document translation." This is what shows the lead we actually looked at their real
  background, not a template. Still never add detail beyond what recent_experience
  literally states -- pick from what's there, don't embellish it.
  education's field_of_study (e.g. "Media Management") is a secondary source of the same
  kind of specific, named detail when recent_experience isn't available or is thin.
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


def _dump_capped(data: Any) -> str:
    dumped = json.dumps(data, indent=2, ensure_ascii=False, default=str)
    if len(dumped) > _MAX_CLAY_BLOCK_CHARS:
        return dumped[:_MAX_CLAY_BLOCK_CHARS] + "\n... (truncated -- rely on LEAD FACTS above for anything cut off here)"
    return dumped


def _full_raw_data_block(lead: Lead) -> str:
    """Every raw enrichment payload this lead has, verbatim, labeled by
    source -- on top of the curated grounding_facts() above, not instead of
    it. Covers BOTH Clay's "Enrich person" data and the primary scrape
    (Bright Data for LinkedIn, Tavily for ProZ/ATA/etc.), so the model can
    mine anything not explicitly modeled by the Lead dataclass (connections,
    volunteering, structured_location, a raw about/experience field the
    curated facts summarized, etc.) rather than a code-level decision in
    advance about what counts as relevant. Still governed by the same
    anti-fabrication rule in _VOICE_RULES -- only reference what's literally
    present here, never infer or embellish.
    """
    sections = []
    if lead.clay_full_data:
        sections.append(f"--- From Clay ---\n{_dump_capped(lead.clay_full_data)}")
    if lead.raw_scrape_data:
        sections.append(f"--- From the primary scrape (Bright Data/Tavily) ---\n{_dump_capped(lead.raw_scrape_data)}")
    if not sections:
        return "(none -- no additional raw enrichment data available for this lead)"
    return "\n\n".join(sections)


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

ADDITIONAL RAW PROFILE DATA (every enrichment source for this lead, raw and
supplementary -- same rule applies: only reference what's literally present
here, never infer or embellish beyond it. LEAD FACTS above is the pre-vetted
primary source; treat this as a place to find ONE more specific, distinctive
detail if LEAD FACTS didn't already give you enough to satisfy the
specificity requirement below -- not a mandate to use everything in it):
{_full_raw_data_block(lead)}

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

ADDITIONAL RAW PROFILE DATA (every enrichment source for this lead, raw and
supplementary -- same rule applies: only reference what's literally present
here, never infer or embellish beyond it. Given the tight character budget,
only pull from this if it contains something more distinctive than what's
already in LEAD FACTS):
{_full_raw_data_block(lead)}

RATE CONTEXT:
{_rate_block(rate_match)}

CHANNEL: LinkedIn connection note ({LINKEDIN_CHAR_TARGET}).
CRITICAL REQUIREMENT: Total text length MUST NOT EXCEED 200 CHARACTERS, including the
apply link. No subject line.

PRIORITY (in order, given the tight character budget): 1) years of experience, if
present, MUST be worked into the note (e.g. "10 yrs in Dubbing") even briefly -- this is
the single most important fact to keep if something has to be cut for length; 2) if room
remains, prefer naming ONE concrete, specific detail over a generic service category --
in order of how compelling/personal they read: a named past employer/role from
recent_experience (e.g. "your role at Absolute Translations" -- always one of THEIR
past employers, never Global3 itself), a tool from tools_software, a
certification, or current_title -- e.g. "10 yrs, incl. your role at [Company]" beats
"10 yrs, OOONA-certified" beats "10 yrs in subtitling" when multiple fit; 3) generic
service category last, only if there's still room. Prefer short numerals/abbreviations
("10 yrs", "German dubbing") over full sentences to stay under the cap.

PATTERN TO FOLLOW (this is the approved structure -- match its shape and links;
personalize using the real LEAD FACTS instead of the bracketed placeholders,
trimming filler words rather than dropping the years-of-experience fact):
---
{_LINKEDIN_EXEMPLAR}
---

Return STRICT JSON exactly:
{{"body": "<the LinkedIn message, STRICTLY under 200 chars total>"}}"""
    return system, user
