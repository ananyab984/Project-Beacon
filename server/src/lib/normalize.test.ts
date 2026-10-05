/**
 * The email queue's TO field had no check on any path -- autosave stored
 * "test", send handed it to Unipile. email-queue.routes.ts now runs every
 * recruiter-typed address through normalizeEmail + validateEmailFormat;
 * this pins what that pair accepts and rejects.
 *
 * Run: cd server && npx ts-node --transpile-only src/lib/normalize.test.ts
 */
import assert from "node:assert";
import { normalizeEmail, validateEmailFormat } from "./normalize";

const ok = (raw: string) => validateEmailFormat(normalizeEmail(raw));

const VALID = ["ana@example.com", "  Ana.Silva@Example.CO.uk ", "a+tag@sub.domain.io", "x@y.z"];
const INVALID = ["test", "", "   ", "ana@", "@example.com", "ana@example", "ana silva@example.com", "ana@@example.com", `${"a".repeat(250)}@x.io`];

let failed = 0;
for (const v of VALID) {
  try { assert.ok(ok(v), `should accept ${JSON.stringify(v)}`); console.log(`PASS accepts ${JSON.stringify(v)}`); }
  catch (e) { failed++; console.error(`FAIL ${(e as Error).message}`); }
}
for (const v of INVALID) {
  try { assert.ok(!ok(v), `should reject ${JSON.stringify(v).slice(0, 40)}`); console.log(`PASS rejects ${JSON.stringify(v).slice(0, 40)}`); }
  catch (e) { failed++; console.error(`FAIL ${(e as Error).message}`); }
}
try {
  assert.strictEqual(normalizeEmail("  Ana@Example.COM​ "), "ana@example.com", "trims, lowercases, strips zero-width");
  console.log("PASS normalizes before validating");
} catch (e) { failed++; console.error(`FAIL ${(e as Error).message}`); }

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1); }
console.log("All tests passed");
