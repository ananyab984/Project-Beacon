/** Classifies one inbound lead reply against the owner-managed
 * ReplyCategory list, using Groq (see groqClient.ts) for the actual
 * intent-matching call. Returns null ("Unclassified") when no category
 * clears CONFIDENCE_THRESHOLD, when the model can't find a plausible match,
 * or when the model returns a categoryId that isn't in the provided list
 * (never trust a hallucinated id onto a real Lead record). */

export interface ClassificationResult {
  categoryId: string;
  confidence: number;
}

export interface ReplyCategoryForClassification {
  id: string;
  name: string;
  description: string;
}

// Matches semanticFaqSearch.ts's proven confidence cutoff for the FAQ
// semantic fallback -- kept identical here rather than introducing a second
// tuned threshold with no data yet to justify a different number.
const CONFIDENCE_THRESHOLD = 0.65;

interface ChatLike {
  chat(system: string, user: string, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<{ text: string }>;
}

export async function classifyReply(
  client: ChatLike,
  messageText: string,
  categories: ReplyCategoryForClassification[]
): Promise<ClassificationResult | null> {
  if (categories.length === 0) return null;

  const categoryList = categories.map((c) => `- id: "${c.id}", name: "${c.name}" — ${c.description}`).join("\n");

  const system =
    "You classify inbound email/LinkedIn replies from freelance linguist candidates into exactly one category from a fixed list. " +
    "Pick the single best-matching category id and a confidence score from 0 to 1. " +
    'If nothing in the list plausibly matches, return {"categoryId": null, "confidence": 0}. ' +
    'Respond with a JSON object: {"categoryId": string | null, "confidence": number}.';

  const user = `Categories:\n${categoryList}\n\nReply to classify:\n"""\n${messageText}\n"""`;

  const completion = await client.chat(system, user, { jsonMode: true, maxTokens: 200 });

  let parsed: { categoryId?: string | null; confidence?: number };
  try {
    parsed = JSON.parse(completion.text);
  } catch {
    return null; // malformed model output -- treat as unclassified rather than throwing
  }

  if (!parsed.categoryId || typeof parsed.confidence !== "number") return null;
  if (parsed.confidence < CONFIDENCE_THRESHOLD) return null;
  if (!categories.some((c) => c.id === parsed.categoryId)) return null; // guard against a hallucinated id

  return { categoryId: parsed.categoryId, confidence: parsed.confidence };
}
