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
import { specificityTarget, type Draft } from "./draftGenerator";
import { BRAND, LINKEDIN_NOTE_CHAR_CAP } from "./promptBuilder";
import { citedNamedSpecifics } from "./leads";

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
  // The raw enrichment payloads are handed to the model as a sanctioned place
  // to find one more distinctive detail (see promptBuilder's ADDITIONAL RAW
  // PROFILE DATA block), so anything named in them is grounded -- it just
  // isn't in the curated facts. Without this, the check contradicts the
  // prompt and flags the model for doing exactly what it was told: confirmed
  // live 2026-09-07, "Tata Mutual Fund" was flagged as an unsupported
  // specific for a lead whose own Parallel payload named it.
  for (const payload of [draft.lead.parallelFullData, draft.lead.rawScrapeData]) {
    if (!payload) continue;
    for (const t of JSON.stringify(payload).match(/[A-Za-z0-9]+/g) || []) allowed.add(t.toLowerCase());
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
  // Multi-word names are checked as a WHOLE PHRASE against everything known
  // about the lead, NOT token by token. Token-level matching let a fabricated
  // pairing through whenever both halves happened to appear somewhere
  // unrelated -- "Sony Pictures" passed for a lead whose payload mentioned
  // "Sony" and, separately, "Pictures" -- and pouring both raw payloads into
  // the token pool widened exactly that hole.
  //
  // The skip list here is deliberately ONLY our own brand wording and the
  // lead's own name: those are the phrases that legitimately appear in a
  // draft without being grounded in profile data. Skipping anything whose
  // tokens are individually "allowed" would reintroduce the same bug, since
  // that set contains every token of both payloads.
  const structural = new Set<string>();
  for (const w of ["global3", "global", "resources", "team", "hi", "we", "i", "best", "regards"]) structural.add(w);
  for (const v of Object.values(BRAND)) {
    for (const t of String(v).match(/[A-Za-z0-9]+/g) || []) structural.add(t.toLowerCase());
  }
  for (const t of `${draft.lead.fullName || ""} ${draft.lead.firstName || ""}`.match(/[A-Za-z0-9]+/g) || []) {
    structural.add(t.toLowerCase());
  }
  const known = draft.lead.allKnownText();
  for (const match of bodyNoUrls.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/g)) {
    const phrase = match[1];
    const toks = phrase.split(" ").map((t) => t.toLowerCase());
    if (toks.every((t) => structural.has(t))) continue;
    if (!known.includes(phrase.toLowerCase())) flags.push(phrase);
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
    const ok = chars >= 60 && chars <= LINKEDIN_NOTE_CHAR_CAP;
    checks.push({
      name: "length_chars",
      passed: ok,
      severity: "gate",
      detail: `${chars} chars (band 60-${LINKEDIN_NOTE_CHAR_CAP}; fits LinkedIn connection-note cap)`,
      value: chars,
    });
    checks.push({
      name: "linkedin_note_cap",
      passed: chars <= LINKEDIN_NOTE_CHAR_CAP,
      severity: "gate",
      detail: `${chars} chars (${chars <= LINKEDIN_NOTE_CHAR_CAP ? "fits" : "EXCEEDS"} ${LINKEDIN_NOTE_CHAR_CAP}-char cap)`,
      value: chars,
    });
    if (!ok || chars > LINKEDIN_NOTE_CHAR_CAP) flags.push("LINKEDIN_NOTE_CAP_EXCEEDED");
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
  // A cited named detail satisfies this too. This check matches the body
  // against the CANONICAL columns (language/service/country/years), and those
  // are routinely empty or plain wrong on real rows -- confirmed live
  // 2026-09-07: a lead whose record said `targetLanguage: "English",
  // services: []` while his actual profile headline read "Voice & Dubbing
  // Artist Punjabi Hindi" got a correctly personalized draft ("your Hindi &
  // Punjabi dubbing work stood out") and then failed this gate, because
  // "Hindi" matches nothing in a record that claims English. Naming a
  // grounded detail from the profile is strictly STRONGER evidence of
  // personalization than echoing a canonical attribute, so it counts here as
  // well; a draft with neither is still gated, which is the mail-merge case
  // this exists to catch.
  const specificsForDepth = citedNamedSpecifics(lead, body);
  const depthOk = depth >= 1 || specificsForDepth.length >= 1;
  checks.push({
    name: "personalization_depth",
    passed: depthOk,
    severity: "gate",
    detail:
      `${depth} canonical attribute categorie(s) referenced: ${depth ? JSON.stringify(hitCategories) : "none"}` +
      `; ${specificsForDepth.length} named profile detail(s) cited`,
    value: depth,
  });
  if (!depthOk) flags.push("LOW_PERSONALIZATION_DEPTH");

  // 5b. Named-specificity depth ------------------------------------------
  // personalization_depth above only proves a broad attribute (a language, a
  // service category, a country) was mentioned -- "your subtitling experience
  // in Spain" passes it while reading like a mail merge. This check is the
  // one that asks whether the draft names things only THIS person's profile
  // could have supplied: a tool, a credential, an employer, a production.
  // Bar is min(2, available) for email and min(1, available) for LinkedIn,
  // whose ~200-char note has room for one -- so a genuinely thin profile is
  // never held to a standard its own data can't meet. Shares
  // Lead.specificFactCandidates() with draftGenerator's regenerate-once
  // guard so the generator and the evaluator can't disagree on the bar.
  const strongFacts = lead.strongFactCandidates();
  const citedFacts = citedNamedSpecifics(lead, body);
  // Email asks for the full bar; LinkedIn's ~200-char note has room for one.
  const specTarget =
    draft.channel === "email" ? specificityTarget(strongFacts) : Math.min(1, strongFacts.length);
  const specOk = citedFacts.length >= specTarget;
  checks.push({
    name: "named_specificity",
    passed: specOk,
    severity: "gate",
    detail:
      strongFacts.length === 0
        ? "no named org/tool/credential on this lead's profile — bar waived"
        : `${citedFacts.length}/${specTarget} named detail(s) cited${citedFacts.length ? ": " + JSON.stringify(citedFacts.slice(0, 4)) : ""} (profile offers ${strongFacts.length} strong)`,
    value: citedFacts.length,
  });
  if (!specOk) flags.push("LOW_NAMED_SPECIFICITY");

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
  // Also matches MULTI-WORD bracket slots: the email exemplar now uses
  // "[NAMED DETAIL #2: named tools, a credential, ...]" placeholders, and a
  // single-token-only pattern would let a leaked one through as send-ready.
  const placeholders = body.match(/(\[[^\]\n]{1,120}\]|\{\s*[\w_]+\s*\}|undefined|null|N\/A)/g) || [];
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
