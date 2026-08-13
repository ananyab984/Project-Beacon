"""Evaluation layer — synced 1-to-1 with draft_poc/evaluator.py.

Single-Stage Programmatic Evaluation:
  Rule-based checks (fast, transparent, fail-fast):
  - Length (words for email, characters for LinkedIn connection note cap)
  - Readability (Flesch Reading Ease & Flesch-Kincaid grade level)
  - Required Elements (name greeting, company site, apply URL, CTA, email sign-off)
  - Spam & Formatting (spam words, excessive caps, exclamation marks, fake RE:)
  - Personalization Depth (verifies at least 1 real enriched attribute is referenced)
  - Entity Grounding Filter (scans for un-grounded numbers or stray proper nouns)
  - Rate Grounding Filter (verifies no rate figure is fabricated outside rate card lookup)
  - Placeholder Check (verifies zero unfilled placeholder tokens exist)

Send rule: All programmatic GATE checks pass.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from core import readability
from core.leads import Lead
from draft_generator import Draft
from logger import get_logger
from prompts import prompt_builder as pb

log = get_logger(__name__)

# Common cold-outreach spam-trigger words (deliverability signal)
SPAM_WORDS = {
    "100% free", "free money", "free trial", "free gift", "free offer", "claim your free",
    "guarantee", "guaranteed", "act now", "urgent", "risk-free",
    "limited time", "no obligation", "100%", "cash", "winner", "click here",
    "buy now", "cheap", "discount", "offer expires", "$$$",
}

CTA_VERBS = (
    "apply", "reply", "reach out", "get in touch", "connect", "submit",
    "explore", "chat", "call", "book", "let us know", "interested"
)


@dataclass
class Check:
    name: str
    passed: bool
    severity: str  # "gate" | "warn"
    detail: str
    value: Any = None


@dataclass
class Evaluation:
    channel: str
    lead_name: str
    checks: List[Check] = field(default_factory=list)
    programmatic_pass: bool = False
    send: bool = False
    flags: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        res = asdict(self)
        res["checks"] = [asdict(c) for c in self.checks]
        return res


def _spam_hit(term: str, body_lower: str) -> bool:
    if term.isalpha():
        return re.search(rf"\b{re.escape(term)}\b", body_lower) is not None
    return term in body_lower


def _caps_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(c.isupper() for c in letters) / len(letters)


def _lead_attribute_terms(draft: Draft) -> Dict[str, List[str]]:
    lead = draft.lead
    terms: Dict[str, List[str]] = {}
    langs = []
    for v in (lead.target_language, lead.source_language):
        if v:
            langs += [p.strip() for p in v.split(",") if p.strip()]
    langs += lead.secondary_languages
    if langs:
        terms["language"] = langs
    if lead.country:
        terms["country"] = [lead.country]
    if lead.services:
        terms["services"] = lead.services
    if lead.vendor_experience:
        terms["experience"] = [lead.vendor_experience]
    if lead.years_of_exp is not None:
        terms["experience"] = terms.get("experience", []) + [str(lead.years_of_exp)]
    return terms


def _heuristic_unsupported_entities(draft: Draft) -> List[str]:
    body = draft.body
    allowed = set()
    for v in draft.lead.grounding_facts().values():
        allowed |= {t.lower() for t in re.findall(r"[A-Za-z0-9]+", v)}
    allowed |= {"global3", "global", "resources", "team", "hi", "we", "i"}
    for v in pb.BRAND.values():
        allowed |= {t.lower() for t in re.findall(r"[A-Za-z0-9]+", str(v))}

    flags: List[str] = []
    body_no_urls = re.sub(r"https?://\S+", "", body).replace("Global3", "")
    for num in re.findall(r"\b\d{2,}\b", body_no_urls):
        if num.lower() not in allowed:
            flags.append(num)
    for phrase in re.findall(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b", body_no_urls):
        toks = [t.lower() for t in phrase.split()]
        if any(t not in allowed for t in toks):
            flags.append(phrase)
    name_toks = {t.lower() for t in (draft.lead.full_name or "").split()}
    return sorted({f for f in flags if f.lower() not in name_toks})


def evaluate(draft: Draft) -> Evaluation:
    """Run programmatic rule checks matching draft_poc/evaluator.py."""
    body = draft.body
    subject = draft.subject or ""
    lead = draft.lead
    checks: List[Check] = []
    flags: List[str] = []

    words = len(body.split())
    chars = len(body)

    # 1. Length ------------------------------------------------------------
    if draft.channel == "email":
        ok = 90 <= words <= 230
        ideal = 120 <= words <= 180
        checks.append(Check("length_words", ok, "gate",
            f"{words} words (band 90-230; ideal 120-180{'' if ideal else ' — outside ideal'})", words))
        if not ok:
            flags.append("LENGTH_OUT_OF_BOUNDS")
    else:
        ok = 60 <= chars <= 300
        checks.append(Check("length_chars", ok, "gate",
            f"{chars} chars (band 60-300; fits LinkedIn connection note cap)", chars))
        checks.append(Check("linkedin_note_cap", chars <= 300, "gate",
            f"{chars} chars ({'fits' if chars <= 300 else 'EXCEEDS'} 300-char cap)", chars))
        if not ok or chars > 300:
            flags.append("LINKEDIN_NOTE_CAP_EXCEEDED")

    # 2. Readability -------------------------------------------------------
    fre = readability.flesch_reading_ease(body)
    fk = readability.flesch_kincaid_grade(body)
    checks.append(Check("readability_flesch", fre >= 40, "warn",
        f"Flesch Reading Ease {fre:.0f} (>=40 good; ~60-70 = plain business English)", round(fre, 1)))
    checks.append(Check("readability_grade", fk <= 12, "warn",
        f"Flesch-Kincaid grade {fk:.1f} (<=12 target)", round(fk, 1)))

    # 3. Required elements -------------------------------------------------
    greets_name = lead.first_name.lower() in body.lower()[:60]
    has_apply = pb.BRAND["apply_url"] in body or "app.global3.io/apply" in body
    has_site = pb.BRAND["site"] in body
    has_cta = any(v in body.lower() for v in CTA_VERBS)
    if draft.channel == "email":
        has_signoff = "resources team" in body.lower()
        subj_ok = bool(subject) and len(subject.split()) <= 8
        req_ok = greets_name and has_apply and has_site and has_cta and has_signoff and subj_ok
        detail = (f"name✓{int(greets_name)} apply✓{int(has_apply)} site✓{int(has_site)} "
                  f"cta✓{int(has_cta)} signoff✓{int(has_signoff)} subject✓{int(subj_ok)}")
    else:
        req_ok = greets_name and has_apply and has_site and has_cta
        detail = (f"name✓{int(greets_name)} apply✓{int(has_apply)} "
                  f"site✓{int(has_site)} cta✓{int(has_cta)}")
    checks.append(Check("required_elements", req_ok, "gate", detail))
    if not req_ok:
        flags.append("MISSING_REQUIRED_ELEMENTS")

    # 4. Spam / formatting -------------------------------------------------
    spam_hits = [w for w in SPAM_WORDS if _spam_hit(w, body.lower())]
    caps = _caps_ratio(body)
    excls = body.count("!")
    fake_re = bool(re.match(r"\s*(re|fwd):", subject, re.I))
    spam_ok = len(spam_hits) == 0 and caps < 0.30 and excls <= 1 and not fake_re
    checks.append(Check("spam_formatting", spam_ok, "warn",
        f"spam_words={spam_hits or 'none'} caps={caps:.0%} '!'={excls} fake_re={fake_re}",
        len(spam_hits)))

    # 5. Personalization depth --------------------------------------------
    terms = _lead_attribute_terms(draft)
    hit_categories = [
        cat for cat, vals in terms.items()
        if any(val.lower() in body.lower() for val in vals if len(val) >= 3)
    ]
    depth = len(hit_categories)
    checks.append(Check("personalization_depth", depth >= 1, "gate",
        f"{depth} real attribute categorie(s) referenced: {hit_categories or 'none — only the name'}",
        depth))
    if depth < 1:
        flags.append("LOW_PERSONALIZATION_DEPTH")

    # 6. Entity grounding pre-filter --------------------------------------
    unsupported = _heuristic_unsupported_entities(draft)
    checks.append(Check("entity_grounding", not unsupported, "warn",
        f"possible unsupported specifics: {unsupported or 'none'}", len(unsupported)))

    # 7. Unfilled placeholders check ---------------------------------------
    placeholders = re.findall(r"(\[\s*[\w_]+\s*\]|\{\s*[\w_]+\s*\}|undefined|null|N/A)", body)
    no_placeholders = len(placeholders) == 0
    checks.append(Check("no_placeholders", no_placeholders, "gate",
        f"Unfilled placeholders: {placeholders or 'none'}"))
    if not no_placeholders:
        flags.append("UNFILLED_PLACEHOLDERS_FOUND")

    # 8. Rate grounding check ----------------------------------------------
    mentioned_rates = re.findall(r"\$\d+(?:\.\d{2})?|\d+\s*(?:USD|EUR|GBP|cents|per word)", body, re.I)
    if not draft.rate_match and mentioned_rates:
        rate_ok = False
        detail = f"Rate mentioned ({mentioned_rates}) but NO rate card match exists!"
        flags.append("FABRICATED_RATE_DETECTED")
    else:
        rate_ok = True
        detail = f"Rate match: {draft.rate_match['rate']} {draft.rate_match['currency']}" if draft.rate_match else "No rate mentioned"
    checks.append(Check("rate_grounding", rate_ok, "gate", detail))

    if draft.rate_flag == "NO_RATE_MATCH":
        flags.append("NO_RATE_MATCH")

    gates_pass = all(c.passed for c in checks if c.severity == "gate")

    return Evaluation(
        channel=draft.channel,
        lead_name=draft.lead.first_name,
        checks=checks,
        programmatic_pass=gates_pass,
        send=gates_pass,
        flags=flags,
    )
