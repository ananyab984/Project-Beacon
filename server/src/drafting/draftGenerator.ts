/** Draft generation layer — Lead + rate context -> Claude -> {subject?, body}.
 * Direct port of drafting_service/draft_generator.py.
 *
 * The LLM is given ONLY `Lead.groundingFacts()` (every real enriched field
 * the lead record actually has) plus the approved template as a structural
 * pattern to follow -- never a hardcoded phrase spliced into the output. The
 * system prompt (promptBuilder.ts) is strict about using nothing else, so
 * personalization is genuine without inventing employers, rates, or
 * credentials that aren't in LEAD FACTS.
 *
 * Includes ensureLinks() guardrail to guarantee brand URLs survive generation. */

import { ClaudeClient } from "./claudeClient";
import type { DraftingConfig } from "./config";
import { Lead } from "./leads";
import { BRAND, buildEmailPrompt, buildLinkedinPrompt, RateMatch } from "./promptBuilder";

export interface Draft {
  channel: "email" | "linkedin";
  lead: Lead;
  subject: string | null;
  body: string;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  rate_match: RateMatch | null;
  rate_flag: string | null;
}

const SPECIFICITY_RETRY_NOTE =
  "Your previous draft didn't reference any specific named fact (a tool, certification, " +
  "current title, or employer) even though one was available in LEAD FACTS. Regenerate " +
  "the draft and this time explicitly name at least one of them, per the HARD REQUIREMENT " +
  "rule above.";

/** Concrete, named facts a draft can point to -- used to verify the model
 * actually cited something specific rather than only a generic category. */
function specificFactStrings(lead: Lead): string[] {
  const facts: string[] = [];
  facts.push(...lead.toolsSoftware);
  facts.push(...lead.certifications);
  if (lead.currentTitle) facts.push(lead.currentTitle);
  if (lead.vendorExperience) {
    facts.push(...lead.vendorExperience.split(",").map((c) => c.trim()).filter(Boolean));
  }
  return facts.filter(Boolean);
}

function hasSpecificFact(body: string, facts: string[]): boolean {
  const lowered = body.toLowerCase();
  return facts.some((f) => lowered.includes(f.toLowerCase()));
}

/** Guardrail: make sure the canonical brand links survived generation.
 * LinkedIn connection notes are hard-capped at 200 characters -- only the
 * apply link is enforced there, since it's the one actual call to action;
 * the separate "Visit: site" line email gets would otherwise burn chars that
 * should go to the lead's actual enriched facts (e.g. years of experience). */
function ensureLinks(body: string, channel: string): string {
  let text = body;
  if (!text.includes(BRAND.apply_url) && !text.includes("app.global3.io/apply")) {
    const sep = channel === "linkedin" ? " " : "\n\n";
    text += `${sep}Apply here: ${BRAND.apply_url}`;
  }
  if (channel !== "linkedin" && !text.includes(BRAND.site)) {
    text += `\n\nVisit: ${BRAND.site}`;
  }
  return text.trim();
}

function parseDraftJson(text: string): Record<string, any> {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && start < end) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through to raw-text fallback below
      }
    }
  }
  console.warn("[draftGenerator] Draft output was not valid JSON; treating whole output as body.");
  return { body: text };
}

/** Generate an outreach email draft, personalized from the lead's real enriched facts. */
export async function generateEmail(
  client: ClaudeClient,
  cfg: DraftingConfig,
  lead: Lead,
  rateMatch: RateMatch | null = null,
  rateFlag: string | null = null
): Promise<Draft> {
  const [system, user] = buildEmailPrompt(lead, rateMatch);
  let completion = await client.chat(system, user, {
    model: cfg.genModel,
    temperature: cfg.genTemperature,
    jsonMode: true,
    maxTokens: 900,
  });
  let data = parseDraftJson(completion.text);

  const specificFacts = specificFactStrings(lead);
  if (specificFacts.length && !hasSpecificFact(data.body || "", specificFacts)) {
    console.warn(`[draftGenerator] Email draft for ${lead.firstName} cited no specific fact from ${specificFacts} -- regenerating once`);
    const retryUser = `${user}\n\n${SPECIFICITY_RETRY_NOTE}`;
    completion = await client.chat(system, retryUser, {
      model: cfg.genModel,
      temperature: cfg.genTemperature,
      jsonMode: true,
      maxTokens: 900,
    });
    data = parseDraftJson(completion.text);
    if (!hasSpecificFact(data.body || "", specificFacts)) {
      console.warn(`[draftGenerator] Retry for ${lead.firstName} still cited no specific fact; keeping it as best-effort`);
    }
  }

  const subject = (data.subject || `Freelance partnership with ${BRAND.company}`).trim();
  const body = ensureLinks((data.body || "").trim(), "email");
  return {
    channel: "email",
    lead,
    subject,
    body,
    model: completion.model,
    latency_ms: completion.latency_ms,
    prompt_tokens: completion.prompt_tokens,
    completion_tokens: completion.completion_tokens,
    rate_match: rateMatch,
    rate_flag: rateFlag,
  };
}

/** Generate a LinkedIn connection note draft, personalized from the lead's real enriched facts. */
export async function generateLinkedin(
  client: ClaudeClient,
  cfg: DraftingConfig,
  lead: Lead,
  rateMatch: RateMatch | null = null,
  rateFlag: string | null = null
): Promise<Draft> {
  const [system, user] = buildLinkedinPrompt(lead, rateMatch);
  let completion = await client.chat(system, user, {
    model: cfg.genModel,
    temperature: cfg.genTemperature,
    jsonMode: true,
    maxTokens: 400,
  });
  let data = parseDraftJson(completion.text);

  const specificFacts = specificFactStrings(lead);
  if (specificFacts.length && !hasSpecificFact(data.body || "", specificFacts)) {
    console.warn(`[draftGenerator] LinkedIn draft for ${lead.firstName} cited no specific fact from ${specificFacts} -- regenerating once`);
    const retryUser = `${user}\n\n${SPECIFICITY_RETRY_NOTE}`;
    completion = await client.chat(system, retryUser, {
      model: cfg.genModel,
      temperature: cfg.genTemperature,
      jsonMode: true,
      maxTokens: 400,
    });
    data = parseDraftJson(completion.text);
    if (!hasSpecificFact(data.body || "", specificFacts)) {
      console.warn(`[draftGenerator] Retry for ${lead.firstName} still cited no specific fact; keeping it as best-effort`);
    }
  }

  const body = ensureLinks((data.body || "").trim(), "linkedin");
  return {
    channel: "linkedin",
    lead,
    subject: null,
    body,
    model: completion.model,
    latency_ms: completion.latency_ms,
    prompt_tokens: completion.prompt_tokens,
    completion_tokens: completion.completion_tokens,
    rate_match: rateMatch,
    rate_flag: rateFlag,
  };
}
