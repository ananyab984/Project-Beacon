/**
 * Unit tests for the two enrichment verdicts.
 *
 * The case that matters most is `exhausted_no_match` + `enrichment_partial`:
 * that is the shape 17 of 20 leads came back as in the 2026-10-01 batch, and
 * the shape that used to be stamped identityResolved + promotedToGlobalAt.
 *
 * Run: cd server && npx ts-node src/lib/enrichmentVerdict.test.ts
 */

import assert from "node:assert";
import { computeEnrichmentVerdict, patchResolvesIdentity } from "./enrichmentVerdict";

// --- the regression: concluded, but thin --------------------------------
const partial = computeEnrichmentVerdict({
  conclusion: "exhausted_no_match",
  enrichmentStatus: "enrichment_partial",
});
assert.equal(partial.leadStatus, "COMPLETE", "a thin result must still come to rest, or the poll job re-runs it forever");
assert.equal(partial.fullyEnriched, false, "missing critical fields must NOT reach the global recruiter pool");
assert.equal(partial.unrecognizedStatus, false);

// --- a genuinely complete lead ------------------------------------------
for (const conclusion of ["exhausted_no_match", "short_circuit_success"]) {
  const v = computeEnrichmentVerdict({ conclusion, enrichmentStatus: "enrichment_complete" });
  assert.equal(v.leadStatus, "COMPLETE", `${conclusion} concludes`);
  assert.equal(v.fullyEnriched, true, `${conclusion} with all critical fields is fully enriched`);
  assert.equal(v.unrecognizedStatus, false);
}

// --- timeout -------------------------------------------------------------
const timedOut = computeEnrichmentVerdict({ conclusion: "timed_out", enrichmentStatus: "enrichment_partial" });
assert.equal(timedOut.leadStatus, "PENDING", "a timeout must go back to PENDING so it is retried");
assert.equal(timedOut.fullyEnriched, false);

// A timeout can never be "fully enriched", even if a complete status somehow
// rode along with it -- the two fields are produced independently.
const timedOutButComplete = computeEnrichmentVerdict({
  conclusion: "timed_out",
  enrichmentStatus: "enrichment_complete",
});
assert.equal(timedOutButComplete.leadStatus, "PENDING");
assert.equal(timedOutButComplete.fullyEnriched, false, "a timed-out run is never treated as finished");

// --- unreadable / missing status: fail safe, and say so ------------------
for (const bad of [undefined, null, "", "COMPLETE", "enriched", "something_new"]) {
  const v = computeEnrichmentVerdict({ conclusion: "exhausted_no_match", enrichmentStatus: bad });
  assert.equal(v.fullyEnriched, false, `unreadable status ${JSON.stringify(bad)} must not promote the lead`);
  assert.equal(v.unrecognizedStatus, true, `unreadable status ${JSON.stringify(bad)} must be reported, not swallowed`);
  assert.equal(v.leadStatus, "COMPLETE", "an unreadable status does not by itself mean the run should be retried");
}

// A missing conclusion (older service, truncated body) still concludes --
// only an explicit "timed_out" sends a lead back to PENDING.
const noConclusion = computeEnrichmentVerdict({ conclusion: undefined, enrichmentStatus: "enrichment_complete" });
assert.equal(noConclusion.leadStatus, "COMPLETE");
assert.equal(noConclusion.fullyEnriched, true);

// --- the invariant that stops the cost blow-up ---------------------------
// Whatever else changes, a non-timeout response must always conclude: that is
// the only thing keeping pollPendingEnrichment from re-claiming the lead.
for (const status of ["enrichment_complete", "enrichment_partial", "garbage", undefined]) {
  assert.notEqual(
    computeEnrichmentVerdict({ conclusion: "exhausted_no_match", enrichmentStatus: status }).leadStatus,
    "PENDING",
    `non-timeout must conclude regardless of status (${String(status)})`
  );
}

// --- no identity flagging ------------------------------------------------
// A name mismatch never changes a lead's status: recruiters own who a lead is.
const OK = { conclusion: "exhausted_no_match", enrichmentStatus: "enrichment_complete" };
const ok = computeEnrichmentVerdict(OK);
assert.equal(ok.leadStatus, "COMPLETE");
assert.equal(ok.fullyEnriched, true);

// leadStatus is only ever COMPLETE or PENDING, and a non-timeout always concludes.
for (const conclusion of ["exhausted_no_match", "short_circuit_success", "timed_out", undefined]) {
  for (const enrichmentStatus of ["enrichment_complete", "enrichment_partial", "weird"]) {
    const r = computeEnrichmentVerdict({ conclusion, enrichmentStatus });
    assert.ok(["COMPLETE", "PENDING"].includes(r.leadStatus), `bad leadStatus ${r.leadStatus}`);
    if (conclusion !== "timed_out") assert.notEqual(r.leadStatus, "PENDING");
  }
}

// --- patchResolvesIdentity: the manual-edit bar -------------------------
const FULL = { email: "a@b.com", contactNumber: "+1234", yearsOfExperience: 7 };
const BARE = { email: null, contactNumber: null, yearsOfExperience: null };

// The regression: merely having a profile link, or already being COMPLETE,
// must not resolve identity. Nothing about a profileLink appears here at all.
assert.equal(patchResolvesIdentity({}, BARE), false);
assert.equal(patchResolvesIdentity({}, { ...BARE, email: "a@b.com" }), false, "email alone is not enough");
assert.equal(patchResolvesIdentity({}, { ...BARE, email: "a@b.com", contactNumber: "+1" }), false, "still no YoE");

// A recruiter filling the record in by hand does resolve it.
assert.equal(patchResolvesIdentity({}, FULL), true);
assert.equal(patchResolvesIdentity({ yearsOfExperience: 7 }, { ...FULL, yearsOfExperience: null }), true);
assert.equal(patchResolvesIdentity({ email: "a@b.com" }, { ...FULL, email: null }), true);

// YoE of 0 is a real, known value -- not "missing". A truthiness check here
// would wrongly treat a genuine zero as unresolved.
assert.equal(patchResolvesIdentity({}, { ...FULL, yearsOfExperience: 0 }), true, "0 years is a known value");
assert.equal(patchResolvesIdentity({ yearsOfExperience: 0 }, FULL), true);

// Explicit null is a deliberate clear and must NOT fall back to the stored
// value; an absent key means "leave alone" and must.
assert.equal(patchResolvesIdentity({ email: null }, FULL), false, "clearing email un-resolves");
assert.equal(patchResolvesIdentity({ contactNumber: null }, FULL), false, "clearing phone un-resolves");
assert.equal(patchResolvesIdentity({ yearsOfExperience: null }, FULL), false, "clearing YoE un-resolves");
assert.equal(patchResolvesIdentity({ email: undefined }, FULL), true, "absent key leaves the stored value alone");

// Empty string is not a value (matches is_empty_value in core/schema.py).
assert.equal(patchResolvesIdentity({ email: "" }, FULL), false);

// --- LinkedIn: not enriched until Parallel returned the complete profile ---
// The Christopher Boyce case: concluded cleanly, Parallel returned Country only.
const li = (parallelState?: string) =>
  computeEnrichmentVerdict({ conclusion: "exhausted_no_match", enrichmentStatus: "enrichment_complete", source: "LINKEDIN", parallelState });

const liComplete = li("complete");
assert.equal(liComplete.leadStatus, "COMPLETE");
assert.equal(liComplete.incompleteProfile, false);
assert.equal(liComplete.fullyEnriched, true);

const liFirstMiss = li("failed_transient:1");
assert.equal(liFirstMiss.leadStatus, "PENDING", "an attempt is left, so the poll job must re-run Parallel");
assert.equal(liFirstMiss.incompleteProfile, false, "not On Hold yet while the retry is pending");
assert.equal(liFirstMiss.fullyEnriched, false);

const liEscalate = li("escalate_pro");
assert.equal(liEscalate.leadStatus, "PENDING", "the one pro attempt needs the poll job too");
assert.equal(liEscalate.incompleteProfile, false);

for (const exhausted of ["failed_transient:2", "failed_pro", "failed_permanent", undefined, "failed_transient:garbage"]) {
  const v = li(exhausted);
  assert.equal(v.leadStatus, "COMPLETE", `${exhausted}: no attempt left, must come to rest`);
  assert.equal(v.incompleteProfile, true, `${exhausted}: must go On Hold, never show Enriched`);
  assert.equal(v.fullyEnriched, false, `${exhausted}: never promoted to the global pool`);
}

// A timeout keeps its own retry path, and is not an incomplete-profile hold.
const liTimeout = computeEnrichmentVerdict({ conclusion: "timed_out", enrichmentStatus: "enrichment_partial", source: "LINKEDIN" });
assert.equal(liTimeout.leadStatus, "PENDING");
assert.equal(liTimeout.incompleteProfile, false);

// Other platforms are not held to the Parallel bar.
const proz = computeEnrichmentVerdict({ conclusion: "exhausted_no_match", enrichmentStatus: "enrichment_complete", source: "PROZ", parallelState: "failed_transient:1" });
assert.equal(proz.leadStatus, "COMPLETE");
assert.equal(proz.incompleteProfile, false);
assert.equal(proz.fullyEnriched, true);

console.log("enrichmentVerdict: all assertions passed");
