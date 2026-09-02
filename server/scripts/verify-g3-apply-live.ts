/** ONE-TIME, EXPLICITLY-TRIGGERED manual verification against the REAL
 * app.global3.io -- this is NOT part of the automated test suite, NOT run
 * by `npm test`, and NOT something any CI job or dev script reaches for on
 * its own. It refuses to run at all unless the live-call kill switch has
 * been deliberately opted into for this one supervised session.
 *
 * What this script does and does NOT do:
 *  - It builds a REAL apply URL (via the same buildApplyUrl() every
 *    automated test exercises against fixtures) for one specific lead, and
 *    prints it -- it does NOT submit the form itself. A human opens the
 *    printed URL in a real browser, checks the form pre-fills correctly,
 *    and submits it by hand.
 *  - It does NOT call the webhook receiver. G3's real form calling our
 *    real, already-deployed callback_url after a real submission IS the
 *    live test of the receiver side -- watch this server's own logs
 *    (tagged "[onboarding webhook]") for the receipt, exactly per the
 *    "log everything, don't ask G3 if it worked" requirement.
 *
 * Run via (from server/):
 *   G3_APPLY_ALLOW_LIVE=true G3_APPLY_BASE_URL=https://app.global3.io/apply \
 *     npx ts-node scripts/verify-g3-apply-live.ts <leadId>
 *
 * Both G3_APPLY_ALLOW_LIVE and a real G3_APPLY_BASE_URL must be set
 * explicitly for this one invocation -- there is no default, no fallback,
 * and no way to reach the real domain by accident.
 */

import { config } from "../src/config";
import { prisma } from "../src/prisma";
import { buildApplyUrl } from "../src/lib/onboarding/buildApplyUrl";

async function main() {
  if (!config.g3ApplyLiveEnabled) {
    console.error(
      "\nREFUSING TO RUN: this would build a link against a real, non-.invalid apply " +
        "domain, but the live-call kill switch (G3_APPLY_ALLOW_LIVE=true) is not set.\n" +
        "This script is for one deliberate, supervised verification session only -- " +
        "set G3_APPLY_ALLOW_LIVE=true and a real G3_APPLY_BASE_URL explicitly for " +
        "this one run if that's genuinely what you're doing right now.\n"
    );
    process.exit(1);
  }

  if (config.g3ApplyBaseUrl.includes(".invalid")) {
    console.error(
      `\nREFUSING TO RUN: G3_APPLY_ALLOW_LIVE is set, but G3_APPLY_BASE_URL is still the ` +
        `default unreachable placeholder (${config.g3ApplyBaseUrl}). Set G3_APPLY_BASE_URL ` +
        `to the real https://app.global3.io/apply explicitly for this one run.\n`
    );
    process.exit(1);
  }

  const leadId = process.argv[2];
  if (!leadId) {
    console.error("Usage: npx ts-node scripts/verify-g3-apply-live.ts <leadId>");
    process.exit(1);
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    console.error(`No lead found with id ${leadId}`);
    process.exit(1);
  }

  console.log("\n=== LIVE G3 APPLY LINK -- SUPERVISED MANUAL VERIFICATION ===\n");
  console.log(`Apply base URL : ${config.g3ApplyBaseUrl}`);
  console.log(`Lead           : ${lead.id} (${lead.displayName || lead.fullName || lead.maskedLabel})`);
  console.log(`\nOpen this URL in a real browser and confirm every field pre-fills as expected:\n`);
  console.log(buildApplyUrl(lead));
  console.log(
    `\nAfter submitting the form for real, watch this server's logs for a line tagged ` +
      `"[onboarding webhook]" confirming the callback was received and the lead was marked ` +
      `ONBOARDED -- do not ask G3 whether it worked as the first move.\n`
  );
}

main()
  .catch((err) => {
    console.error("verify-g3-apply-live failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
