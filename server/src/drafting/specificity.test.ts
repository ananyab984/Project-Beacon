/**
 * Unit tests for the named-specificity bar -- the thing that decides whether
 * a draft actually cited details only THIS person's profile could supply, as
 * opposed to a broad category ("your subtitling experience") that would read
 * identically for a thousand other linguists.
 *
 * Two real failures from the 2026-09-07 live run are pinned here:
 *   - A draft citing "Maruti Suzuki Arena" and "Tata Mutual Fund" -- both
 *     straight out of that lead's own Parallel role summaries -- scored ZERO,
 *     because an earlier version only intersected the body with structured
 *     fields and those names live in free-text excerpts.
 *   - The same draft's names got merged across the connector "and" into one
 *     phrase ("Maruti Suzuki Arena and Tata Mutual Fund") that appears nowhere
 *     in the profile verbatim, so it grounded to nothing.
 *
 * Run: cd server && npx ts-node src/drafting/specificity.test.ts
 */

import assert from "node:assert";
import { citedNamedSpecifics, fromRecord } from "./leads";
import { buildDraftLeadPayload } from "../lib/draftLeadPayload";
import { evaluate } from "./evaluator";
import { BRAND, LINKEDIN_NOTE_CHAR_CAP } from "./promptBuilder";
import type { Draft } from "./draftGenerator";

/** A lead record in buildDraftLeadPayload's output shape. */
function record(over: Record<string, any> = {}) {
  return {
    First_Name: "Ruturaaj",
    Full_Name: "Ruturaaj k",
    Source: "LinkedIn",
    Profile_Link: "https://www.linkedin.com/in/ruturaaj-k",
    Services: "Voice-over",
    Target_Language: "Marathi",
    Enrichment_Status: "COMPLETE",
    Current_Title: "Voice Over Artist",
    ...over,
  };
}

function draftOf(lead: any, body: string, channel: "email" | "linkedin" = "email"): Draft {
  return {
    channel,
    lead,
    subject: channel === "email" ? "Marathi Voice Over Partnership – Global3" : null,
    body,
    model: "test",
    latency_ms: 0,
    prompt_tokens: null,
    completion_tokens: null,
    rate_match: null,
    rate_flag: null,
  };
}

function test1_creditsNamedEntityFoundOnlyInRawPayload() {
  // The exact regression: the brand names live in a role summary inside the
  // raw Parallel payload, not in any structured field.
  const lead = fromRecord(
    record({
      Parallel_Full_Data: {
        experience: [
          { title: "Voice Over Artist", summary: "Voiced campaigns for Maruti Suzuki Arena and Tata Mutual Fund." },
        ],
      },
    })
  );
  const cited = citedNamedSpecifics(lead, "particularly your voice work for Maruti Suzuki Arena and Tata Mutual Fund");
  assert.ok(
    cited.some((c) => c.toLowerCase() === "maruti suzuki arena"),
    `expected "Maruti Suzuki Arena" to be credited, got ${JSON.stringify(cited)}`
  );
  assert.ok(
    cited.some((c) => c.toLowerCase() === "tata mutual fund"),
    `connector "and" must not merge two entities into one ungroundable phrase; got ${JSON.stringify(cited)}`
  );
}

function test2_ungroundedNameIsNotCredited() {
  const lead = fromRecord(record({ Parallel_Full_Data: { experience: [{ summary: "Voiced for Maruti Suzuki Arena." }] } }));
  const cited = citedNamedSpecifics(lead, "your voice work for Netflix Originals and Sony Pictures");
  assert.deepStrictEqual(
    cited.filter((c) => /netflix|sony/i.test(c)),
    [],
    "a name the profile never mentions must never count as personalization"
  );
}

function test3_ownCompanyAndLeadNameNeverCount() {
  const lead = fromRecord(record({ Parallel_Full_Data: { name: "Ruturaaj k" } }));
  const cited = citedNamedSpecifics(lead, "Hi Ruturaaj, we're building our freelance pool at Global3 Studios");
  assert.deepStrictEqual(cited, [], `neither our own brand nor the lead's own name is a named detail; got ${JSON.stringify(cited)}`);
}

function test4_genericEmploymentDescriptorsAreNotSpecifics() {
  // "your background as a self-employed artist" is exactly the generic filler
  // this bar exists to reject -- and counting it also inflated the per-lead
  // target for a lead whose only candidates were "CEO" and "Self-employed".
  const lead = fromRecord(record({ Current_Title: "Self-employed", Parallel_Full_Data: { title: "Self-employed" } }));
  const cited = citedNamedSpecifics(lead, "impressed by your background as a Self-employed artist");
  assert.deepStrictEqual(cited, [], `got ${JSON.stringify(cited)}`);
  assert.ok(
    !lead.specificFactCandidates().some((c) => c.toLowerCase() === "self-employed"),
    "generic descriptors must not inflate the available-details count either"
  );
}

function test5_enumeratedSingleTokenToolIsCredited() {
  // Single-token names can't be caught by the multi-word phrase scan, which
  // is why enumerated candidates (tools, certifications) are matched directly.
  const lead = fromRecord(record({ Tools_Software: "OOONA, WinCaps" }));
  const cited = citedNamedSpecifics(lead, "your hands-on experience with OOONA for subtitling");
  assert.ok(cited.some((c) => c === "OOONA"), `expected the named tool to be credited, got ${JSON.stringify(cited)}`);
}

function test6_sentenceInitialWordsAreNotEntities() {
  const lead = fromRecord(record({ Parallel_Full_Data: { about_snippet: "I hope this finds you well. Best regards." } }));
  const cited = citedNamedSpecifics(lead, "Hi Ruturaaj,\n\nI hope this email finds you well.\n\nBest regards,\nResources Team");
  assert.deepStrictEqual(cited, [], `boilerplate must never read as personalization; got ${JSON.stringify(cited)}`);
}

function test7_candidatesMineExperienceAndEducation() {
  const lead = fromRecord(
    record({
      Parallel_Experience: [{ company: "Sfera Studios", title: "Subtitler" }],
      Parallel_Education: [{ school_name: "Dublin City University", field_of_study: "Translation Technology" }],
    })
  );
  const cands = lead.specificFactCandidates().map((c) => c.toLowerCase());
  for (const expected of ["sfera studios", "dublin city university", "translation technology"]) {
    assert.ok(cands.includes(expected), `expected candidate "${expected}", got ${JSON.stringify(cands)}`);
  }
}

/** A body carrying every brand element the required-elements gate needs, so
 *  these tests isolate the specificity gate rather than tripping on links. */
function bodyWith(personalization: string): string {
  return (
    `Hi Ruturaaj,\n\nI hope this email finds you well.\n\n${personalization}\n\n` +
    `At Global3 we work on long-term partnerships rather than one-off tasks. More at ${BRAND.site}.\n\n` +
    `If you're open to exploring this, apply here: ${BRAND.apply_url}\n\n` +
    `Questions? Reach us at ${BRAND.contact_email}.\n\nBest regards,\nResources Team`
  );
}

function test8_evaluatorGatesEmailAtTwoNamedDetails() {
  const lead = fromRecord(
    record({
      Tools_Software: "OOONA",
      Parallel_Full_Data: { experience: [{ summary: "Voiced for Maruti Suzuki Arena." }] },
    })
  );

  const thin = evaluate(draftOf(lead, bodyWith("I was impressed by your Marathi voice-over experience.")));
  assert.ok(!thin.checks.find((c) => c.name === "named_specificity")!.passed, "one-or-zero specifics must not pass email");
  assert.ok(thin.flags.includes("LOW_NAMED_SPECIFICITY"));

  const rich = evaluate(
    draftOf(lead, bodyWith("particularly your voice work for Maruti Suzuki Arena, combined with your OOONA experience."))
  );
  assert.ok(
    rich.checks.find((c) => c.name === "named_specificity")!.passed,
    `two grounded specifics must pass: ${rich.checks.find((c) => c.name === "named_specificity")!.detail}`
  );
}

function test9_linkedinBarIsOneNotTwo() {
  // The ~200-char note has room for one specific detail; holding it to email's
  // two would fail every note that respects the cap.
  const lead = fromRecord(record({ Parallel_Full_Data: { experience: [{ summary: "Voiced for Maruti Suzuki Arena." }] } }));
  const note = `Hi Ruturaaj, your Marathi VO for Maruti Suzuki Arena stood out. Apply: ${BRAND.apply_url} ${BRAND.site}`;
  const ev = evaluate(draftOf(lead, note, "linkedin"));
  assert.ok(ev.checks.find((c) => c.name === "named_specificity")!.passed, "one specific is enough on LinkedIn");
}

function test10_barIsWaivedWhenProfileOffersNothing() {
  // A genuinely bare profile must never be held to a bar its own data can't
  // meet -- otherwise those leads HOLD forever with no achievable fix.
  const lead = fromRecord({ First_Name: "Jane", Full_Name: "Jane Doe", Source: "LinkedIn", Services: "Subtitling" });
  assert.deepStrictEqual(lead.specificFactCandidates(), []);
  const ev = evaluate(draftOf(lead, bodyWith("I was impressed by your subtitling background.")));
  const check = ev.checks.find((c) => c.name === "named_specificity")!;
  assert.ok(check.passed, `bar must be waived with no candidates: ${check.detail}`);
  assert.ok(!ev.flags.includes("LOW_NAMED_SPECIFICITY"));
}

function test11_rawPayloadFactsAreNotFlaggedAsUngrounded() {
  // The prompt hands the raw payloads to the model as a sanctioned place to
  // find one more distinctive detail, so citing from them must not then be
  // flagged as an unsupported specific -- "Tata Mutual Fund" was, live.
  const lead = fromRecord(
    record({ Parallel_Full_Data: { experience: [{ summary: "Voiced campaigns for Tata Mutual Fund." }] } })
  );
  const ev = evaluate(draftOf(lead, bodyWith("particularly your voice work for Tata Mutual Fund.")));
  const grounding = ev.checks.find((c) => c.name === "entity_grounding")!;
  assert.ok(grounding.passed, `raw-payload facts must count as grounded: ${grounding.detail}`);
}

function test12_bareJobTitleDoesNotInflateTheTarget() {
  // Alberto's real case: profile offered exactly one named org ("Rev") plus
  // the bare title "Translator". The draft correctly didn't parrot the title,
  // and was held at 1/2 for it. Target must size from strong candidates only.
  const lead = fromRecord(
    record({
      Full_Name: "Alberto Palacios",
      First_Name: "Alberto",
      Current_Title: "Translator",
      Parallel_Experience: [{ company: "Rev", title: "Captioner" }],
    })
  );
  assert.deepStrictEqual(lead.strongFactCandidates(), ["Rev"], "a bare title is not a strong candidate");
  assert.ok(lead.specificFactCandidates().includes("Translator"), "titles still stay citable");

  const ev = evaluate(
    draftOf(lead, bodyWith("impressed by your five years as an English/Spanish captioner at Rev."))
  );
  const check = ev.checks.find((c) => c.name === "named_specificity")!;
  assert.ok(check.passed, `one strong candidate means a bar of one: ${check.detail}`);
}

function test13_linkedinCapIsEnforcedAtTheSharedConstant() {
  // The prompt used to demand <200 chars while the gate allowed 300, so notes
  // came out at 206-208 and nothing flagged them. One constant now feeds both.
  const lead = fromRecord(record({ Parallel_Experience: [{ company: "Rev" }] }));
  const over = `Hi Ruturaaj, your work at Rev stood out. ${"x".repeat(LINKEDIN_NOTE_CHAR_CAP)} ${BRAND.apply_url} ${BRAND.site}`;
  const ev = evaluate(draftOf(lead, over, "linkedin"));
  assert.ok(!ev.checks.find((c) => c.name === "linkedin_note_cap")!.passed, "a note past the cap must fail the gate");
  assert.ok(ev.flags.includes("LINKEDIN_NOTE_CAP_EXCEEDED"));

  const under = `Hi Ruturaaj, your work at Rev stood out. Apply: ${BRAND.apply_url} ${BRAND.site}`;
  assert.ok(under.length <= LINKEDIN_NOTE_CHAR_CAP);
  const evOk = evaluate(draftOf(lead, under, "linkedin"));
  assert.ok(evOk.checks.find((c) => c.name === "linkedin_note_cap")!.passed);
}

function test14_genericAttributesAreNotGroundingForNamedDetails() {
  // The haystack used to include ALL of groundingFacts(), so "your Audio
  // Description work in the United Kingdom" grounded "United Kingdom"
  // against the country fact and scored a named specific -- precisely the
  // mail-merge phrasing this bar exists to reject.
  const lead = fromRecord(
    record({ Country_of_Residence: "United Kingdom", Services: "Audio Description", Target_Language: "British English" })
  );
  const cited = citedNamedSpecifics(lead, "your Audio Description work in the United Kingdom for British English projects");
  assert.deepStrictEqual(cited, [], `country/service/language are not named details; got ${JSON.stringify(cited)}`);
}

function test15_leadsOwnNameIsNotCreditedWhenFullNameCameFromDisplayName() {
  // fullName is null on most real rows, so buildDraftLeadPayload falls
  // Full_Name back to displayName. Without that, "Ruturaaj k" cleared the
  // own-name filter and counted as though it were an employer.
  const payload = buildDraftLeadPayload({
    firstName: null,
    fullName: null,
    displayName: "Ruturaaj k",
    services: [],
    secondaryLanguages: [],
    toolsSoftware: [],
    certifications: [],
    yearsOfExperience: null,
    parallelData: { name: "Ruturaaj k", experience: [{ summary: "Voice work." }] },
  } as any);
  assert.strictEqual(payload.Full_Name, "Ruturaaj k", "Full_Name must fall back to displayName");
  const lead = fromRecord(payload);
  const cited = citedNamedSpecifics(lead, "Hi Ruturaaj, I came across Ruturaaj k and was impressed.");
  assert.deepStrictEqual(cited, [], `the lead's own name is never a named detail; got ${JSON.stringify(cited)}`);
}

function test16_oneMentionIsNotCountedTwice() {
  // The phrase scan and the enumerated-candidate scan overlap: "Maruti
  // Suzuki Arena" and the candidate "Maruti Suzuki" are the SAME mention,
  // and counting both cleared the two-specific email bar off a single name.
  const lead = fromRecord(
    record({
      Parallel_Experience: [{ company: "Maruti Suzuki" }],
      Parallel_Full_Data: { experience: [{ company: "Maruti Suzuki", summary: "Voiced for Maruti Suzuki Arena." }] },
    })
  );
  const cited = citedNamedSpecifics(lead, "your voice work for Maruti Suzuki Arena");
  assert.strictEqual(cited.length, 1, `one mention must score once; got ${JSON.stringify(cited)}`);
}

function test17_genericDescriptorWithAJobWordIsStillGeneric() {
  // A scraped `company: "Freelance Translator"` counted as a STRONG
  // candidate, pushing the bar to two for a lead with one real name to cite
  // -- a permanent HOLD, the exact failure the descriptor list prevents.
  const lead = fromRecord(
    record({ Parallel_Experience: [{ company: "Freelance Translator" }, { company: "Rev" }] })
  );
  assert.deepStrictEqual(lead.strongFactCandidates(), ["Rev"], `got ${JSON.stringify(lead.strongFactCandidates())}`);
}

function test18_multiWordPlaceholderLeakIsCaught() {
  // The new exemplar uses slots like "[NAMED DETAIL #2: named tools, a
  // credential]"; the old single-token-only regex let a leaked one through
  // as send-ready.
  const lead = fromRecord(record({ Parallel_Experience: [{ company: "Rev" }] }));
  const leaked = bodyWith("impressed by your work at Rev, combined with [NAMED DETAIL #2: named tools, a credential].");
  const ev = evaluate(draftOf(lead, leaked));
  assert.ok(!ev.checks.find((c) => c.name === "no_placeholders")!.passed, "a leaked multi-word slot must fail the gate");
  assert.ok(ev.flags.includes("UNFILLED_PLACEHOLDERS_FOUND"));
}

function test19_fabricatedPairingOfTwoRealTokensIsFlagged() {
  // Entity grounding was token-level, so a name whose halves both appeared
  // somewhere unrelated passed: "Sony Pictures" for a payload mentioning
  // "Sony" and "Pictures" separately. Phrases are checked whole now.
  const lead = fromRecord(
    record({ Parallel_Full_Data: { experience: [{ summary: "Worked with Sony on assorted Pictures of local landmarks." }] } })
  );
  const ev = evaluate(draftOf(lead, bodyWith("impressed by your work for Sony Pictures.")));
  const grounding = ev.checks.find((c) => c.name === "entity_grounding")!;
  assert.ok(!grounding.passed, `a fabricated pairing must be flagged: ${grounding.detail}`);
}

function main() {
  const tests = [
    test1_creditsNamedEntityFoundOnlyInRawPayload,
    test2_ungroundedNameIsNotCredited,
    test3_ownCompanyAndLeadNameNeverCount,
    test4_genericEmploymentDescriptorsAreNotSpecifics,
    test5_enumeratedSingleTokenToolIsCredited,
    test6_sentenceInitialWordsAreNotEntities,
    test7_candidatesMineExperienceAndEducation,
    test8_evaluatorGatesEmailAtTwoNamedDetails,
    test9_linkedinBarIsOneNotTwo,
    test10_barIsWaivedWhenProfileOffersNothing,
    test11_rawPayloadFactsAreNotFlaggedAsUngrounded,
    test12_bareJobTitleDoesNotInflateTheTarget,
    test13_linkedinCapIsEnforcedAtTheSharedConstant,
    test14_genericAttributesAreNotGroundingForNamedDetails,
    test15_leadsOwnNameIsNotCreditedWhenFullNameCameFromDisplayName,
    test16_oneMentionIsNotCountedTwice,
    test17_genericDescriptorWithAJobWordIsStillGeneric,
    test18_multiWordPlaceholderLeakIsCaught,
    test19_fabricatedPairingOfTwoRealTokensIsFlagged,
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
