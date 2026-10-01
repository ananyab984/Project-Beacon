/** Matches a lead's raw message against every active FAQ's OWN tags,
 * directly -- the systemic replacement for relying on a hardcoded,
 * manually-maintained keyword allowlist (the old FAQ_KEYWORDS approach in
 * questionExtractor.ts).
 *
 * FAQ tags are already generated automatically on creation (see
 * generateFaqKeywords in draftGenerator.ts, called from POST /api/faq) --
 * an owner never types them by hand. This function is the other half of
 * that design: instead of requiring the LEAD's message to happen to contain
 * one of a separate, static list of terms someone remembered to add to
 * code, it checks the message against whatever tags each FAQ actually has,
 * every time. A new FAQ becomes findable by its own tags the moment it's
 * created -- no code change, no keyword-list edit, ever required again.
 *
 * Root cause this replaces: "Tell me MSA process" found nothing because
 * "msa" wasn't in FAQ_KEYWORDS and the message had no punctuation for
 * extractQuestions to split on, so the only search term tried was the
 * whole diluted phrase. That's a structural gap that would recur for any
 * other FAQ topic never added to that list -- this function has no such
 * list to fall behind on. */

import { prisma } from "../prisma";

export interface FaqTagCandidate {
  id: string;
  question: string;
  answer: string;
  tags: string[];
}

export interface TagMatchedFaq {
  id: string;
  question: string;
  answer: string;
  matchedTag: string;
}

// Excludes tags that are themselves common English function words/pronouns
// from whole-word matching -- confirmed live against this data:
// faq_voice_jurisdiction is tagged "us" (short for "the United States", from
// its question "Jurisdiction in the US"), and unlike FAQ_KEYWORDS this isn't
// a per-topic list that grows with every new FAQ -- it's fixed by the
// structure of English itself, so no future FAQ or tag can ever require an
// addition here. Postgres's own 'english' stopword list (already governing
// search_vector) was checked first and does NOT cover this -- to_tsvector
// keeps 'us' as a real lexeme -- so it can't be reused for this purpose;
// this list is deliberately scoped to pronouns/articles/conjunctions/
// prepositions a generated tag could plausibly collide with, not a general
// NLP stopword list.
const TAG_MATCH_STOPWORDS = new Set([
  "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his",
  "she", "her", "hers", "it", "its", "we", "us", "our", "ours",
  "they", "them", "their", "theirs", "this", "that", "these", "those",
  "a", "an", "the", "and", "or", "but", "if", "so", "as", "of", "at",
  "by", "for", "with", "about", "against", "between", "into", "through",
  "to", "from", "up", "down", "in", "on", "off", "over", "under",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "will", "would", "should", "could", "can", "may",
  "not", "no", "yes", "ok",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fetches every active FAQ's tag-matching fields once. Callers that need
 * to match multiple terms/messages against the same candidate set (e.g. the
 * per-term loop in faq.routes.ts) should call this ONCE per request and pass
 * the result to `matchFaqsByMessageTags` for each term, rather than calling
 * `findFaqsByMessageTags` per term -- that would re-fetch the whole table
 * from the database once per term for no reason.
 *
 * Self-contained resilience, matching findKeywordCandidates' established
 * convention in semanticFaqSearch.ts: a transient DB failure here degrades
 * to "no tag candidates" (logged, not thrown) rather than failing whichever
 * request called this -- tag matching is an enhancement on top of the
 * existing SQL search, not something that should ever be able to break it. */
export async function loadActiveFaqTagCandidates(): Promise<FaqTagCandidate[]> {
  try {
    return await prisma.faqEntry.findMany({
      where: { isActive: true },
      select: { id: true, question: true, answer: true, tags: true },
    });
  } catch (err: any) {
    console.error(`[FAQ] Failed to load FAQ tag candidates:`, err.message);
    return [];
  }
}

/** Pure matching logic, no DB access: which of `faqs` has at least one tag
 * that appears as a whole word in `message` (case-insensitive), excluding
 * tags that are themselves common English function words (see
 * TAG_MATCH_STOPWORDS above). */
export function matchFaqsByMessageTags(message: string, faqs: FaqTagCandidate[]): TagMatchedFaq[] {
  if (!message || !message.trim()) return [];

  const matches: TagMatchedFaq[] = [];
  for (const faq of faqs) {
    for (const rawTag of faq.tags) {
      const tag = rawTag.trim();
      if (!tag || TAG_MATCH_STOPWORDS.has(tag.toLowerCase())) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(tag)}\\b`, "i");
      if (pattern.test(message)) {
        matches.push({ id: faq.id, question: faq.question, answer: faq.answer, matchedTag: tag });
        break; // one matched tag is enough to include this FAQ once
      }
    }
  }
  return matches;
}

/** Convenience single-shot wrapper (fetch + match) for callers matching
 * only one term/message -- e.g. tests, or a one-off caller. Callers that
 * loop over multiple terms in one request should use
 * `loadActiveFaqTagCandidates` + `matchFaqsByMessageTags` instead, to avoid
 * re-fetching the FAQ table once per term. */
export async function findFaqsByMessageTags(message: string): Promise<TagMatchedFaq[]> {
  if (!message || !message.trim()) return [];
  const faqs = await loadActiveFaqTagCandidates();
  return matchFaqsByMessageTags(message, faqs);
}
