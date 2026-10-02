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
import { redactClientIfContractor, redactClientUnlessAssigned } from "./requirement.routes";

const SAMPLE = { id: "req-1", language: "German", service: "Dubbing", client: { name: "Acme Studios" } };

const ME = { role: "contractor", id: "user-me" };
const SCOPED = { ...SAMPLE, clientId: "client-1", recruiterId: null as string | null };

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

function test5_contractorKeepsClientOnTheirOwnAssignedRequirement() {
  // The /contractor/clients page: a requirement assigned to this contractor
  // is their own work, so they get to see who it's for.
  const mine = redactClientUnlessAssigned(ME, { ...SCOPED, recruiterId: ME.id });
  assert.deepStrictEqual(mine.client, { name: "Acme Studios" });
  assert.strictEqual(mine.clientId, "client-1");
}

function test6_contractorLosesClientOnSomeoneElsesRequirement() {
  const theirs = redactClientUnlessAssigned(ME, { ...SCOPED, recruiterId: "user-other" });
  assert.ok(!("client" in theirs), "another person's requirement must not carry client");
}

function test7_contractorLosesClientOnUnassignedDemand() {
  // Default-deny: no assignee at all is not "mine".
  const orphan = redactClientUnlessAssigned(ME, { ...SCOPED, recruiterId: null });
  assert.ok(!("client" in orphan));
}

function test8_clientIdIsStrippedAlongsideClient() {
  // Leaving clientId behind would let a contractor who legitimately learned
  // clientId -> name from their own row re-identify every other requirement
  // for that client in the same response.
  const theirs = redactClientUnlessAssigned(ME, { ...SCOPED, recruiterId: "user-other" });
  assert.ok(!("clientId" in theirs), "clientId is a re-identification key, strip it with client");
}

function test9_recruitersAndOwnersAreUnaffectedByScoping() {
  const row = { ...SCOPED, recruiterId: "user-other" };
  assert.deepStrictEqual(redactClientUnlessAssigned({ role: "recruiter", id: "r1" }, row), row);
  assert.deepStrictEqual(redactClientUnlessAssigned({ role: "owner", id: "o1" }, row), row);
}

function test10_scopedRedactionIsCaseInsensitiveOnRole() {
  const theirs = redactClientUnlessAssigned({ role: "CONTRACTOR", id: "user-me" }, { ...SCOPED, recruiterId: "user-other" });
  assert.ok(!("client" in theirs), "must not fail open over a casing mismatch");
}

function main() {
  const tests = [
    test1_contractorNeverSeesClientKey,
    test2_recruiterAndOwnerSeeClientUnchanged,
    test3_nonClientFieldsSurviveRedactionIntact,
    test4_caseInsensitiveRoleMatch,
    test5_contractorKeepsClientOnTheirOwnAssignedRequirement,
    test6_contractorLosesClientOnSomeoneElsesRequirement,
    test7_contractorLosesClientOnUnassignedDemand,
    test8_clientIdIsStrippedAlongsideClient,
    test9_recruitersAndOwnersAreUnaffectedByScoping,
    test10_scopedRedactionIsCaseInsensitiveOnRole,
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
