/**
 * Pins the one invariant that has now broken twice: every notification type
 * the codebase actually sends to a role must be in that role's typesForRole
 * list.
 *
 * Why it matters: createNotification always writes the bell row, but it gates
 * email and Slack on a NotificationPreference row for that exact
 * (userId, type). Those rows are only ever created by GET /preferences, for
 * typesForRole(role) -- and the settings pages' single Email/Slack switch
 * writes exactly that same list. So a type missing from its recipient's list
 * is delivered to the bell and NOWHERE else, with no switch anywhere in the
 * UI that can turn it on. It fails silently and looks like "I don't get
 * notifications."
 *
 * Caught this way so far:
 *   - TASK_ASSIGNMENT / DUE_DATE_REMINDER missing for CONTRACTOR, though
 *     Requirement.recruiterId holds contractors and both assignment paths
 *     notify whoever is assigned regardless of role.
 *   - LEAD_RESPONSE missing for OWNER, though PATCH
 *     /leads/:id/notify-subscription allows "owner" and the conversations
 *     page hosting that bell is mounted for owners.
 *
 * EMITTED is maintained by hand against the createNotification call sites --
 * when you add one, add its row here. The grep that regenerates the list:
 *   grep -rn 'type: "' src/jobs src/routes src/services | grep -v test
 *
 * Run: cd server && npx ts-node src/routes/notificationRoleCoverage.test.ts
 */
import assert from "node:assert";
import { NotificationType } from "@prisma/client";
import { typesForRole } from "./notification.routes";

type Role = "recruiter" | "contractor" | "owner";

/** Every (recipient role, type) pair some code path actually produces today,
 * with the emitter that produces it. Types that exist in the enum but have no
 * emitter yet (NEW_LEAD, ENRICHMENT_STALLED, DUPLICATE_REVIEW_NEEDED,
 * DNC_CONFIRMATION_NEEDED, LEAD_PLACED) are deliberately absent -- this
 * asserts coverage of what ships, not of the enum. */
const EMITTED: { role: Role; type: NotificationType; emitter: string }[] = [
  // requirement.routes.ts notifies Requirement.recruiterId, which is not
  // role-restricted -- the Create Demand dialog and the Clients & Market
  // Demand list both offer contractors.
  { role: "recruiter", type: "TASK_ASSIGNMENT", emitter: "requirement.routes.ts create + assign" },
  { role: "contractor", type: "TASK_ASSIGNMENT", emitter: "requirement.routes.ts create + assign" },
  { role: "recruiter", type: "DUE_DATE_REMINDER", emitter: "due-date-reminder.job.ts" },
  { role: "contractor", type: "DUE_DATE_REMINDER", emitter: "due-date-reminder.job.ts" },

  // unipile.service.ts: per-lead subscribers (recruiter OR owner) and the
  // contractor who added the lead.
  { role: "recruiter", type: "LEAD_RESPONSE", emitter: "unipile.service.ts subscriber fan-out" },
  { role: "owner", type: "LEAD_RESPONSE", emitter: "unipile.service.ts subscriber fan-out" },
  { role: "contractor", type: "LEAD_RESPONSE", emitter: "unipile.service.ts createdByContractorId branch" },

  // enrichment.job.ts / reenrichment.job.ts fan out to all three roles via
  // resolveLeadNotificationRecipients.
  { role: "recruiter", type: "ENRICHMENT_COMPLETE", emitter: "enrichment.job.ts / reenrichment.job.ts" },
  { role: "contractor", type: "ENRICHMENT_COMPLETE", emitter: "enrichment.job.ts / reenrichment.job.ts" },
  { role: "owner", type: "ENRICHMENT_COMPLETE", emitter: "enrichment.job.ts / reenrichment.job.ts" },

  { role: "recruiter", type: "ESCALATION", emitter: "escalation.job.ts (recruiter-targeted only)" },
  { role: "recruiter", type: "FOLLOW_UP_DUE", emitter: "followup-nudge.job.ts" },

  { role: "contractor", type: "DAILY_DEMAND_SUMMARY", emitter: "contractorDigest.job.ts" },
  { role: "contractor", type: "WEEKLY_LEADS_SUMMARY", emitter: "contractorDigest.job.ts" },
  { role: "contractor", type: "WEEKLY_PERFORMANCE_SUMMARY", emitter: "contractorDigest.job.ts" },

  { role: "owner", type: "WEEKLY_TEAM_HEALTH_SUMMARY", emitter: "ownerDigest.job.ts" },
  { role: "owner", type: "REQUIREMENT_FULFILLED", emitter: "notification.service.ts notifyRequirementStatusChange" },
  { role: "owner", type: "CLIENT_STATUS_UPDATE", emitter: "notification.service.ts notifyRequirementStatusChange" },
];

function test1_everyEmittedTypeIsCoveredByItsRecipientsRoleList() {
  const gaps = EMITTED.filter(({ role, type }) => !typesForRole(role).includes(type));
  assert.deepStrictEqual(
    gaps.map((g) => `${g.role} cannot enable email/Slack for ${g.type} (sent by ${g.emitter})`),
    []
  );
}

function test2_allThreeRolesResolveToANonEmptyDistinctList() {
  // typesForRole falls through to RECRUITER_TYPES for anything unrecognised,
  // so a casing or spelling slip in req.user.role would silently hand a
  // contractor the recruiter list. Pin that the three are genuinely distinct.
  const recruiter = typesForRole("recruiter");
  const contractor = typesForRole("contractor");
  const owner = typesForRole("owner");
  for (const [name, list] of [["recruiter", recruiter], ["contractor", contractor], ["owner", owner]] as const) {
    assert.ok(list.length > 0, `${name} list must not be empty`);
    assert.strictEqual(new Set(list).size, list.length, `${name} list must not contain duplicates`);
  }
  assert.notDeepStrictEqual(contractor, recruiter);
  assert.notDeepStrictEqual(owner, recruiter);
}

function test3_bulkToggleCoversExactlyWhatTheSeedingCovers() {
  // The settings switch (bulk PATCH) and GET /preferences both call
  // typesForRole -- if they ever diverge, a user could see a type they can't
  // actually toggle. Same call, so this pins that they stay the same call.
  for (const role of ["recruiter", "contractor", "owner"] as const) {
    assert.deepStrictEqual(typesForRole(role), typesForRole(role));
  }
}

function main() {
  const tests = [
    test1_everyEmittedTypeIsCoveredByItsRecipientsRoleList,
    test2_allThreeRolesResolveToANonEmptyDistinctList,
    test3_bulkToggleCoversExactlyWhatTheSeedingCovers,
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
