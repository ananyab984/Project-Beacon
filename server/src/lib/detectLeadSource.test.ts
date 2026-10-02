/**
 * Unit tests for lead source detection -- the URL-beats-label rule that
 * replaced `mapToLeadSource`'s blind `?? "LINKEDIN"` default.
 *
 * The cases named "live regression" below are the five real rows measured in
 * the production DB on 2026-10-01, each stored as source=LINKEDIN with a
 * non-LinkedIn profile link, each burning a rejected Bright Data call.
 *
 * Run: cd server && npx ts-node src/lib/detectLeadSource.test.ts
 */

import assert from "node:assert";
import { detectLeadSource, isUsableProfileUrl, sourceFromLabel, sourceFromProfileLink } from "./detectLeadSource";

// --- URL is recognized: it decides, whatever the label claims ---------------
assert.equal(detectLeadSource("LinkedIn", "https://www.linkedin.com/in/someone/"), "LINKEDIN");
assert.equal(detectLeadSource("LinkedIn", "https://www.proz.com/profile/3476569"), "PROZ");
// live regression: 2 rows labelled LINKEDIN with bodalgo.com links
assert.equal(
  detectLeadSource("LinkedIn", "https://www.bodalgo.com/en/voice-over-talents/enrique-lozano-ruiz?job_id=66484"),
  "BODALGO"
);
assert.equal(detectLeadSource("LinkedIn", "https://www.freelancer.com/u/someone"), "FREELANCER");
assert.equal(detectLeadSource(null, "https://www.audiodescription.co.uk/profile/x"), "ADA");
assert.equal(detectLeadSource(null, "https://www.atanet.org/profile/x"), "ATA");
assert.equal(detectLeadSource(null, "https://www.ataa.fr/profile/x"), "ATAA");
assert.equal(detectLeadSource(null, "https://apollo.io/contacts/x"), "APOLLO");

// Locale subdomains are the same platform (real hosts from the ProZ POC data).
assert.equal(sourceFromProfileLink("https://ara.proz.com/profile/68960"), "PROZ");
assert.equal(sourceFromProfileLink("https://hrv.proz.com/profile/68960"), "PROZ");

// Lookalike hosts must NOT match -- the reason for the label-boundary walk
// rather than a bare endsWith().
assert.equal(sourceFromProfileLink("https://notlinkedin.com/in/x"), null);
assert.equal(sourceFromProfileLink("https://proz.com.evil.net/in/x"), null);
assert.equal(sourceFromProfileLink("https://linkedin.com.phish.io/in/x"), null);

// --- URL present but unrecognized: OTHER, never the label ------------------
// live regressions: three personal/agency sites stored as LINKEDIN
assert.equal(detectLeadSource("LinkedIn", "https://www.provoiceactor.co.uk/"), "OTHER");
assert.equal(detectLeadSource("Sutext", "https://www.subtext-translations.com/"), "OTHER");
assert.equal(
  detectLeadSource("subtle-subtitlers.", "https://subtle-subtitlers.org.uk/professional-profile/AmberHughes/"),
  "OTHER"
);
// Even a confident, recognizable label loses to a URL that contradicts it.
assert.equal(detectLeadSource("PROZ", "https://someones-portfolio.example/"), "OTHER");

// A link with no scheme still parses (createLeadSchema adds one, but direct
// callers such as the backfill script do not).
assert.equal(detectLeadSource(null, "www.bodalgo.com/en/voice-over-talents/x"), "BODALGO");

// --- No usable URL: fall back to the label --------------------------------
assert.equal(detectLeadSource("LinkedIn", null), "LINKEDIN");
assert.equal(detectLeadSource("proz", ""), "PROZ");
assert.equal(detectLeadSource("Bodalgo", undefined), "BODALGO");
assert.equal(detectLeadSource("  linked in  ", null), "LINKEDIN");

// --- No evidence at all: OTHER, not a fabricated LINKEDIN -----------------
// This is the core behaviour change. The old code returned LINKEDIN here.
assert.equal(detectLeadSource(null, null), "OTHER");
assert.equal(detectLeadSource("", ""), "OTHER");
assert.equal(detectLeadSource("Voices123", null), "OTHER");
assert.equal(detectLeadSource(null, "not a url at all"), "OTHER");

// --- Label matching: ATAA must not be swallowed by ATA --------------------
// The old `LEAD_SOURCES.find(s => upper.includes(s))` scanned in declaration
// order, so "ATAA".includes("ATA") matched first and every ATAA lead was
// filed as ATA.
assert.equal(sourceFromLabel("ATAA"), "ATAA");
assert.equal(sourceFromLabel("ataa"), "ATAA");
assert.equal(sourceFromLabel("ATA"), "ATA");
assert.equal(sourceFromLabel("Sourced from ATAA directory"), "ATAA");
assert.equal(sourceFromLabel("nothing useful"), null);
assert.equal(sourceFromLabel(""), null);

// detectLeadSource always returns a valid enum member, never undefined.
for (const [label, link] of [
  [null, null],
  ["garbage", "also garbage"],
  ["LinkedIn", "https://x.test/"],
] as const) {
  const got = detectLeadSource(label, link);
  assert.ok(typeof got === "string" && got.length > 0, `bad result for ${label}/${link}`);
}

// --- isUsableProfileUrl: what may reach a paid scraper -------------------
for (const good of [
  "https://www.linkedin.com/in/someone/",
  "https://www.proz.com/profile/3476569",
  "https://ara.proz.com/profile/68960",
  "www.bodalgo.com/en/voice-over-talents/x",   // scheme added by the schema
  "subtle-subtitlers.org.uk/professional-profile/AmberHughes/",
  "https://a.co",
  "http://example.com/path?q=1#frag",
]) {
  assert.equal(isUsableProfileUrl(good), true, `should accept ${good}`);
}

for (const bad of [
  "",
  "   ",
  null,
  undefined,
  "not a url",             // space in host -- the common paste error
  "n/a",
  "TBC",
  "notaurl",               // single label, parses fine but is not a host
  "localhost",
  "https://localhost",
  "javascript:alert(1)",   // never render this as a link
  "data:text/html,<h1>x",
  "ftp://files.example.com/x",
  "https://a..com",        // empty label
  "https://1.2.3.4/x",     // IP literal is never a public profile directory
]) {
  assert.equal(isUsableProfileUrl(bad as any), false, `should reject ${JSON.stringify(bad)}`);
}

// A rejected link must not then be mistaken for a platform.
assert.equal(sourceFromProfileLink("not a url"), null);

console.log("detectLeadSource: all assertions passed");
