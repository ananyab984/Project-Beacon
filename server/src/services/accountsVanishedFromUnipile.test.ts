/**
 * Unit tests for accountsVanishedFromUnipile -- the diff that catches an
 * account disconnected/removed directly from Unipile's own dashboard, which
 * getUserConnectedAccounts's forward sync loop can never see (it only ever
 * updates accounts Unipile's /accounts still returns). Without this, a
 * removed account kept reading "Connected" here forever, Refresh included.
 *
 * Run: cd server && npx ts-node src/services/accountsVanishedFromUnipile.test.ts
 */
import assert from "node:assert";
import { accountsVanishedFromUnipile } from "./unipile.service";

function account(unipileAccountId: string) {
  return { id: `row-${unipileAccountId}`, unipileAccountId };
}

function test1_accountMissingFromLiveListIsVanished() {
  const result = accountsVanishedFromUnipile([account("acc-1")], new Set());
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].unipileAccountId, "acc-1");
}

function test2_accountStillInLiveListIsNotVanished() {
  const result = accountsVanishedFromUnipile([account("acc-1")], new Set(["acc-1"]));
  assert.strictEqual(result.length, 0);
}

function test3_onlyTheMissingOnesAreReturnedFromAMixedSet() {
  const result = accountsVanishedFromUnipile(
    [account("acc-1"), account("acc-2"), account("acc-3")],
    new Set(["acc-2"])
  );
  assert.deepStrictEqual(result.map((a) => a.unipileAccountId), ["acc-1", "acc-3"]);
}

function test4_emptyLocalAccountsYieldsEmptyResult() {
  assert.deepStrictEqual(accountsVanishedFromUnipile([], new Set(["acc-1"])), []);
}

function test5_emptyLiveSetMeansEveryLocalAccountVanished() {
  // A genuinely empty org-wide Unipile /accounts response (nothing connected
  // anywhere) must still flag every local row -- not be treated as "the
  // fetch didn't tell us anything."
  const result = accountsVanishedFromUnipile([account("acc-1"), account("acc-2")], new Set());
  assert.strictEqual(result.length, 2);
}

async function main() {
  const tests = [
    test1_accountMissingFromLiveListIsVanished,
    test2_accountStillInLiveListIsNotVanished,
    test3_onlyTheMissingOnesAreReturnedFromAMixedSet,
    test4_emptyLocalAccountsYieldsEmptyResult,
    test5_emptyLiveSetMeansEveryLocalAccountVanished,
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
