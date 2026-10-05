/**
 * The email queue TO field's inline check must agree with the server's
 * (server/src/lib/normalize.test.ts uses the same cases), plus the two
 * non-email values the field legitimately carries.
 *
 * Run: cd client && npx tsx src/lib/utils.test.ts
 */
import assert from "node:assert";
import { isAcceptableRecipient, isValidEmail } from "./utils";

for (const v of ["ana@example.com", "  Ana.Silva@Example.CO.uk ", "a+tag@sub.domain.io", "x@y.z"])
  assert.ok(isValidEmail(v), v);
for (const v of [
  "test",
  "",
  "   ",
  "ana@",
  "@example.com",
  "ana@example",
  "ana silva@example.com",
  "ana@@example.com",
])
  assert.ok(!isValidEmail(v), v);

assert.ok(isAcceptableRecipient(""), "empty falls back to the lead's own email");
assert.ok(
  isAcceptableRecipient("https://www.linkedin.com/in/ana"),
  "LinkedIn path carries a profile URL",
);
assert.ok(!isAcceptableRecipient("test"), "the reported bug: a bare word must be rejected");
console.log("All utils tests passed");
