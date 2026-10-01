/**
 * Unit tests for redactClientIfContractor -- the guard that lets contractors
 * see the same requirement-level detail recruiters do (per contractor/
 * recruiter parity) while never learning which client a requirement belongs
 * to. Pins that the `client` key is stripped entirely for a contractor
 * requester and left untouched for everyone else.
 *
 * Run: cd server && npx ts-node src/routes/requirementRedaction.test.ts
 */
import assert from "node:assert";
import { redactClientIfContractor } from "./requirement.routes";

const SAMPLE = { id: "req-1", language: "German", service: "Dubbing", client: { name: "Acme Studios" } };

function test1_contractorNeverSeesClientKey() {
  const result = redactClientIfContractor("contractor", SAMPLE);
  assert.ok(!("client" in result), "client key must be stripped entirely, not just its name");
}

function test2_recruiterAndOwnerSeeClientUnchanged() {
  assert.deepStrictEqual(redactClientIfContractor("recruiter", SAMPLE), SAMPLE);
  assert.deepStrictEqual(redactClientIfContractor("owner", SAMPLE), SAMPLE);
}

function test3_nonClientFieldsSurviveRedactionIntact() {
  const result = redactClientIfContractor("contractor", SAMPLE);
  assert.strictEqual((result as any).id, "req-1");
  assert.strictEqual((result as any).language, "German");
  assert.strictEqual((result as any).service, "Dubbing");
}

function test4_caseInsensitiveRoleMatch() {
  // req.user.role comes through as whatever case the auth layer set it --
  // don't silently fail to redact over a casing mismatch.
  const result = redactClientIfContractor("CONTRACTOR", SAMPLE);
  assert.ok(!("client" in result));
}

function main() {
  const tests = [
    test1_contractorNeverSeesClientKey,
    test2_recruiterAndOwnerSeeClientUnchanged,
    test3_nonClientFieldsSurviveRedactionIntact,
    test4_caseInsensitiveRoleMatch,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
