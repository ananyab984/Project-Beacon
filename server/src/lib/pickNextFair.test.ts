/**
 * Run: cd server && npx ts-node src/lib/pickNextFair.test.ts
 */

import assert from "node:assert";
import { pickNextFair, type QueueHead } from "./pickNextFair";

/** Simulates claiming `slots` leads from per-owner queues, the way
 *  claimNextPendingLead does: pick, mark in flight, advance that queue. */
function simulate(queues: Record<string, number>, slots: number): Record<string, number> {
  const remaining = { ...queues };
  const inFlight = new Map<string, number>();
  let t = 0;
  const createdAt: Record<string, Date> = {};
  for (const owner of Object.keys(queues)) createdAt[owner] = new Date(2026, 0, 1, 0, 0, t++);
  for (let i = 0; i < slots; i++) {
    const heads: QueueHead[] = Object.keys(remaining)
      .filter((o) => remaining[o] > 0)
      .map((o) => ({ id: `${o}-${queues[o] - remaining[o]}`, owner: o, createdAt: createdAt[o] }));
    const next = pickNextFair(heads, inFlight);
    if (!next) break;
    remaining[next.owner]--;
    inFlight.set(next.owner, (inFlight.get(next.owner) ?? 0) + 1);
  }
  return Object.fromEntries(inFlight);
}

function test1_aBigUploadDoesNotStarveASmallOne() {
  // A uploaded 1000 first, B 20 a minute later: 16 slots split evenly.
  assert.deepStrictEqual(simulate({ A: 1000, B: 20 }, 16), { A: 8, B: 8 });
}

function test2_aLoneUploaderGetsEverySlot() {
  assert.deepStrictEqual(simulate({ A: 1000 }, 32), { A: 32 });
}

function test3_aSmallUploadDoesNotHoldBackOnceItsDone() {
  // B only has 3 queued: A takes the rest of the slots.
  assert.deepStrictEqual(simulate({ A: 1000, B: 3 }, 16), { A: 13, B: 3 });
}

function test4_tieGoesToTheOldestLead() {
  const older = { id: "b1", owner: "B", createdAt: new Date("2026-10-06T07:00:00Z") };
  const newer = { id: "a1", owner: "A", createdAt: new Date("2026-10-06T07:05:00Z") };
  assert.strictEqual(pickNextFair([newer, older], new Map()), older);
  assert.strictEqual(pickNextFair([], new Map()), null);
}

function test5_unownedIsItsOwnGroup() {
  const heads = [
    { id: "u1", owner: "unowned", createdAt: new Date("2026-10-06T07:00:00Z") },
    { id: "a1", owner: "A", createdAt: new Date("2026-10-06T07:01:00Z") },
  ];
  assert.strictEqual(pickNextFair(heads, new Map([["unowned", 4], ["A", 1]]))?.id, "a1");
}

const tests = [
  test1_aBigUploadDoesNotStarveASmallOne,
  test2_aLoneUploaderGetsEverySlot,
  test3_aSmallUploadDoesNotHoldBackOnceItsDone,
  test4_tieGoesToTheOldestLead,
  test5_unownedIsItsOwnGroup,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`  PASS  ${t.name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL  ${t.name}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
