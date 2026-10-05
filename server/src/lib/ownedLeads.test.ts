/**
 * Pins the one shared "this user's leads" definition. Scoring used to count
 * recycle-bin leads and never look at createdByContractorId, so the owner's
 * view of a person disagreed with their own, and a contractor's sourcing
 * could only ever read 0.
 *
 * Run: cd server && npx ts-node --transpile-only src/lib/ownedLeads.test.ts
 */
import assert from "node:assert";
import { ownedLeadsWhere } from "./ownedLeads";

const w = ownedLeadsWhere("u1") as { deletedAt: unknown; OR: Array<Record<string, string>> };
assert.strictEqual(w.deletedAt, null, "recycle-bin leads must never count");
const columns = w.OR.map((c) => Object.keys(c)[0]).sort();
assert.deepStrictEqual(columns, ["assignedRecruiterId", "claimedByRecruiterId", "createdByContractorId", "createdByRecruiterId"]);
assert.ok(w.OR.every((c) => Object.values(c)[0] === "u1"), "every clause is scoped to this user");
console.log("All ownedLeads tests passed");
