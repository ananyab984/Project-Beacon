/**
 * Run: cd server && npx ts-node src/services/duplicateIndex.test.ts
 *
 * buildDuplicateIndex must give findDuplicateLead's answers (same rules, same
 * order) -- bulk uploads use it instead of up to four queries per row.
 */

import assert from "node:assert";
import { buildDuplicateIndex } from "./lead.service";

const lead = (id: string, f: Partial<{ fullName: string; displayName: string; email: string; profileLink: string; contactNumber: string }>) => ({
  id,
  fullName: f.fullName ?? null,
  displayName: f.displayName ?? null,
  email: f.email ?? null,
  profileLink: f.profileLink ?? null,
  contactNumber: f.contactNumber ?? null,
});

const index = buildDuplicateIndex([
  lead("e1", { fullName: "Ada Lovelace", email: "Ada@Example.com" }),
  lead("p1", { fullName: "Bea", profileLink: "https://www.linkedin.com/in/bea-smith/" }),
  lead("p2", { fullName: "Cy", profileLink: "https://www.linkedin.com/in/cy-long-slug-123?locale=en" }),
  lead("t1", { fullName: "Dee", contactNumber: "+44 7700 900123" }),
  lead("n1", { fullName: "Eve Torres", displayName: "Evelyn Torres" }),
]);

function test1_emailIsCaseInsensitiveAndWinsFirst() {
  const hit = index.find({ email: "  ada@example.COM ", fullName: "Evelyn Torres" });
  assert.strictEqual(hit.isDuplicate && hit.matchedField, "email_address");
  assert.strictEqual(hit.leadId, "e1");
  assert.strictEqual(index.find({ email: "not-an-email" }).isDuplicate, false);
}

function test2_profileLinkIgnoresProtocolWwwTrailingSlashAndCase() {
  for (const link of ["linkedin.com/in/bea-smith", "HTTP://LinkedIn.com/in/Bea-Smith///", "https://www.linkedin.com/in/bea-smith/"]) {
    const hit = index.find({ profileLink: link });
    assert.strictEqual(hit.leadId, "p1", link);
    assert.strictEqual(hit.matchedField, "profile_link");
  }
}

function test3_profileLinkContainsFallback() {
  // Stored link has a query string; the new one is contained in it.
  assert.strictEqual(index.find({ profileLink: "https://linkedin.com/in/cy-long-slug-123" }).leadId, "p2");
  // Too short to compare (<= 5 chars once normalized).
  assert.strictEqual(index.find({ profileLink: "https://a.io" }).isDuplicate, false);
}

function test4_phoneSuffixMatchesEitherWay() {
  assert.strictEqual(index.find({ contactNumber: "7700 900123" }).leadId, "t1"); // stored number ends with it
  assert.strictEqual(index.find({ contactNumber: "07700900123" }).isDuplicate, false); // trunk 0: neither is a suffix (same as findDuplicateLead)
  assert.strictEqual(index.find({ contactNumber: "0044 7700 900123" }).leadId, "t1"); // longer
  assert.strictEqual(index.find({ contactNumber: "900123" }).isDuplicate, false); // under 7 digits
  assert.strictEqual(index.find({ contactNumber: "7700 900124" }).isDuplicate, false);
}

function test5_nameMatchesFullOrDisplayName() {
  assert.strictEqual(index.find({ fullName: " evelyn torres " }).leadId, "n1");
  assert.strictEqual(index.find({ fullName: "EVE TORRES" }).matchedField, "full_name");
  assert.strictEqual(index.find({ fullName: "Ev" }).isDuplicate, false); // under 3 chars
}

function test6_noMatch() {
  const miss = index.find({ email: "new@x.io", profileLink: "linkedin.com/in/someone-new", contactNumber: "+1 555 0100 999", fullName: "Brand New" });
  assert.deepStrictEqual(miss, { isDuplicate: false, matchedField: null, leadId: null, matchedName: null, lead: null });
}

const tests = [
  test1_emailIsCaseInsensitiveAndWinsFirst,
  test2_profileLinkIgnoresProtocolWwwTrailingSlashAndCase,
  test3_profileLinkContainsFallback,
  test4_phoneSuffixMatchesEitherWay,
  test5_nameMatchesFullOrDisplayName,
  test6_noMatch,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`  PASS  ${t.name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL  ${t.name}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
