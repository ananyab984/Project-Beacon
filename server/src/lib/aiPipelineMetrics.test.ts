/**
 * The AI Pipeline cards were hardcoded copy. These pin that each metric is
 * computed from rows, and that "nothing to measure" reads as null, never a
 * confident-looking 0%.
 *
 * Run: cd server && npx ts-node --transpile-only src/lib/aiPipelineMetrics.test.ts
 */
import assert from "node:assert";
import { classificationAgreement, draftEditRate, identityHealth, timeToFirstReply } from "./aiPipelineMetrics";

const t = (iso: string) => new Date(iso);
const tests: Array<[string, () => void]> = [
  ["classification: a manual call is compared with the AI call right before it", () => {
    const r = classificationAgreement([
      { leadId: "1", source: "AUTO", categoryId: "interested", createdAt: t("2026-10-01") },
      { leadId: "1", source: "MANUAL", categoryId: "interested", createdAt: t("2026-10-02") }, // agree
      { leadId: "2", source: "AUTO", categoryId: "faq", createdAt: t("2026-10-01") },
      { leadId: "2", source: "MANUAL", categoryId: "dnc", createdAt: t("2026-10-02") }, // override
      { leadId: "3", source: "AUTO", categoryId: "faq", createdAt: t("2026-10-01") }, // not reviewed yet
      { leadId: "4", source: "MANUAL", categoryId: "faq", createdAt: t("2026-10-01") }, // no AI read to compare
    ]);
    assert.deepStrictEqual(r, { aiClassifiedLeads: 3, reviews: 2, agreed: 1, overridden: 1, agreementPct: 50 });
  }],
  ["classification: unreviewed AI reads never count as agreement", () => {
    const r = classificationAgreement([{ leadId: "1", source: "AUTO", categoryId: "x", createdAt: t("2026-10-01") }]);
    assert.strictEqual(r.agreementPct, null);
  }],
  ["edit rate: whitespace-only changes are not edits", () => {
    const r = draftEditRate([
      { aiDraftText: "Hi Ana,\n\nApply here.", body: "Hi Ana,  Apply here." },
      { aiDraftText: "Hi Ana, apply here.", body: "Hi Ana, I loved your work. Apply here." },
    ]);
    assert.deepStrictEqual(r, { aiDraftsSent: 2, edited: 1, sentAsDrafted: 1, editRatePct: 50 });
  }],
  ["first reply: inbound before any outreach is not a reply", () => {
    const r = timeToFirstReply(
      [
        { leadId: "1", direction: "INBOUND", channel: "EMAIL", occurredAt: t("2026-10-01T00:00Z") }, // ignored
        { leadId: "1", direction: "OUTBOUND", channel: "EMAIL", occurredAt: t("2026-10-02T00:00Z") },
        { leadId: "1", direction: "INBOUND", channel: "EMAIL", occurredAt: t("2026-10-02T06:00Z") }, // 6h
        { leadId: "2", direction: "OUTBOUND", channel: "LINKEDIN_DM", occurredAt: t("2026-10-02T00:00Z") }, // no reply
      ],
      new Map([["1", "German"], ["2", "Italian"]])
    );
    const email = r.byChannel.find((b) => b.key === "EMAIL")!;
    assert.deepStrictEqual(email, { key: "EMAIL", contacted: 1, replied: 1, replyRatePct: 100, medianHoursToReply: 6 });
    const li = r.byChannel.find((b) => b.key === "LINKEDIN_DM")!;
    assert.strictEqual(li.medianHoursToReply, null, "no reply yet is null, not 0h");
    assert.deepStrictEqual(r.byLanguage.map((b) => b.key).sort(), ["German", "Italian"]);
  }],
  ["identity: weekly cohorts count leads still unresolved", () => {
    const now = t("2026-10-05T12:00Z"); // a Monday
    const r = identityHealth(
      [
        { createdAt: t("2026-10-05T01:00Z"), identityResolved: false },
        { createdAt: t("2026-10-05T02:00Z"), identityResolved: true },
        { createdAt: t("2026-09-29T02:00Z"), identityResolved: true },
      ],
      now,
      2
    );
    assert.strictEqual(r.unresolvedNow, 1);
    assert.deepStrictEqual(r.cohorts.map((c) => [c.weekStart, c.created, c.unresolved]), [["2026-09-28", 1, 0], ["2026-10-05", 2, 1]]);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
if (failed) { console.error(`${failed}/${tests.length} failed`); process.exit(1); }
console.log(`All ${tests.length} tests passed`);
