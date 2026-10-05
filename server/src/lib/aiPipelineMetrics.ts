/**
 * The four AI Pipeline cards on the owner's Settings page. They used to be
 * hardcoded copy ("masked lead #H-7724 at 0.55", "Madhu's queue -- 62%")
 * and three "coming soon" stubs. Every number here is now computed from
 * real rows; GET /api/reports/ai-pipeline (reports.routes.ts) does the
 * queries. Pure functions, no Prisma, so they are tested with plain arrays
 * (aiPipelineMetrics.test.ts).
 *
 * Each metric reports its own sample size. A card with nothing to measure
 * says so, rather than showing a confident-looking 0%.
 *
 * LinkedIn match confidence was removed on 2026-10-05: G3 trusts recruiters
 * and contractors on who a lead is, so identity is not something this
 * dashboard reports on (duplicate detection is the check that matters).
 */

function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 2. Reply-classification accuracy ---------------------------------------------
/** Every time a recruiter classified a reply by hand after the AI had already
 *  classified it, that is one review. Agreement is the share of reviews
 *  where the recruiter landed on the same category the AI picked. AI reads
 *  no recruiter has looked at yet are counted, but never scored as agreement. */
export function classificationAgreement(
  events: Array<{ leadId: string; source: "AUTO" | "MANUAL"; categoryId: string | null; createdAt: Date }>
) {
  const byLead = new Map<string, typeof events>();
  for (const e of events) byLead.set(e.leadId, [...(byLead.get(e.leadId) ?? []), e]);

  let aiClassifiedLeads = 0;
  let reviews = 0;
  let agreed = 0;
  for (const list of byLead.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (sorted.some((e) => e.source === "AUTO")) aiClassifiedLeads++;
    let lastAuto: (typeof sorted)[number] | null = null;
    for (const e of sorted) {
      if (e.source === "AUTO") lastAuto = e;
      else if (lastAuto) {
        reviews++;
        if (e.categoryId === lastAuto.categoryId) agreed++;
      }
    }
  }
  return { aiClassifiedLeads, reviews, agreed, overridden: reviews - agreed, agreementPct: pct(agreed, reviews) };
}

// 3. AI-draft edit rate --------------------------------------------------------
const normalizeText = (t: string) => t.replace(/\s+/g, " ").trim();

/** Sent email-queue items that started from an AI draft: how many went out
 *  with the recruiter's edits vs exactly as drafted (whitespace ignored). */
export function draftEditRate(sent: Array<{ aiDraftText: string; body: string }>) {
  const edited = sent.filter((s) => normalizeText(s.aiDraftText) !== normalizeText(s.body)).length;
  return { aiDraftsSent: sent.length, edited, sentAsDrafted: sent.length - edited, editRatePct: pct(edited, sent.length) };
}

// 4. Time to first reply, by language and channel ------------------------------
export interface ReplyBucket {
  key: string;
  contacted: number;
  replied: number;
  replyRatePct: number | null;
  medianHoursToReply: number | null;
}

/** Per lead and channel: the first outbound message, then the first inbound
 *  one after it on the same channel. Inbound mail that predates any outreach
 *  (an old thread, a cold inbound) is not a reply and is ignored. */
export function timeToFirstReply(
  events: Array<{ leadId: string; direction: "INBOUND" | "OUTBOUND"; channel: string; occurredAt: Date }>,
  languageByLead: Map<string, string | null>
) {
  const threads = new Map<string, { leadId: string; channel: string; firstOut?: Date; firstReply?: Date }>();
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const e of sorted) {
    const k = `${e.leadId}|${e.channel}`;
    const t = threads.get(k) ?? { leadId: e.leadId, channel: e.channel };
    if (e.direction === "OUTBOUND" && !t.firstOut) t.firstOut = e.occurredAt;
    if (e.direction === "INBOUND" && t.firstOut && !t.firstReply) t.firstReply = e.occurredAt;
    threads.set(k, t);
  }

  const bucket = (keyOf: (t: { leadId: string; channel: string }) => string): ReplyBucket[] => {
    const groups = new Map<string, { contacted: number; hours: number[] }>();
    for (const t of threads.values()) {
      if (!t.firstOut) continue;
      const g = groups.get(keyOf(t)) ?? { contacted: 0, hours: [] };
      g.contacted++;
      if (t.firstReply) g.hours.push((t.firstReply.getTime() - t.firstOut.getTime()) / 3_600_000);
      groups.set(keyOf(t), g);
    }
    return [...groups.entries()]
      .map(([key, g]) => {
        const med = median(g.hours);
        return {
          key,
          contacted: g.contacted,
          replied: g.hours.length,
          replyRatePct: pct(g.hours.length, g.contacted),
          medianHoursToReply: med == null ? null : Math.round(med * 10) / 10,
        };
      })
      .sort((a, b) => b.contacted - a.contacted);
  };

  return {
    byChannel: bucket((t) => t.channel),
    byLanguage: bucket((t) => languageByLead.get(t.leadId) || "Unknown"),
  };
}

// 5. Unresolved-identity trend -------------------------------------------------
/** Current unresolved count, plus weekly cohorts: of the leads created each
 *  week, how many still have no resolved identity. A falling line means
 *  newer leads are being resolved; nothing stores a historical snapshot, so
 *  cohorts are the honest way to show direction. */
export function identityHealth(leads: Array<{ createdAt: Date; identityResolved: boolean }>, now: Date, weeks = 8) {
  const DAY = 86_400_000;
  const startOfWeek = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); // Monday
    return x;
  };
  const thisWeek = startOfWeek(now);
  const cohorts = Array.from({ length: weeks }, (_, i) => {
    const weekStart = new Date(thisWeek.getTime() - (weeks - 1 - i) * 7 * DAY);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
    const inWeek = leads.filter((l) => l.createdAt >= weekStart && l.createdAt < weekEnd);
    const unresolved = inWeek.filter((l) => !l.identityResolved).length;
    return { weekStart: weekStart.toISOString().slice(0, 10), created: inWeek.length, unresolved, unresolvedPct: pct(unresolved, inWeek.length) };
  });
  const unresolvedNow = leads.filter((l) => !l.identityResolved).length;
  return { totalLeads: leads.length, unresolvedNow, unresolvedPct: pct(unresolvedNow, leads.length), cohorts };
}
