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
  requirementLinkForRole,
} from "./notification.service";

const REQ_LINK = "/recruiter/clients";

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
  const card = formatTaskAssignmentSlackCard(requirement({ headcountNeeded: 1, priority: "HIGH" }), REQ_LINK);
  assert.strictEqual(card.emoji, "📣");
  assert.strictEqual(card.headline, "You've been assigned a new task!");
  assert.strictEqual(card.button?.text, "View Task");
  assert.deepStrictEqual(
    card.fields.map((f) => f.label),
    ["Task", "Language", "Type", "Candidates", "Priority"]
  );
}

function test2_multipleCandidatesReadAsBulkAssignment() {
  const card = formatTaskAssignmentSlackCard(requirement({ headcountNeeded: 8, priority: "HIGH" }), REQ_LINK);
  assert.strictEqual(card.emoji, "📋");
  assert.strictEqual(card.headline, "New bulk assignment");
  assert.strictEqual(card.button?.text, "View Client");
  assert.match(card.note!, /assigned 8 candidates/);
  assert.match(card.note!, /high-priority/);
}

function test3_standardPriorityOmitsThePriorityField() {
  const card = formatTaskAssignmentSlackCard(requirement({ priority: "STANDARD" }), REQ_LINK);
  assert.ok(!card.fields.some((f) => f.label === "Priority"));
}

function test4_deadlineOnlyAppearsWhenSet() {
  const withDeadline = formatTaskAssignmentSlackCard(requirement({ deadline: new Date("2026-10-01T00:00:00Z") }), REQ_LINK);
  assert.ok(withDeadline.fields.some((f) => f.label === "Deadline"));
  const without = formatTaskAssignmentSlackCard(requirement({ deadline: null }), REQ_LINK);
  assert.ok(!without.fields.some((f) => f.label === "Deadline"));
}

function test5_dueDateReminderShowsOverdueVsUpcomingWording() {
  const overdue = formatDueDateReminderSlackCard(requirement({ deadline: new Date() }), 0, REQ_LINK);
  assert.match(overdue.fields.find((f) => f.label === "Deadline")!.value, /overdue/);
  assert.match(overdue.note!, /overdue/i);

  const upcoming = formatDueDateReminderSlackCard(requirement({ deadline: new Date() }), 3, REQ_LINK);
  assert.match(upcoming.fields.find((f) => f.label === "Deadline")!.value, /in 3 days/);
}

function test5b_requirementCardsRouteToTheAssigneesOwnClientsPage() {
  // Requirement.recruiterId holds a contractor as readily as a recruiter, and
  // RoleGuard bounces a contractor off /recruiter/*. Both card families take
  // the resolved link rather than hardcoding the recruiter path.
  assert.strictEqual(requirementLinkForRole("CONTRACTOR"), "/contractor/clients");
  assert.strictEqual(requirementLinkForRole("contractor"), "/contractor/clients");
  assert.strictEqual(requirementLinkForRole("RECRUITER"), "/recruiter/clients");
  // Unknown/missing role must not silently send a contractor to a page they
  // can't open -- but it also must not break a recruiter, so it stays the
  // recruiter default, which is what every non-contractor assignee is.
  assert.strictEqual(requirementLinkForRole(null), "/recruiter/clients");

  const assignment = formatTaskAssignmentSlackCard(requirement(), requirementLinkForRole("contractor"));
  assert.strictEqual(assignment.button?.path, "/contractor/clients");
  const reminder = formatDueDateReminderSlackCard(requirement({ deadline: new Date() }), 2, requirementLinkForRole("contractor"));
  assert.strictEqual(reminder.button?.path, "/contractor/clients");
}

function test6_leadResponseCardQuotesTheExcerpt() {
  const card = formatLeadResponseSlackCard("Priya Kumar", "hi can you share some more details", "/recruiter");
  assert.deepStrictEqual(card.fields[0], { label: "From", value: "Priya Kumar" });
  assert.strictEqual(card.fields[1].value, "hi can you share some more details");
  assert.strictEqual(card.button?.text, "View Conversation");
}

function test6b_leadResponseCardButtonMatchesTheRecipientsOwnRole() {
  // Regression check: this card is fired to both a recruiter and (separately)
  // the contractor who added the lead -- the button must route each to
  // their own section, not always to /recruiter/... (the bug this fixed).
  const recruiterCard = formatLeadResponseSlackCard("Priya Kumar", "hello", "/recruiter");
  assert.strictEqual(recruiterCard.button?.path, "/recruiter/leads");
  const contractorCard = formatLeadResponseSlackCard("Priya Kumar", "hello", "/contractor");
  assert.strictEqual(contractorCard.button?.path, "/contractor/leads");
}

function test7_escalationCardUsesTheGivenLinkPath() {
  const card = formatEscalationSlackCard("Ananya's email queue has 30 unsent drafts", "Backlog exceeds threshold.", "Review the queue.", "/recruiter/email-queue");
  assert.strictEqual(card.button?.path, "/recruiter/email-queue");
  assert.strictEqual(card.note, "Review the queue.");
}

function test8_buildSlackCardBlocksIncludesHeadlineFieldsNoteAndButton() {
  const card = formatLeadResponseSlackCard("Priya Kumar", "hello", "/recruiter");
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
    test5b_requirementCardsRouteToTheAssigneesOwnClientsPage,
    test6_leadResponseCardQuotesTheExcerpt,
    test6b_leadResponseCardButtonMatchesTheRecipientsOwnRole,
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
