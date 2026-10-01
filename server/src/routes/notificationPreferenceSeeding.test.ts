/**
 * Unit tests for seedChannelsFor -- what a NotificationPreference row starts
 * as when GET /api/notifications/preferences seeds a type the user doesn't
 * have a row for yet.
 *
 * The regression this pins: adding a type to a role's list (TASK_ASSIGNMENT /
 * DUE_DATE_REMINDER joining CONTRACTOR_TYPES) used to seed it at the first-run
 * default, which flipped contractor.settings.tsx's single Email/Slack switch
 * back to off for users who had turned it on -- and silently stopped
 * delivering that channel until they noticed and toggled again.
 *
 * Run: cd server && npx ts-node src/routes/notificationPreferenceSeeding.test.ts
 */
import assert from "node:assert";
import { seedChannelsFor } from "./notification.routes";

const ON = { emailEnabled: true, slackEnabled: true };
const OFF = { emailEnabled: false, slackEnabled: false };

function test1_firstTimeUserGetsTheRecommendedDefaults() {
  // Per the notification plan: due-date reminders are the one type that starts
  // with email on; everything else is bell-only until opted in.
  assert.deepStrictEqual(seedChannelsFor("DUE_DATE_REMINDER", []), { emailEnabled: true, slackEnabled: false });
  assert.deepStrictEqual(seedChannelsFor("TASK_ASSIGNMENT", []), { emailEnabled: false, slackEnabled: false });
}

function test2_userWithEverythingOnKeepsItOnForANewlyAddedType() {
  assert.deepStrictEqual(seedChannelsFor("TASK_ASSIGNMENT", [ON, ON, ON]), ON);
}

function test3_userWithEverythingOffStaysOff() {
  // Even for DUE_DATE_REMINDER, whose first-run default is email-on: this user
  // has already said no, so the default must not reinstate it.
  assert.deepStrictEqual(seedChannelsFor("DUE_DATE_REMINDER", [OFF, OFF]), OFF);
}

function test4_aMixedStateSeedsOffRatherThanOn() {
  // Inheriting "on" out of a partial state would switch a channel on for a
  // type the user never agreed to. Default-deny.
  const mixed = [ON, { emailEnabled: false, slackEnabled: true }];
  assert.deepStrictEqual(seedChannelsFor("TASK_ASSIGNMENT", mixed), { emailEnabled: false, slackEnabled: true });
}

function test5_channelsAreInheritedIndependently() {
  // Email on everywhere, Slack off everywhere (the common case: no Slack
  // member ID set) must not drag email down with it.
  const emailOnlyUser = [
    { emailEnabled: true, slackEnabled: false },
    { emailEnabled: true, slackEnabled: false },
  ];
  assert.deepStrictEqual(seedChannelsFor("TASK_ASSIGNMENT", emailOnlyUser), { emailEnabled: true, slackEnabled: false });
}

function main() {
  const tests = [
    test1_firstTimeUserGetsTheRecommendedDefaults,
    test2_userWithEverythingOnKeepsItOnForANewlyAddedType,
    test3_userWithEverythingOffStaysOff,
    test4_aMixedStateSeedsOffRatherThanOn,
    test5_channelsAreInheritedIndependently,
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
