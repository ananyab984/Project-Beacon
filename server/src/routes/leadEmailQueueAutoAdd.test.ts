/**
 * Regression check for lead.routes.ts: neither the single-lead POST
 * /api/leads path nor the shared bulk-create helper (createLeadsFromRows,
 * used by POST /api/leads/bulk and POST /api/leads/import-from-sheet) may
 * ever auto-create an EmailQueueItem again.
 *
 * Both paths used to do exactly that for every recruiter/owner-created
 * lead, so a recruiter who had only ever added leads -- never opened the
 * Email Queue page's own "Search Lead" -> add action (POST
 * /api/email-queue, the one and only place an EmailQueueItem should ever
 * be created) -- found several names already sitting in their queue with
 * no explicit action taken.
 *
 * Deliberately a source-level check rather than a real-DB call through
 * createLeadsFromRows/the POST /api/leads handler: both paths fire
 * enrichLeadById(leadId) via setImmediate as an unconditional side effect
 * of creating a lead (see enrichment.job.ts), which makes a real HTTP call
 * out to the Python enrichment service -- exactly the "no live network
 * calls in a test" outcome this repo's other lead-creation tests
 * (leadContractorParity.test.ts, outreachFunnel.test.ts) avoid by seeding
 * fixtures directly via prisma.lead.create rather than calling the route
 * logic itself. There is no such direct-fixture equivalent for "verify a
 * function did NOT run" without invoking the function, so this checks the
 * one thing that actually matters here: the removed call sites stay
 * removed.
 *
 * Run: cd server && npx ts-node src/routes/leadEmailQueueAutoAdd.test.ts
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";

function test1_leadRoutesNeverAutoCreatesAnEmailQueueItem() {
  const source = readFileSync(path.join(__dirname, "lead.routes.ts"), "utf8");
  assert.ok(
    !source.includes("emailQueueItem.create"),
    "lead.routes.ts must never call prisma.emailQueueItem.create -- the Email Queue is opt-in " +
      "via its own POST /api/email-queue endpoint only, never auto-populated by lead creation"
  );
}

function test2_linkedInConversationAutoCreateIsStillThere() {
  // Guards against overcorrecting: removing the queue auto-add must not
  // also silently remove the wanted LinkedIn conversation auto-create.
  const source = readFileSync(path.join(__dirname, "lead.routes.ts"), "utf8");
  const occurrences = source.match(/prisma\.conversation\.create/g) ?? [];
  assert.strictEqual(occurrences.length, 2, "expected exactly one LinkedIn-conversation auto-create in each of the single-lead and bulk-create paths");
}

async function main() {
  const tests = [test1_leadRoutesNeverAutoCreatesAnEmailQueueItem, test2_linkedInConversationAutoCreateIsStillThere];
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
