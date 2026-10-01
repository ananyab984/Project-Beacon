/**
 * Tests for the per-lead pre-filled apply link and the short link that
 * carries it into outreach messages.
 *
 * Covers the three things that actually break in production: the short link
 * must round-trip to the right lead (a wrong decode sends a candidate
 * someone else's pre-filled form), buildApplyUrl must omit unknown fields
 * rather than send blanks, and the LinkedIn note must still fit its 200-char
 * cap once the link is appended.
 *
 * Run: cd server && npx ts-node src/lib/onboarding/applyLink.test.ts
 */

import assert from "node:assert";
import { buildApplyUrl, deriveLastName, deriveNames, extractLinkedInUrl } from "./buildApplyUrl";
import { encodeLeadIdToken, decodeShortLinkToken, buildShortApplyUrl, shortApplyUrlLength } from "./shortLink";
import { vendorExperienceToPresetList } from "./vendorExperienceToPresets";
import { config } from "../../config";
import { LINKEDIN_NOTE_MAX_CHARS } from "../linkedinNoteCap";
import { languageToBcp47 } from "./languageToBcp47";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LEAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Matches the one method buildApplyUrl calls on a Prisma Decimal, so these
 *  stay pure unit tests with no Prisma runtime involved. */
function decimal(n: number) {
  return { toNumber: () => n } as any;
}

function lead(overrides: Record<string, any> = {}): any {
  return {
    id: LEAD_ID,
    firstName: "Ana",
    fullName: "Ana Silva",
    email: "ana@example.com",
    country: "Brazil",
    sourceLanguage: "English",
    targetLanguage: "Portuguese (Brazilian)",
    services: ["Subtitling"],
    yearsOfExperience: decimal(7),
    vendorExperience: ["Deluxe"],
    profileLink: "https://www.linkedin.com/in/anasilva",
    ...overrides,
  };
}

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

// --- short link -------------------------------------------------------------

function test1_shortLinkRoundTripsToTheSameLead() {
  const token = encodeLeadIdToken(LEAD_ID);
  assert.strictEqual(token.length, 22, "token should be 22 base64url chars");
  assert.strictEqual(decodeShortLinkToken(token), LEAD_ID, "must decode back to the same lead id");
}

function test2_decodeRejectsGarbageInsteadOfThrowing() {
  // A candidate pasting a truncated or mangled link must get a clean 404,
  // never a 500 -- and must never decode to SOME OTHER valid lead.
  for (const bad of ["", "short", "!!!!!!!!!!!!!!!!!!!!!!", "a".repeat(23), null, undefined]) {
    assert.strictEqual(decodeShortLinkToken(bad as any), null, `should reject ${JSON.stringify(bad)}`);
  }
}

function test3_everyShortLinkIsTheAdvertisedLength() {
  // promptBuilder budgets the LinkedIn note against shortApplyUrlLength(),
  // so that number has to match what buildShortApplyUrl actually produces --
  // if they drift, notes get drafted over the cap.
  assert.strictEqual(buildShortApplyUrl(LEAD_ID).length, shortApplyUrlLength());
  assert.ok(buildShortApplyUrl(LEAD_ID).startsWith(`${config.shortLinkBaseUrl}/g/`));
}

function test4_linkedInNoteStillFitsWithTheLinkAppended() {
  // The whole reason for the shortener: the full pre-filled URL is 300+
  // chars and could never fit a 200-char connection note.
  const full = buildApplyUrl(lead());
  assert.ok(full.length > LINKEDIN_NOTE_MAX_CHARS, `full apply URL should exceed the note cap, got ${full.length}`);

  const short = buildShortApplyUrl(LEAD_ID);
  assert.ok(short.length < LINKEDIN_NOTE_MAX_CHARS / 2, `short link should leave most of the note for content, got ${short.length}`);

  // A realistic note plus the link must still land inside the hard cap.
  const note = `Hi Ana, your Portuguese subtitling work stood out. Apply: ${short}`;
  assert.ok(note.length <= LINKEDIN_NOTE_MAX_CHARS, `note+link should fit ${LINKEDIN_NOTE_MAX_CHARS}, got ${note.length}`);
}

// --- apply URL --------------------------------------------------------------

function test5_knownFieldsAreMappedNotPassedThroughRaw() {
  const p = paramsOf(buildApplyUrl(lead()));
  assert.strictEqual(p.get("first_name"), "Ana");
  assert.strictEqual(p.get("last_name"), "Silva");
  assert.strictEqual(p.get("email"), "ana@example.com");
  assert.strictEqual(p.get("address_country"), "BR", "country should map to ISO-3166 alpha-2");
  assert.strictEqual(p.get("target_language"), "pt-BR", "language should map to a BCP47 tag");
  assert.strictEqual(p.get("years_of_experience"), "7");
  assert.strictEqual(p.get("linkedin"), "https://www.linkedin.com/in/anasilva");
}

function test6_unknownFieldsAreOmittedNotSentBlank() {
  // Sending "?email=" would have the form render an empty-but-touched field;
  // omitting lets it stay genuinely unfilled.
  const url = buildApplyUrl(
    lead({ email: null, country: null, yearsOfExperience: null, vendorExperience: [], profileLink: null, fullName: "Ana" })
  );
  const p = paramsOf(url);
  for (const key of ["email", "address_country", "years_of_experience", "vendor_experience", "linkedin", "last_name"]) {
    assert.strictEqual(p.get(key), null, `${key} should be omitted entirely when unknown`);
  }
  assert.strictEqual(p.get("first_name"), "Ana", "known fields should still be sent");
}

function test7_callbackUrlIsNotSent() {
  // Scoped out deliberately: no inbound submission webhook exists on this
  // branch, so advertising a callback we don't serve would be a dead param.
  assert.strictEqual(paramsOf(buildApplyUrl(lead())).get("callback_url"), null);
}

function test8_valuesWithReservedCharactersCannotCorruptTheQueryString() {
  const url = buildApplyUrl(lead({ firstName: "A&B=C", fullName: "A&B=C D?E" }));
  const p = paramsOf(url);
  // Round-trips intact rather than splitting into extra params.
  assert.strictEqual(p.get("first_name"), "A&B=C");
  assert.strictEqual(p.get("last_name"), "D?E");
}

function test9_vendorExperienceAcceptsTheArrayColumnShape() {
  // schema.prisma stores vendorExperience as String[]; a vendor name
  // containing a comma must survive as ONE entry, not split into two.
  assert.deepStrictEqual(vendorExperienceToPresetList(["Deluxe", "Smith, Inc."]), ["Deluxe", "Smith, Inc."]);
  // Casing/spacing normalizes to the exact preset the form expects.
  assert.deepStrictEqual(vendorExperienceToPresetList(["  deluxe  "]), ["Deluxe"]);
  // Legacy comma-delimited strings still parse.
  assert.deepStrictEqual(vendorExperienceToPresetList("Deluxe,SDI"), ["Deluxe", "SDI"]);
  assert.deepStrictEqual(vendorExperienceToPresetList(null), []);

  // Assert on the RAW query string, not URLSearchParams (which decodes):
  // the point is that the comma inside a vendor name is percent-encoded so
  // it can't be mistaken for the list separator.
  const raw = buildApplyUrl(lead({ vendorExperience: ["Deluxe", "Smith, Inc."] }));
  const segment = raw.slice(raw.indexOf("vendor_experience=")).split("&")[0];
  assert.strictEqual(segment, "vendor_experience=Deluxe,Smith%2C%20Inc.", "each entry encoded before joining on ','");
}

function test10_yearsOfExperienceRoundsAndRejectsNonsense() {
  assert.strictEqual(paramsOf(buildApplyUrl(lead({ yearsOfExperience: decimal(7.4) }))).get("years_of_experience"), "7");
  assert.strictEqual(paramsOf(buildApplyUrl(lead({ yearsOfExperience: decimal(7.6) }))).get("years_of_experience"), "8");
  assert.strictEqual(paramsOf(buildApplyUrl(lead({ yearsOfExperience: decimal(0) }))).get("years_of_experience"), "0", "zero is a real value, not empty");
  assert.strictEqual(paramsOf(buildApplyUrl(lead({ yearsOfExperience: decimal(-3) }))).get("years_of_experience"), null);
}

function test11_lastNameDerivationHandlesTheShapesWeActuallyStore() {
  assert.strictEqual(deriveLastName({ firstName: "Ana", fullName: "Ana Silva" } as any), "Silva");
  assert.strictEqual(deriveLastName({ firstName: "Ana", fullName: "Ana" } as any), undefined);
  assert.strictEqual(deriveLastName({ firstName: null, fullName: "Silva" } as any), "Silva");
  assert.strictEqual(deriveLastName({ firstName: "Ana", fullName: "" } as any), undefined);
  // Legacy rows where the two were never composed together.
  assert.strictEqual(deriveLastName({ firstName: "Ana", fullName: "Maria Ana Silva" } as any), "Silva");
}

function test12_onlyRealLinkedInUrlsGoIntoTheLinkedInField() {
  // profileLink is shared between LinkedIn and ProZ -- a ProZ URL in the
  // linkedin field would be wrong data on their form, not just noise.
  assert.strictEqual(extractLinkedInUrl("https://www.linkedin.com/in/x"), "https://www.linkedin.com/in/x");
  assert.strictEqual(extractLinkedInUrl("https://www.proz.com/profile/123"), undefined);
  assert.strictEqual(extractLinkedInUrl(null), undefined);
  assert.strictEqual(extractLinkedInUrl("   "), undefined);
}

function test13_urlPointsAtTheConfiguredApplyForm() {
  assert.ok(buildApplyUrl(lead()).startsWith(`${config.g3ApplyBaseUrl}?`));
}

function test14_everyStandardLanguageStillMaps() {
  // The mapper is a fixed table keyed on the app's canonical language
  // labels. If a language is added to client/src/lib/languages.ts and not
  // here, source_language/target_language silently vanish from the apply
  // URL for those leads -- the same kind of drift that already broke
  // vendorExperience's shape. Fail loudly instead.
  const src = readFileSync(resolve(__dirname, "../../../../client/src/lib/languages.ts"), "utf8");
  const start = src.indexOf("STANDARD_LANGUAGES = [");
  assert.ok(start !== -1, "could not find STANDARD_LANGUAGES -- has languages.ts moved?");
  const block = src.slice(start, src.indexOf("]", start));
  const langs = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(langs.length > 0, "parsed no languages out of languages.ts");

  const unmapped = langs.filter((l) => !languageToBcp47(l));
  assert.deepStrictEqual(unmapped, [], `these languages have no BCP47 mapping: ${unmapped.join(", ")}`);
}

function test15_namesSplitSensiblyWhenFirstNameIsMissing() {
  // ~88% of real leads have no firstName -- enrichment writes one resolved
  // fullName and never splits it. Getting this wrong would mean a visibly
  // wrong pre-fill for the large majority of candidates.
  assert.deepStrictEqual(deriveNames({ firstName: null, fullName: "David Buchanan" } as any), {
    firstName: "David",
    lastName: "Buchanan",
  });
  assert.deepStrictEqual(deriveNames({ firstName: null, fullName: "Maria del Carmen Ruiz" } as any), {
    firstName: "Maria",
    lastName: "del Carmen Ruiz",
  });
  // A single token stays a surname -- that's how a Last-Name-only entry is stored.
  assert.deepStrictEqual(deriveNames({ firstName: null, fullName: "Buchanan" } as any), { lastName: "Buchanan" });
  assert.deepStrictEqual(deriveNames({ firstName: null, fullName: null } as any), {});
  // An explicit firstName still wins over any splitting.
  assert.deepStrictEqual(deriveNames({ firstName: "Ana", fullName: "Ana Silva" } as any), {
    firstName: "Ana",
    lastName: "Silva",
  });

  // And it reaches the URL.
  const p = paramsOf(buildApplyUrl(lead({ firstName: null, fullName: "David Buchanan" })));
  assert.strictEqual(p.get("first_name"), "David");
  assert.strictEqual(p.get("last_name"), "Buchanan");
}

function test16_shortLinkUsesItsOwnDomainSetting() {
  // The link a candidate sees must be brandable independently of
  // APP_BASE_URL, which also drives the Unipile webhook URL. If these ever
  // get re-coupled, pointing links at a Global3 domain would silently move
  // the webhook endpoint too.
  assert.ok(
    buildShortApplyUrl(LEAD_ID).startsWith(`${config.shortLinkBaseUrl}/g/`),
    "short link must be built from shortLinkBaseUrl, not appBaseUrl"
  );
}

function test17_trailingSlashOnTheDomainDoesNotDoubleUp() {
  // The value is typed into a hosting dashboard by hand, so a trailing slash
  // is a question of when, not if. It must never reach a candidate as
  // "https://apply.global3.co//g/<token>".
  assert.ok(!buildShortApplyUrl(LEAD_ID).includes("//g/"), "short link must not contain a doubled slash");
  assert.strictEqual(
    buildShortApplyUrl(LEAD_ID).split("/g/").length,
    2,
    "short link should have exactly one /g/ segment"
  );
}

function main() {
  const tests = [
    test1_shortLinkRoundTripsToTheSameLead,
    test2_decodeRejectsGarbageInsteadOfThrowing,
    test3_everyShortLinkIsTheAdvertisedLength,
    test4_linkedInNoteStillFitsWithTheLinkAppended,
    test5_knownFieldsAreMappedNotPassedThroughRaw,
    test6_unknownFieldsAreOmittedNotSentBlank,
    test7_callbackUrlIsNotSent,
    test8_valuesWithReservedCharactersCannotCorruptTheQueryString,
    test9_vendorExperienceAcceptsTheArrayColumnShape,
    test10_yearsOfExperienceRoundsAndRejectsNonsense,
    test11_lastNameDerivationHandlesTheShapesWeActuallyStore,
    test12_onlyRealLinkedInUrlsGoIntoTheLinkedInField,
    test13_urlPointsAtTheConfiguredApplyForm,
    test14_everyStandardLanguageStillMaps,
    test15_namesSplitSensiblyWhenFirstNameIsMissing,
    test16_shortLinkUsesItsOwnDomainSetting,
    test17_trailingSlashOnTheDomainDoesNotDoubleUp,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err: any) {
      failed += 1;
      console.error(`FAIL ${t.name}\n${err?.message || err}`);
    }
  }
  console.log(failed ? `${failed}/${tests.length} test(s) failed` : `All ${tests.length} tests passed`);
  if (failed) process.exit(1);
}

main();
