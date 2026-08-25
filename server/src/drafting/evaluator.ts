/** Evaluation layer — direct port of drafting_service/evaluator.py.
 *
 * Single-Stage Programmatic Evaluation:
 *   Rule-based checks (fast, transparent, fail-fast):
 *   - Length (words for email, characters for LinkedIn connection note cap)
 *   - Readability (Flesch Reading Ease & Flesch-Kincaid grade level)
 *   - Required Elements (name greeting, company site, apply URL, CTA, email sign-off)
 *   - Spam & Formatting (spam words, excessive caps, exclamation marks, fake RE:)
 *   - Personalization Depth (verifies at least 1 real enriched attribute is referenced)
 *   - Entity Grounding Filter (scans for un-grounded numbers or stray proper nouns)
 *   - Rate Grounding Filter (verifies no rate figure is fabricated outside rate card lookup)
 *   - Placeholder Check (verifies zero unfilled placeholder tokens exist)
 *
 * Send rule: All programmatic GATE checks pass. */

import { fleschKincaidGrade, fleschReadingEase } from "./readability";
import type { Draft } from "./draftGenerator";
import { BRAND } from "./promptBuilder";

// Common cold-outreach spam-trigger words (deliverability signal)
const SPAM_WORDS = [
  "100% free", "free money", "free trial", "free gift", "free offer", "claim your free",
  "guarantee", "guaranteed", "act now", "urgent", "risk-free",
  "limited time", "no obligation", "100%", "cash", "winner", "click here",
  "buy now", "cheap", "discount", "offer expires", "$$$",
];

const CTA_VERBS = [
  "apply", "reply", "reach out", "get in touch", "connect", "submit",
  "explore", "chat", "call", "book", "let us know", "interested",
];

export interface Check {
  name: string;
  passed: boolean;
  severity: "gate" | "warn";
  detail: string;
  value?: any;
}

export interface Evaluation {
  channel: string;
  lead_name: string;
  checks: Check[];
  programmatic_pass: boolean;
  send: boolean;
  flags: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spamHit(term: string, bodyLower: string): boolean {
  if (/^[A-Za-z]+$/.test(term)) {
    return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(bodyLower);
  }
  return bodyLower.includes(term);
}

function capsRatio(text: string): number {
  const letters = Array.from(text).filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 0.0;
  const upperCount = letters.filter((c) => /\p{Lu}/u.test(c)).length;
  return upperCount / letters.length;
}

function leadAttributeTerms(draft: Draft): Record<string, string[]> {
  const lead = draft.lead;
  const terms: Record<string, string[]> = {};
  let langs: string[] = [];
  for (const v of [lead.targetLanguage, lead.sourceLanguage]) {
    if (v) langs = langs.concat(v.split(",").map((p) => p.trim()).filter(Boolean));
  }
  langs = langs.concat(lead.secondaryLanguages);
  if (langs.length) terms.language = langs;
  if (lead.country) terms.country = [lead.country];
  if (lead.services.length) terms.services = lead.services;
  if (lead.vendorExperience) terms.experience = [lead.vendorExperience];
  if (lead.yearsOfExp !== null) terms.experience = (terms.experience || []).concat([String(lead.yearsOfExp)]);
  return terms;
}

function heuristicUnsupportedEntities(draft: Draft): string[] {
  const body = draft.body;
  const allowed = new Set<string>();
  for (const v of Object.values(draft.lead.groundingFacts())) {
    for (const t of v.match(/[A-Za-z0-9]+/g) || []) allowed.add(t.toLowerCase());
  }
  for (const w of ["global3", "global", "resources", "team", "hi", "we", "i"]) allowed.add(w);
  for (const v of Object.values(BRAND)) {
    for (const t of String(v).match(/[A-Za-z0-9]+/g) || []) allowed.add(t.toLowerCase());
  }

  const flags: string[] = [];
  const bodyNoUrls = body.replace(/https?:\/\/\S+/g, "").split("Global3").join("");
  for (const num of bodyNoUrls.match(/\b\d{2,}\b/g) || []) {
    if (!allowed.has(num.toLowerCase())) flags.push(num);
  }
  for (const match of bodyNoUrls.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/g)) {
    const phrase = match[1];
    const toks = phrase.split(" ").map((t) => t.toLowerCase());
    if (toks.some((t) => !allowed.has(t))) flags.push(phrase);
  }
  const nameToks = new Set(
    (draft.lead.fullName || "").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase())
  );
  const uniqueFlags = new Set(flags.filter((f) => !nameToks.has(f.toLowerCase())));
  return Array.from(uniqueFlags).sort();
}

/** Run programmatic rule checks matching drafting_service/evaluator.py. */
export function evaluate(draft: Draft): Evaluation {
  const body = draft.body;
  const subject = draft.subject || "";
  const lead = draft.lead;
  const checks: Check[] = [];
  const flags: string[] = [];

  const words = body.split(/\s+/).filter(Boolean).length;
  const chars = body.length;

  // 1. Length ----------------------------------------------------------
  if (draft.channel === "email") {
    const ok = words >= 90 && words <= 230;
    const ideal = words >= 120 && words <= 180;
    checks.push({
      name: "length_words",
      passed: ok,
      severity: "gate",
      detail: `${words} words (band 90-230; ideal 120-180${ideal ? "" : " — outside ideal"})`,
      value: words,
    });
    if (!ok) flags.push("LENGTH_OUT_OF_BOUNDS");
  } else {
    const ok = chars >= 60 && chars <= 300;
    checks.push({
      name: "length_chars",
      passed: ok,
      severity: "gate",
      detail: `${chars} chars (band 60-300; fits LinkedIn connection note cap)`,
      value: chars,
    });
    checks.push({
      name: "linkedin_note_cap",
      passed: chars <= 300,
      severity: "gate",
      detail: `${chars} chars (${chars <= 300 ? "fits" : "EXCEEDS"} 300-char cap)`,
      value: chars,
    });
    if (!ok || chars > 300) flags.push("LINKEDIN_NOTE_CAP_EXCEEDED");
  }

  // 2. Readability -------------------------------------------------------
  const fre = fleschReadingEase(body);
  const fk = fleschKincaidGrade(body);
  checks.push({
    name: "readability_flesch",
    passed: fre >= 40,
    severity: "warn",
    detail: `Flesch Reading Ease ${fre.toFixed(0)} (>=40 good; ~60-70 = plain business English)`,
    value: Math.round(fre * 10) / 10,
  });
  checks.push({
    name: "readability_grade",
    passed: fk <= 12,
    severity: "warn",
    detail: `Flesch-Kincaid grade ${fk.toFixed(1)} (<=12 target)`,
    value: Math.round(fk * 10) / 10,
  });

  // 3. Required elements -------------------------------------------------
  const greetsName = body.toLowerCase().slice(0, 60).includes(lead.firstName.toLowerCase());
  const hasApply = body.includes(BRAND.apply_url) || body.includes("app.global3.io/apply");
  const hasSite = body.includes(BRAND.site);
  const hasCta = CTA_VERBS.some((v) => body.toLowerCase().includes(v));
  let reqOk: boolean;
  let detail: string;
  if (draft.channel === "email") {
    const hasSignoff = body.toLowerCase().includes("resources team");
    const subjOk = !!subject && subject.split(/\s+/).filter(Boolean).length <= 8;
    reqOk = greetsName && hasApply && hasSite && hasCta && hasSignoff && subjOk;
    detail = `name✓${Number(greetsName)} apply✓${Number(hasApply)} site✓${Number(hasSite)} cta✓${Number(hasCta)} signoff✓${Number(hasSignoff)} subject✓${Number(subjOk)}`;
  } else {
    reqOk = greetsName && hasApply && hasSite && hasCta;
    detail = `name✓${Number(greetsName)} apply✓${Number(hasApply)} site✓${Number(hasSite)} cta✓${Number(hasCta)}`;
  }
  checks.push({ name: "required_elements", passed: reqOk, severity: "gate", detail });
  if (!reqOk) flags.push("MISSING_REQUIRED_ELEMENTS");

  // 4. Spam / formatting -------------------------------------------------
  const bodyLower = body.toLowerCase();
  const spamHits = SPAM_WORDS.filter((w) => spamHit(w, bodyLower));
  const caps = capsRatio(body);
  const excls = (body.match(/!/g) || []).length;
  const fakeRe = /^\s*(re|fwd):/i.test(subject);
  const spamOk = spamHits.length === 0 && caps < 0.3 && excls <= 1 && !fakeRe;
  checks.push({
    name: "spam_formatting",
    passed: spamOk,
    severity: "warn",
    detail: `spam_words=${spamHits.length ? JSON.stringify(spamHits) : "none"} caps=${(caps * 100).toFixed(0)}% '!'=${excls} fake_re=${fakeRe}`,
    value: spamHits.length,
  });

  // 5. Personalization depth --------------------------------------------
  const terms = leadAttributeTerms(draft);
  const hitCategories = Object.entries(terms)
    .filter(([, vals]) => vals.some((val) => val.length >= 3 && bodyLower.includes(val.toLowerCase())))
    .map(([cat]) => cat);
  const depth = hitCategories.length;
  checks.push({
    name: "personalization_depth",
    passed: depth >= 1,
    severity: "gate",
    detail: `${depth} real attribute categorie(s) referenced: ${depth ? JSON.stringify(hitCategories) : "none — only the name"}`,
    value: depth,
  });
  if (depth < 1) flags.push("LOW_PERSONALIZATION_DEPTH");

  // 6. Entity grounding pre-filter ---------------------------------------
  const unsupported = heuristicUnsupportedEntities(draft);
  checks.push({
    name: "entity_grounding",
    passed: unsupported.length === 0,
    severity: "warn",
    detail: `possible unsupported specifics: ${unsupported.length ? JSON.stringify(unsupported) : "none"}`,
    value: unsupported.length,
  });

  // 7. Unfilled placeholders check ---------------------------------------
  const placeholders = body.match(/(\[\s*[\w_]+\s*\]|\{\s*[\w_]+\s*\}|undefined|null|N\/A)/g) || [];
  const noPlaceholders = placeholders.length === 0;
  checks.push({
    name: "no_placeholders",
    passed: noPlaceholders,
    severity: "gate",
    detail: `Unfilled placeholders: ${placeholders.length ? JSON.stringify(placeholders) : "none"}`,
  });
  if (!noPlaceholders) flags.push("UNFILLED_PLACEHOLDERS_FOUND");

  // 8. Rate grounding check ----------------------------------------------
  const mentionedRates = body.match(/\$\d+(?:\.\d{2})?|\d+\s*(?:USD|EUR|GBP|cents|per word)/gi) || [];
  let rateOk: boolean;
  let rateDetail: string;
  if (!draft.rate_match && mentionedRates.length) {
    rateOk = false;
    rateDetail = `Rate mentioned (${JSON.stringify(mentionedRates)}) but NO rate card match exists!`;
    flags.push("FABRICATED_RATE_DETECTED");
  } else {
    rateOk = true;
    rateDetail = draft.rate_match ? `Rate match: ${draft.rate_match.rate} ${draft.rate_match.currency}` : "No rate mentioned";
  }
  checks.push({ name: "rate_grounding", passed: rateOk, severity: "gate", detail: rateDetail });

  if (draft.rate_flag === "NO_RATE_MATCH") flags.push("NO_RATE_MATCH");

  const gatesPass = checks.filter((c) => c.severity === "gate").every((c) => c.passed);

  return {
    channel: draft.channel,
    lead_name: draft.lead.firstName,
    checks,
    programmatic_pass: gatesPass,
    send: gatesPass,
    flags,
  };
}
