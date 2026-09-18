/**
 * Unit tests for the notification message formatting helpers -- the "Hey
 * <FirstName>, ..." greeting every notification (bell/email/Slack) now
 * opens with, and the formal, fully-detailed TASK_ASSIGNMENT body shared by
 * requirement.routes.ts's create and reassign paths.
 *
 * Run: cd server && npx ts-node src/services/notification.service.test.ts
 */
import assert from "node:assert";
import { firstNameOf, greetNotificationBody, formatTaskAssignmentBody } from "./notification.service";

function test1_firstNameOfTakesOnlyTheFirstToken() {
  assert.strictEqual(firstNameOf("Ananya Sharma"), "Ananya");
}

function test2_firstNameOfFallsBackWhenNameIsMissing() {
  assert.strictEqual(firstNameOf(null), "there");
  assert.strictEqual(firstNameOf(""), "there");
}

function test3_greetNotificationBodyPrefixesTheGreeting() {
  assert.strictEqual(
    greetNotificationBody("Ananya Sharma", "you've been assigned to this."),
    "Hey Ananya, you've been assigned to this."
  );
}

function test4_taskAssignmentBodyIncludesClientHeadcountAndLanguageService() {
  const body = formatTaskAssignmentBody(
    { title: "X — Spanish (LatAm) SDH", language: "Spanish (LatAm)", service: "SDH", region: null, headcountNeeded: 5, priority: "STANDARD", deadline: null },
    "Acme Studios"
  );
  assert.match(body, /assigned to "X — Spanish \(LatAm\) SDH" for Acme Studios/);
  assert.match(body, /5 candidates in Spanish \(LatAm\) \(SDH\)/);
}

function test5_taskAssignmentBodySingularCandidateWording() {
  const body = formatTaskAssignmentBody(
    { title: "Solo role", language: "German", service: "Dubbing", region: null, headcountNeeded: 1, priority: "STANDARD", deadline: null },
    "Client Co"
  );
  assert.match(body, /1 candidate in German/);
  assert.doesNotMatch(body, /1 candidates/);
}

function test6_taskAssignmentBodyIncludesRegionPriorityAndDeadlineWhenSet() {
  const deadline = new Date("2026-10-01T00:00:00Z");
  const body = formatTaskAssignmentBody(
    { title: "Urgent role", language: "French", service: "Subtitling", region: "Canada", headcountNeeded: 3, priority: "CRITICAL", deadline },
    "Client Co"
  );
  assert.match(body, /based in Canada/);
  assert.match(body, /critical-priority requirement/);
  assert.match(body, new RegExp(deadline.toDateString()));
}

function test7_taskAssignmentBodyOmitsPrioritySentenceForStandard() {
  const body = formatTaskAssignmentBody(
    { title: "Normal role", language: "English", service: "Voiceover", region: null, headcountNeeded: 2, priority: "STANDARD", deadline: null },
    "Client Co"
  );
  assert.doesNotMatch(body, /priority requirement/);
}

async function main() {
  const tests = [
    test1_firstNameOfTakesOnlyTheFirstToken,
    test2_firstNameOfFallsBackWhenNameIsMissing,
    test3_greetNotificationBodyPrefixesTheGreeting,
    test4_taskAssignmentBodyIncludesClientHeadcountAndLanguageService,
    test5_taskAssignmentBodySingularCandidateWording,
    test6_taskAssignmentBodyIncludesRegionPriorityAndDeadlineWhenSet,
    test7_taskAssignmentBodyOmitsPrioritySentenceForStandard,
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
