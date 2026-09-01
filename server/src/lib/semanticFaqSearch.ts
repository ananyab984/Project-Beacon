import { ClaudeClient } from "../drafting/claudeClient";
import type { DraftingConfig } from "../drafting/config";
import { prisma } from "../prisma";

export interface SemanticFaqMatch {
  faqId: string;
  question: string;
  answer: string;
  confidence: number; // 0-1
  explanation: string;
  isKeywordMatch?: boolean; // true if already matched by keyword search
}

export interface SemanticSearchResult {
  matches: SemanticFaqMatch[];
  confidence: number;
  explanation: string;
}

/** Detect language of text using simple heuristics + Claude fallback */
export async function detectLanguage(text: string): Promise<string> {
  // Quick heuristics for common languages
  const englishMarkers = /\b(the|a|is|are|have|has|be|do|does|will|would|should|could|may|might)\b/gi;
  const spanishMarkers = /\b(el|la|los|las|es|son|está|están|tengo|tienes|tiene|tenemos)\b/gi;
  const frenchMarkers = /\b(le|la|les|est|sont|avoir|être|je|tu|il|elle|nous|vous)\b/gi;

  const english = (text.match(englishMarkers) || []).length;
  const spanish = (text.match(spanishMarkers) || []).length;
  const french = (text.match(frenchMarkers) || []).length;

  const maxScore = Math.max(english, spanish, french);

  if (english === maxScore && english > 2) return "en";
  if (spanish === maxScore && spanish > 2) return "es";
  if (french === maxScore && french > 2) return "fr";

  // Default to English if unclear
  return "en";
}

/** Stage 1: Find candidate FAQs using keyword relevance */
export async function findKeywordCandidates(question: string): Promise<
  Array<{ id: string; question: string; answer: string }>
> {
  try {
    const candidates = await prisma.$queryRaw<
      Array<{ id: string; question: string; answer: string }>
    >`
      SELECT id, question, answer
      FROM faq_entries
      WHERE is_active = true
        AND (
          search_vector @@ plainto_tsquery('english', ${question})
          OR question ILIKE '%' || ${question} || '%'
          OR answer ILIKE '%' || ${question} || '%'
        )
      ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${question})) DESC,
               similarity(question, ${question}) DESC
      LIMIT 15
    `;

    return candidates;
  } catch (err: any) {
    console.error(`[FAQ] Keyword candidate search failed:`, err.message);
    return [];
  }
}

/** Stage 2: Verify semantic relevance using Claude */
export async function verifySemanticRelevance(
  client: ClaudeClient,
  question: string,
  candidates: Array<{ id: string; question: string; answer: string }>
): Promise<SemanticFaqMatch[]> {
  if (candidates.length === 0) return [];

  const system = `You are a semantic FAQ analyzer. Given a candidate question and FAQ entries, determine which FAQs answer the question.

RESPONSE FORMAT (JSON only, no markdown):
{
  "matches": [
    {
      "faqId": "faq_id",
      "confidence": 0.85,
      "explanation": "Brief explanation of relevance"
    }
  ],
  "overallConfidence": 0.85
}

RULES:
- Only include FAQs that genuinely answer or relate to the question
- Confidence: 0-1 scale (0.8+ = highly relevant, 0.6-0.8 = related, <0.6 = skip)
- Focus on semantic meaning, not just keywords
- Be conservative: only suggest if confident in relevance`;

  const faqsText = candidates
    .map((f, i) => `[${i + 1}] ID: ${f.id}\nQ: ${f.question}\nA: ${f.answer.substring(0, 300)}...`)
    .join("\n\n");

  const user = `Candidate question: "${question}"

FAQ entries:
${faqsText}

Which FAQ(s) are semantically related to answering this question?
Return ONLY JSON, no other text.`;

  try {
    const completion = await client.chat(system, user, {
      model: "claude-opus-4-1-20250805", // Use more capable model for semantic analysis
      temperature: 0.2, // Low temperature for consistency
      maxTokens: 1000,
    });

    const parsed = JSON.parse(completion.text);

    if (!parsed.matches || !Array.isArray(parsed.matches)) {
      return [];
    }

    // Enrich matches with full FAQ data
    return parsed.matches
      .filter((m: any) => m.confidence >= 0.65) // Only confidence >= 65%
      .map((m: any) => {
        const faq = candidates.find((c) => c.id === m.faqId);
        if (!faq) return null;

        return {
          faqId: faq.id,
          question: faq.question,
          answer: faq.answer,
          confidence: m.confidence,
          explanation: m.explanation,
          isKeywordMatch: false,
        } as SemanticFaqMatch;
      })
      .filter(Boolean);
  } catch (err: any) {
    console.error(`[FAQ] Semantic verification failed:`, err.message);
    return [];
  }
}

/** Main semantic search: Two-stage (keyword → semantic verification) */
export async function semanticFaqSearch(
  client: ClaudeClient,
  question: string,
  existingMatchIds: Set<string> = new Set()
): Promise<SemanticFaqMatch[]> {
  console.log(`[FAQ] Starting semantic search for: "${question.substring(0, 50)}..."`);

  // Stage 1: Get keyword candidates
  const candidates = await findKeywordCandidates(question);
  console.log(`[FAQ] Found ${candidates.length} keyword candidates`);

  if (candidates.length === 0) {
    console.log(`[FAQ] No keyword candidates found, skipping semantic verification`);
    return [];
  }

  // Filter out FAQs already matched by exact search
  const uniqueCandidates = candidates.filter((c) => !existingMatchIds.has(c.id));
  console.log(`[FAQ] ${uniqueCandidates.length} unique candidates after deduplication`);

  if (uniqueCandidates.length === 0) {
    console.log(`[FAQ] All candidates already matched, skipping semantic verification`);
    return [];
  }

  // Stage 2: Verify semantic relevance
  const matches = await verifySemanticRelevance(client, question, uniqueCandidates);
  console.log(`[FAQ] Semantic verification found ${matches.length} relevant FAQs`);

  return matches;
}
