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
import { buildShortApplyUrl } from "../lib/onboarding/shortLink";

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
 * should go to the lead's actual enriched facts (e.g. years of experience).
 *
 * The prompt (promptBuilder.ts) still tells Claude the apply portal is
 * BRAND.apply_url -- that canonical text is left alone rather than
 * reshaping the carefully-tuned prompt around a "short link" concept. This
 * function is the one place the static URL, if the model wrote it out,
 * gets swapped for this specific lead's personalized short link
 * ("{appBaseUrl}/g/{token}", see lib/onboarding/shortLink.ts) before the
 * text ever reaches the candidate -- or appended if the model omitted it
 * entirely. */
function ensureLinks(body: string, channel: string, applyUrl: string): string {
  let text = body;
  if (text.includes(BRAND.apply_url)) {
    text = text.split(BRAND.apply_url).join(applyUrl);
  } else if (!text.includes(applyUrl)) {
    const sep = channel === "linkedin" ? " " : "\n\n";
    text += `${sep}Apply here: ${applyUrl}`;
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
  leadId: string,
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
  const body = ensureLinks((data.body || "").trim(), "email", buildShortApplyUrl(leadId));
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
  leadId: string,
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

  const body = ensureLinks((data.body || "").trim(), "linkedin", buildShortApplyUrl(leadId));
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

CRITICAL GROUNDING REQUIREMENT:
- You MUST use the provided FAQ answers as your source material
- You MUST NOT say "I don't have information", "I'm unable to answer", "not available", or similar refusals
- The FAQs provided ARE sufficient to answer the candidate's questions
- If a FAQ is provided, use it - do not refuse or hedge
- Rephrase and contextualize the FAQ content, but never refuse or claim lack of information

${isMultipleFaqs ? "MULTI-QUESTION: Answer all questions using the provided FAQs. Acknowledge questions without FAQ coverage only if explicitly listed. Otherwise, ground every response in the FAQs provided." : ""}

SOPHISTICATION REQUIREMENT: Rephrase FAQ content in a professional, personalized way:
- Adapt phrasing to their specific questions
- Use sophisticated vocabulary and sentence structure
- Sound like a knowledgeable person, not a script
- Keep responses concise but complete

RESPONSE RULE: Your response must always provide a substantive answer grounded in the FAQs. Never refuse or hedge.`;

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

/** Generate FAQ reply with optional conversation context for personalization */
export async function generateFaqReplyWithContext(
  client: ClaudeClient,
  cfg: DraftingConfig,
  leadMessage: string,
  faqs: Array<{ question: string; answer: string }>,
  conversationHistory?: Array<{ role: "user" | "assistant"; text: string }>,
  unansweredQuestions?: string[]
): Promise<FaqReply> {
  const system = `You are a professional, knowledgeable support representative responding to candidate inquiries.
Your task is to answer candidate questions in a sophisticated, well-articulated way, drawing from the provided FAQ answers.

CRITICAL GROUNDING REQUIREMENT:
- You MUST use the provided FAQ answers as your source material
- The FAQ content is your primary source of truth
- Conversation context is ONLY for tone/personalization, never for facts
- Do not invent or assume information not in the FAQs
- Never say "I don't have information" or refuse when FAQ is provided

CONTEXT USAGE:
- Use conversation context ONLY to match tone and style
- Remain factually grounded in FAQ data
- If FAQ doesn't cover a topic, acknowledge it briefly but don't hallucinate

SOPHISTICATION REQUIREMENT: Rephrase FAQ content professionally:
- Adapt phrasing to their specific questions
- Match the tone of the ongoing conversation
- Use sophisticated vocabulary and sentence structure
- Sound like a knowledgeable person, not a script
- Keep responses concise but complete

RESPONSE RULE: Your response must always provide a substantive answer grounded in the FAQs.`;

  const faqText = faqs
    .map((f, i) => `FAQ ${i + 1}:\nQuestion: ${f.question}\nAnswer: ${f.answer}`)
    .join("\n\n");

  const unansweredText =
    unansweredQuestions && unansweredQuestions.length > 0
      ? `\n\nQuestions without FAQ coverage:\n${unansweredQuestions.map((q) => `- ${q}`).join("\n")}\n(Acknowledge these briefly but note manual follow-up required)`
      : "";

  // Extract intent from recent messages without exposing raw text (PII protection)
  let contextBlock = "";
  if (conversationHistory && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-2); // Last 2 messages only
    const intentSummary = recentMessages
      .map((m) => {
        // Summarize intent without exposing full text
        const text = m.text.toLowerCase();
        let intent = "providing information";
        if (text.includes("question") || text.includes("ask")) intent = "asking a question";
        if (text.includes("concern") || text.includes("worried")) intent = "expressing concern";
        if (text.includes("clarif")) intent = "asking for clarification";
        return `${m.role}: ${intent}`;
      })
      .join("\n");

    contextBlock = `\n\nConversation context (tone reference only):\n${intentSummary}\n\nMaintain this conversational tone while staying grounded in FAQ facts.`;
  }

  const user = `Candidate's current message: "${leadMessage}"

${faqText}${unansweredText}${contextBlock}

Provide a single, flowing response that:
1. Addresses all questions you have FAQ answers for
2. Uses professional language matching the conversation tone
3. Acknowledges any unanswered questions briefly
4. Is grounded entirely in the provided FAQs
5. Feels natural and personalized, not scripted

Keep it concise (2-3 paragraphs) but make every sentence count.`;

  const completion = await client.chat(system, user, {
    model: cfg.genModel,
    temperature: 0.3,
    maxTokens: 400,
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
