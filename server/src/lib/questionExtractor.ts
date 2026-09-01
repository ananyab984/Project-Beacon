/** Extract individual questions from a lead's message.
 * Handles various formats: punctuation, typos, run-on sentences.
 * Caps at 5 questions to avoid processing rants. */

export function extractQuestions(message: string): string[] {
  if (!message || typeof message !== "string") return [];

  // Split by sentence markers: . ! ? combined with whitespace
  const sentences = message
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Cap at 5 questions, prioritize earlier ones (more likely to be primary questions)
  const questions = sentences.slice(0, 5);

  return questions.length > 0 ? questions : [message.trim()];
}

/** Deduplicate FAQ results: if same FAQ matches multiple questions, keep only one.
 * Returns map of FAQ ID → { faqId, question, answer, originalQuestions } */
export function deduplicateMatches(
  matches: Array<{
    originalQuestion: string;
    faqId?: string;
    question?: string;
    answer?: string;
    rank?: number;
    sim?: number;
    tag_match?: number;
  }>
): Map<
  string,
  { faqId: string; question: string; answer: string; originalQuestions: string[] }
> {
  const deduped = new Map();

  for (const match of matches) {
    if (!match.faqId || !match.question || !match.answer) continue;

    if (deduped.has(match.faqId)) {
      // Same FAQ matched multiple questions: track all original questions
      const existing = deduped.get(match.faqId);
      existing.originalQuestions.push(match.originalQuestion);
    } else {
      deduped.set(match.faqId, {
        faqId: match.faqId,
        question: match.question,
        answer: match.answer,
        originalQuestions: [match.originalQuestion],
      });
    }
  }

  return deduped;
}
