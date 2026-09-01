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

export interface FaqReply {
  body: string;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

/** Generate a natural-language FAQ reply based on the candidate's question and a matched FAQ entry.
 * Enforces strict grounding: the model can only reference facts from the FAQ answer itself,
 * no external knowledge or assumptions. */
export async function generateFaqReply(
  client: ClaudeClient,
  cfg: DraftingConfig,
  leadMessage: string,
  faqQuestionOrFaqs: string | Array<{ question: string; answer: string }>,
  faqAnswerOrUnanswered?: string | string[]
): Promise<FaqReply> {
  // Support both single FAQ (legacy) and multiple FAQs (multi-question)
  const isMultipleFaqs = Array.isArray(faqQuestionOrFaqs);

  const system = `You are a professional, knowledgeable support representative responding to candidate inquiries.
Your task is to answer candidate questions in a sophisticated, well-articulated way, drawing from the provided FAQ answers.

GROUNDING REQUIREMENT: All core information must be grounded in the provided FAQ answers. Do not invent facts, timelines, rates, or policy details not present in the FAQs.

SOPHISTICATION REQUIREMENT: Rephrase and contextualize the FAQ answers to directly address the candidate's specific questions. Use clear, professional language. Avoid sounding like copy-paste FAQ text. Instead:
- Adapt your phrasing to their specific questions or concerns
- Use sophisticated vocabulary and sentence structure
- Add relevant context or emphasis where appropriate
- Break up dense information into digestible points
- Sound like a knowledgeable person, not a script

${isMultipleFaqs ? "MULTI-QUESTION: The candidate asked multiple questions. Answer all that you have FAQ information for in a single, flowing response. For questions without FAQ info, acknowledge them briefly and note they'll require manual follow-up." : ""}

Your response should feel personalized and thoughtful, while remaining 100% factually grounded in the FAQ content.`;

  let user: string;

  if (isMultipleFaqs) {
    const faqs = faqQuestionOrFaqs as Array<{ question: string; answer: string }>;
    const unanswered = (faqAnswerOrUnanswered as string[]) || [];

    const faqText = faqs
      .map((f, i) => `FAQ ${i + 1}:\nQuestion: ${f.question}\nAnswer: ${f.answer}`)
      .join("\n\n");

    const unansweredText =
      unanswered.length > 0
        ? `\n\nQuestions without FAQ coverage (acknowledge but note manual follow-up required):\n${unanswered.map((q) => `- ${q}`).join("\n")}`
        : "";

    user = `Candidate's message: "${leadMessage}"

${faqText}${unansweredText}

Provide a single, flowing response that addresses all the questions you have FAQ answers for.
Use professional language, avoid sounding like a script, and acknowledge any unanswered questions briefly.
Keep it concise (2-3 paragraphs), but make every sentence count with clarity and professionalism.`;
  } else {
    const faqQuestion = faqQuestionOrFaqs as string;
    const faqAnswer = faqAnswerOrUnanswered as string;

    user = `Candidate's question: "${leadMessage}"

FAQ entry:
Question: ${faqQuestion}
Answer: ${faqAnswer}

Provide a sophisticated, well-articulated response to their specific question using the FAQ answer as your source material.
Adapt your phrasing to their question, use professional language, and avoid sounding like a generic copy-paste.
Keep it concise (1-2 paragraphs), but make every sentence count with clarity and professionalism.`;
  }

  const completion = await client.chat(system, user, {
    model: cfg.genModel,
    temperature: 0.3,
    maxTokens: 300,
  });

  return {
    body: completion.text.trim(),
    model: completion.model,
    latency_ms: completion.latency_ms,
    prompt_tokens: completion.prompt_tokens,
    completion_tokens: completion.completion_tokens,
  };
}

/** Extract 3-5 short semantic keywords from an FAQ question + answer, for storing
 * in `faqEntry.tags` so newly created FAQs are searchable without manual tagging.
 * Low temperature keeps the extraction stable across repeat calls. */
export async function generateFaqKeywords(
  client: ClaudeClient,
  cfg: DraftingConfig,
  faqQuestion: string,
  faqAnswer: string
): Promise<{ keywords: string[] }> {
  const system = `You are an expert at extracting semantic keywords from FAQ entries.
Your task is to extract 3-5 short, meaningful keywords that represent the core topics
of this FAQ. These keywords are used for search and categorization.

Return ONLY a JSON object with a "keywords" array of strings. No markdown, no explanation.
Example: {"keywords": ["payment", "training", "schedule"]}`;

  const user = `FAQ Question: ${faqQuestion}

FAQ Answer: ${faqAnswer}

Extract 3-5 semantic keywords that capture the main topics. Keep keywords short (1-2 words).
Focus on searchable concepts users would ask about.`;

  const completion = await client.chat(system, user, {
    model: cfg.genModel,
    temperature: 0.1,
    maxTokens: 150,
  });

  let data: any;
  try {
    data = JSON.parse(completion.text);
  } catch {
    const start = completion.text.indexOf("{");
    const end = completion.text.lastIndexOf("}");
    if (start >= 0 && start < end) {
      data = JSON.parse(completion.text.slice(start, end + 1));
    } else {
      throw new Error("Could not parse keywords from Claude response");
    }
  }

  const keywords = Array.isArray(data.keywords) ? data.keywords.filter((k: any) => typeof k === "string") : [];
  return { keywords };
}
