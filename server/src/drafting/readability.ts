/** Readability scoring — Flesch Reading Ease & Flesch-Kincaid Grade Level.
 * Direct port of drafting_service/core/readability.py — keep in sync by eye. */

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/^[.:;!?,"'()]+|[.:;!?,"'()]+$/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:e$|es$|ed$)/, "");
  const matches = trimmed.match(/[aeiouy]+/g);
  return Math.max(1, matches ? matches.length : 0);
}

function wordsAndSentences(text: string): { words: string[]; sentenceCount: number } {
  const words = text.match(/\b\w+\b/g) || [];
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return { words, sentenceCount: Math.max(1, sentences.length) };
}

export function fleschReadingEase(text: string): number {
  const { words, sentenceCount } = wordsAndSentences(text);
  const nWords = words.length;
  if (nWords === 0) return 0.0;
  const nSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (nWords / sentenceCount) - 84.6 * (nSyllables / nWords);
  return Math.max(0.0, Math.min(100.0, score));
}

export function fleschKincaidGrade(text: string): number {
  const { words, sentenceCount } = wordsAndSentences(text);
  const nWords = words.length;
  if (nWords === 0) return 0.0;
  const nSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 0.39 * (nWords / sentenceCount) + 11.8 * (nSyllables / nWords) - 15.59;
  return Math.max(0.0, score);
}
