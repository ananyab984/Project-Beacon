/** Prompt builder — personalizes the two approved templates using the lead's
 * real enriched data, never inventing facts beyond what's already known.
 *
 * Personalization strategy: "personalize within the template": the model
 * keeps Global3's structure, links and sign-off, and only tailors the
 * opening + phrasing to the specific linguist using the facts actually
 * provided.
 *
 * Direct port of drafting_service/prompts/prompt_builder.py — _VOICE_RULES
 * is copied verbatim (character-for-character prose, hand-tuned against
 * real leads); keep this file in sync by eye, not by re-deriving the rules. */

import { Lead } from "./leads";
import { LINKEDIN_NOTE_MAX_CHARS } from "../lib/linkedinNoteCap";

// Generous but bounded -- this is a raw JSON dump of everything Parallel
// returned, not curated prose, so it can legitimately run a few KB for a
// lead with a long work history. Capped so one unusually large profile
// can't blow the request; groundingFacts() already carries the highest-
// value specifics regardless, so truncation here only loses secondary detail.
const MAX_PARALLEL_BLOCK_CHARS = 6000;

// --- Brand constants (single source of truth for every draft) --------------
export const BRAND = {
  company: "Global3",
  site: "global3.io",
  apply_url: "https://app.global3.io/apply",
  contact_email: "resources@global3.io",
  email_sign_off: "Best regards,\nResources Team",
  team: "Resource Management team at Global3",
};

/** Re-exported from lib/linkedinNoteCap so the prompt, the evaluator gate and
 * unipile.service's send-time truncation all read the SAME number -- they
 * previously held 200/300/200 and drafts shipped over the send limit. */
export const LINKEDIN_NOTE_CHAR_CAP = LINKEDIN_NOTE_MAX_CHARS;
export const LINKEDIN_CHAR_TARGET = `STRICTLY under ${LINKEDIN_NOTE_CHAR_CAP} characters total (the note is truncated at exactly this length before sending, and the apply URL sits at the end -- going over silently drops the call to action), and every character should be earning its place`;
export const EMAIL_WORD_TARGET = "roughly 120-180 words";

// --- Shared brand-voice + anti-hallucination rules --------------------------
const VOICE_RULES = `You write outreach for ${BRAND.company}, a company that builds long-term
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
- HARD REQUIREMENT — specificity, TWO named details minimum: this draft must read like
  someone actually sat and read this person's profile, not like a template with their
  name pasted in. Name at least TWO DISTINCT concrete details drawn from different
  categories below, whenever two are available anywhere in LEAD FACTS or the RAW PROFILE
  DATA. Only drop to one (or zero) if the profile genuinely offers no more.
    (a) a named employer, client, production, publication, or project they worked on
    (b) a named tool or software they use (tools_software, or one named in a role excerpt)
    (c) a named credential, certification, degree, or field of study
    (d) a specific language pair or named specialism (e.g. "OC, CC, SDH subtitling",
        "Marathi character dubbing", "English-to-Polish literary translation")
    (e) a distinctive claim, number, or scale from a role excerpt ("800+ scripts",
        "broadcast-ready to international standards", "4.8 Trustpilot rating")
  Weak (NEVER do this): "your background in subtitling would be a strong asset."
  Also weak (one detail, generic elsewhere): "your expertise in localization and QA."
  Strong (do this): "your experience with English Subtitling (OC, CC, SDH) at Sfera
  Studios, combined with your hands-on work in OOONA, WinCaps and EZTitles."
- SIGNAL THAT THE PROFILE WAS ACTUALLY READ: open by referring to having looked at their
  profile/work ("I came across your profile and was struck by...", "Reading through your
  profile, your work on X stood out"), then immediately follow it with the specific
  details above. The reader should be able to tell, from the details alone, that this
  could not have been sent to anyone else.
- NAME THE FIT, DON'T ASSERT IT GENERICALLY: say what specifically about their background
  fits what specifically we need -- name the actual service/language pool they'd be
  joining ("our freelance pool for English subtitling and editing work"), not "our
  current and upcoming project pipelines" in the abstract.
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
- Keep ${BRAND.company}'s structure, links and sign-off intact:
  site ${BRAND.site}, apply portal ${BRAND.apply_url}.
- Exactly ONE clear, low-friction call to action.
- Before returning, verify: (1) at least one concrete named fact is used if one exists in
  LEAD FACTS, (2) no invented facts, (3) exactly one CTA, (4) structure/links/sign-off intact.
- Return STRICT JSON only — no markdown, no commentary outside the JSON.`;

// --- Approved reference templates (the pattern every draft must follow) -----
// The shape every email follows. Deliberately written with the SPECIFICS in
// square brackets rather than as finished generic prose: an earlier version
// of this exemplar spelled out three fully-generic middle paragraphs ("We are
// actively looking to connect with talented freelance linguists who value
// long-term, meaningful collaboration...") and the model faithfully reproduced
// them verbatim on every lead, so ~60% of each draft was identical across
// leads and only one opening sentence was ever personalized. Every bracket
// below is a slot the model MUST fill from this lead's own profile.
const EMAIL_EXEMPLAR =
  "Hi [Name],\n\nI hope this email finds you well.\n\n" +
  "I came across your profile and was impressed by [THEIR SPECIFIC BACKGROUND] — " +
  "particularly [NAMED DETAIL #1: a named role/production/client, with the employer " +
  "if the profile pairs them], combined with [NAMED DETAIL #2: named tools, a " +
  "credential, a language pair, or a distinctive claim from their own profile].\n\n" +
  `At ${BRAND.company}, we're building out our freelance pool for [THE SPECIFIC ` +
  "SERVICE/LANGUAGE WORK THIS PERSON DOES], and [WHAT SPECIFICALLY ABOUT THEIR " +
  "BACKGROUND FITS IT] stood out as a strong fit. We work on long-term partnerships " +
  "rather than one-off tasks — more about our work at " +
  `${BRAND.site}.\n\nIf you're open to exploring this, you can submit your profile ` +
  `through our portal so we can match you to relevant projects: ${BRAND.apply_url}\n\n` +
  `Any questions before applying, just reach us at ${BRAND.contact_email}.\n\n` +
  `${BRAND.email_sign_off}`;

// LinkedIn's note cap leaves room for roughly one specific detail, so the
// pattern spends its characters there and keeps the brand wording as short as
// it can -- see the priority list and the budget arithmetic in
// buildLinkedinPrompt. An earlier, chattier closing ("We're building out our
// freelance pool at Global3: ") ate ~45 characters and pushed notes 5-15 over
// the send limit whenever the lead's named detail was itself long (a
// certification title, say), which the send path then truncated -- dropping
// the apply URL, i.e. the whole call to action.
const LINKEDIN_EXEMPLAR =
  "Hi [Name], your [ONE HYPER-SPECIFIC DETAIL: a named employer/production, a named " +
  `tool, or a named specialism] stood out — we'd love you in ${BRAND.company}'s linguist ` +
  `pool. Apply: ${BRAND.apply_url}`;

function dumpCapped(data: any): string {
  const dumped = JSON.stringify(data, null, 2);
  if (dumped.length > MAX_PARALLEL_BLOCK_CHARS) {
    return dumped.slice(0, MAX_PARALLEL_BLOCK_CHARS) + "\n... (truncated -- rely on LEAD FACTS above for anything cut off here)";
  }
  return dumped;
}

/** Every raw enrichment payload this lead has, verbatim, labeled by source --
 * on top of the curated groundingFacts() above, not instead of it. Covers
 * BOTH Parallel's Task Run data and the primary scrape (Bright Data for
 * LinkedIn, Tavily for ProZ/ATA/etc.), so the model can mine anything not
 * explicitly modeled by the Lead class (a raw about/experience field the
 * curated facts summarized, etc.) rather than a code-level decision in
 * advance about what counts as relevant. Still governed by the same
 * anti-fabrication rule in VOICE_RULES -- only reference what's literally
 * present here, never infer or embellish. */
function fullRawDataBlock(lead: Lead): string {
  const sections: string[] = [];
  if (lead.parallelFullData) {
    sections.push(`--- From Parallel ---\n${dumpCapped(lead.parallelFullData)}`);
  }
  if (lead.rawScrapeData) {
    sections.push(`--- From the primary scrape (Bright Data/Tavily) ---\n${dumpCapped(lead.rawScrapeData)}`);
  }
  if (!sections.length) {
    return "(none -- no additional raw enrichment data available for this lead)";
  }
  return sections.join("\n\n");
}

/** Render the lead's grounding facts as a compact, labeled block -- this is
 * the ONLY data the model is given, and it already includes every real
 * enriched field the Lead record has (years of experience, services,
 * languages, country, current role/company) via Lead.groundingFacts(). */
function factsBlock(lead: Lead): string {
  return Object.entries(lead.groundingFacts())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

export interface RateMatch {
  currency?: string;
  rate?: number | string;
  unit?: string;
}

function rateBlock(rateMatch: RateMatch | null | undefined): string {
  if (rateMatch) {
    return `- Validated Rate Card: ${rateMatch.currency || "USD"} $${rateMatch.rate} ${rateMatch.unit || "per word"}`;
  }
  return "- Rate Context: No rate card match (Do NOT mention any dollar amount or rate figure)";
}

/** Return [system, user] prompts for a long-form email draft. */
export function buildEmailPrompt(lead: Lead, rateMatch?: RateMatch | null): [string, string] {
  const system = VOICE_RULES;
  const user = `Write a personalized outreach EMAIL to this freelance linguist.

LEAD FACTS (the only facts you may use):
${factsBlock(lead)}

ADDITIONAL RAW PROFILE DATA (every enrichment source for this lead, raw and
supplementary -- same rule applies: only reference what's literally present
here, never infer or embellish beyond it. LEAD FACTS above is the pre-vetted
primary source; treat this as a place to find ONE more specific, distinctive
detail if LEAD FACTS didn't already give you enough to satisfy the
specificity requirement below -- not a mandate to use everything in it):
${fullRawDataBlock(lead)}

RATE CONTEXT:
${rateBlock(rateMatch)}

CHANNEL: Email (long-form, ${EMAIL_WORD_TARGET}).
Must include: ${BRAND.site}, the apply portal link ${BRAND.apply_url}, the contact
${BRAND.contact_email}, and the sign-off "Resources Team".
Must ALSO include, per the specificity rule above: TWO distinct named details from
this person's own profile (an employer/production/client, a named tool, a credential,
a specific language pair or specialism, or a distinctive claim from a role excerpt),
and an opening that makes clear their profile was actually read. Do not settle for the
broad service category when a named detail is available anywhere in LEAD FACTS or the
RAW PROFILE DATA below.
AND, separately from those named details, weave in at least one of the lead's broad
attributes that IS present in LEAD FACTS -- their language(s), service(s), country, or
years of experience. The named details are what prove you read the profile; this is
what anchors the message to the work we'd actually be offering them, and a draft
carrying only named details and no attribute reads oddly disembodied.

PATTERN TO FOLLOW (this is the approved structure -- match its shape, tone, links and
sign-off. EVERY square-bracket slot is a slot you must fill with this lead's OWN
specifics; do not carry any bracket text through literally, and do not replace a
bracket with a generic phrase):
---
${EMAIL_EXEMPLAR}
---

Return STRICT JSON exactly:
{"subject": "<subject line, MAX 8 words, naming the actual role/service and language
where known -- e.g. \\"Freelance English Subtitling – Global3\\" or \\"Marathi Voice
Over Partnership – Global3\\". Not a generic \\"Partnership Opportunity\\">",
 "body": "<the email body>"}`;
  return [system, user];
}

/** Return [system, user] prompts for a short LinkedIn draft. */
export function buildLinkedinPrompt(lead: Lead, rateMatch?: RateMatch | null): [string, string] {
  const system = VOICE_RULES;
  const user = `Write a personalized outreach LINKEDIN connection note to this freelance linguist.

LEAD FACTS (the only facts you may use):
${factsBlock(lead)}

ADDITIONAL RAW PROFILE DATA (every enrichment source for this lead, raw and
supplementary -- same rule applies: only reference what's literally present
here, never infer or embellish beyond it. Given the tight character budget,
only pull from this if it contains something more distinctive than what's
already in LEAD FACTS):
${fullRawDataBlock(lead)}

RATE CONTEXT:
${rateBlock(rateMatch)}

CHANNEL: LinkedIn connection note (${LINKEDIN_CHAR_TARGET}).
CRITICAL REQUIREMENT: Total text length MUST NOT EXCEED ${LINKEDIN_NOTE_CHAR_CAP} CHARACTERS,
including the apply link. No subject line.

DO THE ARITHMETIC BEFORE YOU WRITE -- "be brief" is not enough, and drafts keep
landing 5-15 characters over:
  - the apply URL alone is ${BRAND.apply_url.length} characters
  - the closing that introduces it costs ~50 more (see the PATTERN below)
  - that leaves you roughly ${LINKEDIN_NOTE_CHAR_CAP - BRAND.apply_url.length - 50} characters
    -- about 18-20 words -- for the greeting and the specific detail COMBINED. If the
    lead's named detail is itself long (a full certification title, say), the greeting
    has to shrink to almost nothing: "Hi [Name], your [detail] stood out —" is enough.
Draft it, then COUNT the characters of the whole thing including the URL. If it's over
${LINKEDIN_NOTE_CHAR_CAP}, cut words and count again before answering. Cut in this order:
the pleasantry, then the profile-read wording (shorten "I came across your profile and
was impressed by" to just "your"), then the service category -- NEVER the named detail.

PRIORITY (in order, given the tight character budget -- personalization outranks
everything else here, because the ONLY reason this note gets a reply is the lead
recognising that a real person read their actual profile):
  1) ONE hyper-specific named detail is MANDATORY and is the last thing to cut: a named
     employer/production/client from recent_experience (always one of THEIR employers,
     never ${BRAND.company} itself), a named tool from tools_software, a named
     credential, or a named specialism/language pair. e.g. "your OOONA subtitling
     work", "your Marathi VO for Maruti Suzuki", "your OC/CC/SDH work at Sfera".
  2) years of experience, if present and if room remains after (1) -- e.g. "10 yrs".
  3) the broad service category LAST, and only if nothing more specific fit.
A note that spends its characters on "10 yrs in subtitling" while a named tool or
employer was available in LEAD FACTS is a FAILURE -- the specific detail is what earns
the reply. Prefer short forms ("10 yrs", "EN>PL", "OOONA") to buy room for the
specific detail. Signal you read the profile in as few words as possible ("came across
your profile", "saw your work on X").

PATTERN TO FOLLOW (this is the approved structure -- match its shape and links;
personalize using the real LEAD FACTS instead of the bracketed placeholders,
trimming filler words rather than dropping the years-of-experience fact):
---
${LINKEDIN_EXEMPLAR}
---

Return STRICT JSON exactly:
{"body": "<the LinkedIn message, STRICTLY under ${LINKEDIN_NOTE_CHAR_CAP} chars total>"}`;
  return [system, user];
}
