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

export interface TagMatchedFaq {
  id: string;
  question: string;
  answer: string;
  matchedTag: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds every active FAQ with at least one tag that appears as a whole
 * word in `message` (case-insensitive). Runs in application code, not a
 * raw-SQL regex, so a tag containing characters that would otherwise need
 * regex-escaping in SQL (or a message containing them) can never break the
 * query -- `escapeRegExp` handles that safely here instead. The FAQ table
 * is small (tens of rows), so fetching every active row and scanning in
 * memory is simpler and just as fast as pushing this into SQL. */
export async function findFaqsByMessageTags(message: string): Promise<TagMatchedFaq[]> {
  if (!message || !message.trim()) return [];

  const faqs = await prisma.faqEntry.findMany({
    where: { isActive: true },
    select: { id: true, question: true, answer: true, tags: true },
  });

  const matches: TagMatchedFaq[] = [];
  for (const faq of faqs) {
    for (const rawTag of faq.tags) {
      const tag = rawTag.trim();
      if (!tag) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(tag)}\\b`, "i");
      if (pattern.test(message)) {
        matches.push({ id: faq.id, question: faq.question, answer: faq.answer, matchedTag: tag });
        break; // one matched tag is enough to include this FAQ once
      }
    }
  }
  return matches;
}
