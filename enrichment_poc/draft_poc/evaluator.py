"""Evaluation layer — the deterministic reliability gate for generated drafts.

Single-Stage Programmatic Evaluation:
  Rule-based checks (fast, free, transparent, fail-fast):
  - Length (words for email, characters for LinkedIn connection note cap)
  - Readability (Flesch Reading Ease & Flesch-Kincaid grade level)
  - Required Elements (name greeting, company site, apply URL, CTA, email sign-off)
  - Spam & Formatting (spam words, excessive caps, exclamation marks, fake RE:)
  - Personalization Depth (verifies at least 1 real enriched attribute is referenced)
  - Entity Grounding Filter (scans for un-grounded numbers or stray proper nouns)

Send rule: All programmatic GATE checks pass.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

import prompt_builder as pb
import readability
from draft_generator import Draft
from logger import get_logger

log = get_logger(__name__)

# Common cold-outreach spam-trigger words (deliverability signal).
SPAM_WORDS = {
    "100% free", "free money", "free trial", "free gift", "free offer", "claim your free",
    "guarantee", "guaranteed", "act now", "urgent", "risk-free",
    "limited time", "no obligation", "100%", "cash", "winner", "click here",
    "buy now", "cheap", "discount", "offer expires", "$$$",
}
CTA_VERBS = ("apply", "reply", "reach out", "get in touch", "connect", "submit",
             "explore", "chat", "call", "book", "let us know", "interested")


@dataclass
class Check:
    name: str
    passed: bool
    severity: str  # "gate" | "warn"
    detail: str
    value: float | int | str | None = None


@dataclass
class Evaluation:
    channel: str
    lead_name: str
    checks: list[Check] = field(default_factory=list)
    programmatic_pass: bool = False
    send: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------- #
# Programmatic rule checks
# --------------------------------------------------------------------------- #

def _spam_hit(term: str, body_lower: str) -> bool:
    """Match a spam term without firing on substrings (e.g. 'free' in 'freelance')."""
    if term.isalpha():
        return re.search(rf"\b{re.escape(term)}\b", body_lower) is not None
    return term in body_lower


def _caps_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(c.isupper() for c in letters) / len(letters)


def _lead_attribute_terms(draft: Draft) -> dict[str, list[str]]:
    """Concrete strings, grouped by attribute category, that count as real personalization."""
    lead = draft.lead
    terms: dict[str, list[str]] = {}
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


def _programmatic_checks(draft: Draft) -> list[Check]:
    body = draft.body
    subject = draft.subject or ""
    lead = draft.lead
    checks: list[Check] = []
    words = len(body.split())
    chars = len(body)

    # 1. Length ------------------------------------------------------------
    if draft.channel == "email":
        ok = 90 <= words <= 230
        ideal = 120 <= words <= 180
        checks.append(Check("length_words", ok, "gate",
            f"{words} words (band 90-230; ideal 120-180{'' if ideal else ' — outside ideal'})", words))
    else:
        ok = 60 <= chars <= 300
        checks.append(Check("length_chars", ok, "gate",
            f"{chars} chars (band 60-300; fits LinkedIn connection note cap)", chars))
        checks.append(Check("linkedin_note_cap", chars <= 300, "gate",
            f"{chars} chars ({'fits' if chars <= 300 else 'EXCEEDS'} 300-char cap)", chars))

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

    # 6. Entity grounding pre-filter --------------------------------------
    unsupported = _heuristic_unsupported_entities(draft)
    checks.append(Check("entity_grounding", not unsupported, "warn",
        f"possible unsupported specifics: {unsupported or 'none'}", len(unsupported)))

    return checks


def _heuristic_unsupported_entities(draft: Draft) -> list[str]:
    """Flag numbers / proper-noun phrases in the draft not in lead facts or brand."""
    body = draft.body
    allowed = set()
    for v in draft.lead.grounding_facts().values():
        allowed |= {t.lower() for t in re.findall(r"[A-Za-z0-9]+", v)}
    allowed |= {"global3", "global", "resources", "team", "hi", "we", "i"}
    for v in pb.BRAND.values():
        allowed |= {t.lower() for t in re.findall(r"[A-Za-z0-9]+", str(v))}

    flags: list[str] = []
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


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def evaluate(draft: Draft) -> Evaluation:
    """Run programmatic rule checks on the draft."""
    checks = _programmatic_checks(draft)
    gates_pass = all(c.passed for c in checks if c.severity == "gate")

    return Evaluation(
        channel=draft.channel,
        lead_name=draft.lead.first_name,
        checks=checks,
        programmatic_pass=gates_pass,
        send=gates_pass,
    )


