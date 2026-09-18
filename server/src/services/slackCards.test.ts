/**
 * Unit tests for the Slack notification card builders in
 * notification.service.ts -- the colored-accent-bar, emoji-headline,
 * bold-field, link-button format shown in G3's reference notification
 * mockups.
 *
 * Run: cd server && npx ts-node src/services/slackCards.test.ts
 */
import assert from "node:assert";
import {
  formatTaskAssignmentSlackCard,
  formatDueDateReminderSlackCard,
  formatLeadResponseSlackCard,
  formatEscalationSlackCard,
  buildSlackCardBlocks,
} from "./notification.service";

function requirement(over: Partial<Parameters<typeof formatTaskAssignmentSlackCard>[0]> = {}) {
  return {
    title: "X — Spanish (LatAm) SDH",
    language: "Spanish (LatAm)",
    service: "SDH",
    region: null,
    headcountNeeded: 1,
    priority: "STANDARD",
    deadline: null,
    ...over,
  };
}

function test1_singleCandidateReadsAsANewTaskNotBulk() {
  const card = formatTaskAssignmentSlackCard(requirement({ headcountNeeded: 1, priority: "HIGH" }));
  assert.strictEqual(card.emoji, "📣");
  assert.strictEqual(card.headline, "You've been assigned a new task!");
  assert.strictEqual(card.button?.text, "View Task");
  assert.deepStrictEqual(
    card.fields.map((f) => f.label),
    ["Task", "Language", "Type", "Candidates", "Priority"]
  );
}

function test2_multipleCandidatesReadAsBulkAssignment() {
  const card = formatTaskAssignmentSlackCard(requirement({ headcountNeeded: 8, priority: "HIGH" }));
  assert.strictEqual(card.emoji, "📋");
  assert.strictEqual(card.headline, "New bulk assignment");
  assert.strictEqual(card.button?.text, "View Candidates");
  assert.match(card.note!, /assigned 8 candidates/);
  assert.match(card.note!, /high-priority/);
}

function test3_standardPriorityOmitsThePriorityField() {
  const card = formatTaskAssignmentSlackCard(requirement({ priority: "STANDARD" }));
  assert.ok(!card.fields.some((f) => f.label === "Priority"));
}

function test4_deadlineOnlyAppearsWhenSet() {
  const withDeadline = formatTaskAssignmentSlackCard(requirement({ deadline: new Date("2026-10-01T00:00:00Z") }));
  assert.ok(withDeadline.fields.some((f) => f.label === "Deadline"));
  const without = formatTaskAssignmentSlackCard(requirement({ deadline: null }));
  assert.ok(!without.fields.some((f) => f.label === "Deadline"));
}

function test5_dueDateReminderShowsOverdueVsUpcomingWording() {
  const overdue = formatDueDateReminderSlackCard(requirement({ deadline: new Date() }), 0);
  assert.match(overdue.fields.find((f) => f.label === "Deadline")!.value, /overdue/);
  assert.match(overdue.note!, /overdue/i);

  const upcoming = formatDueDateReminderSlackCard(requirement({ deadline: new Date() }), 3);
  assert.match(upcoming.fields.find((f) => f.label === "Deadline")!.value, /in 3 days/);
}

function test6_leadResponseCardQuotesTheExcerpt() {
  const card = formatLeadResponseSlackCard("Priya Kumar", "hi can you share some more details");
  assert.deepStrictEqual(card.fields[0], { label: "From", value: "Priya Kumar" });
  assert.strictEqual(card.fields[1].value, "hi can you share some more details");
  assert.strictEqual(card.button?.text, "View Conversation");
}

function test7_escalationCardUsesTheGivenLinkPath() {
  const card = formatEscalationSlackCard("Ananya's email queue has 30 unsent drafts", "Backlog exceeds threshold.", "Review the queue.", "/recruiter/email-queue");
  assert.strictEqual(card.button?.path, "/recruiter/email-queue");
  assert.strictEqual(card.note, "Review the queue.");
}

function test8_buildSlackCardBlocksIncludesHeadlineFieldsNoteAndButton() {
  const card = formatLeadResponseSlackCard("Priya Kumar", "hello");
  const blocks = buildSlackCardBlocks(card) as any[];
  assert.strictEqual(blocks.length, 4); // headline, fields, note, actions
  assert.match(blocks[0].text.text, /💬/);
  assert.match(blocks[1].text.text, /\*From:\* Priya Kumar/);
  assert.strictEqual(blocks[3].type, "actions");
  assert.ok(String(blocks[3].elements[0].url).endsWith("/recruiter/leads"));
}

function test9_buildSlackCardBlocksOmitsActionsWhenNoButton() {
  const blocks = buildSlackCardBlocks({ emoji: "🔔", headline: "Test", color: "#000", fields: [] }) as any[];
  assert.ok(!blocks.some((b) => b.type === "actions"));
}

async function main() {
  const tests = [
    test1_singleCandidateReadsAsANewTaskNotBulk,
    test2_multipleCandidatesReadAsBulkAssignment,
    test3_standardPriorityOmitsThePriorityField,
    test4_deadlineOnlyAppearsWhenSet,
    test5_dueDateReminderShowsOverdueVsUpcomingWording,
    test6_leadResponseCardQuotesTheExcerpt,
    test7_escalationCardUsesTheGivenLinkPath,
    test8_buildSlackCardBlocksIncludesHeadlineFieldsNoteAndButton,
    test9_buildSlackCardBlocksOmitsActionsWhenNoButton,
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
