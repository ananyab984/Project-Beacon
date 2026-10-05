/**
 * SSRF guard tests for fetchCsv (audit P0-6). axios.get is replaced with a
 * fake, so no network call is made -- each test scripts the responses and
 * checks which URLs the server would actually have requested.
 *
 * Run: cd server && npx ts-node src/lib/fetchCsv.test.ts
 */
import assert from "node:assert";
import axios from "axios";
import { fetchCsv, assertGoogleSheetsUrl } from "./fetchCsv";

const EXPORT_URL = "https://docs.google.com/spreadsheets/d/abc123/export?format=csv";
const realGet = axios.get;

/** Replaces axios.get with a scripted fake; returns the list of URLs requested. */
function fakeAxios(respond: (url: string, opts: any) => { status: number; headers?: any; data?: any }) {
  const requested: string[] = [];
  (axios as any).get = async (url: string, opts: any) => {
    requested.push(url);
    assert.strictEqual(opts.maxRedirects, 0, "axios must never follow redirects on its own");
    return { headers: {}, ...respond(url, opts) };
  };
  return requested;
}

// The six internal targets the audit's exploit test proved were accepted.
const SSRF_TARGETS = [
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://127.0.0.1:5001/api/leads",
  "http://localhost:5001/health",
  "http://10.0.0.1/",
  "http://g3-enrichment-pipeline:8000/enrich",
];

async function test1_auditSsrfTargetsAreRefusedWithoutAnyRequest() {
  const requested = fakeAxios(() => ({ status: 200, data: "a,b" }));
  for (const url of SSRF_TARGETS) {
    await assert.rejects(fetchCsv(url), /Only Google Sheets links/, `must refuse ${url}`);
  }
  assert.deepStrictEqual(requested, [], "a refused URL must never be requested at all");
}

async function test2_lookalikesAndNonHttpsAreRefused() {
  const bad = [
    "http://docs.google.com/spreadsheets/d/abc/export?format=csv", // not https
    "https://docs.google.com.evil.example/x.csv", // lookalike suffix
    "https://evil.example/docs.google.com/x.csv", // host in the path
    "https://docs.google.com@169.254.169.254/x.csv", // userinfo trick: real host is the IP
    "https://docs.google.com:8443/x.csv", // non-standard port
    "https://user:pw@docs.google.com/x.csv", // credentials in the URL
    "https://attacker.example/evil.csv", // any .csv used to be accepted
    "not a url",
  ];
  for (const url of bad) assert.throws(() => assertGoogleSheetsUrl(url), `must refuse ${url}`);
  assert.doesNotThrow(() => assertGoogleSheetsUrl(EXPORT_URL));
  assert.doesNotThrow(() => assertGoogleSheetsUrl("https://doc-0g-8c-sheets.googleusercontent.com/export/x"));
}

async function test3_realGoogleExportRedirectIsFollowed() {
  const download = "https://doc-0g-8c-sheets.googleusercontent.com/export/abc?format=csv";
  const requested = fakeAxios((url) =>
    url === EXPORT_URL ? { status: 307, headers: { location: download } } : { status: 200, data: "name,email\nAda,ada@example.com" }
  );
  const csv = await fetchCsv(EXPORT_URL);
  assert.strictEqual(csv, "name,email\nAda,ada@example.com");
  assert.deepStrictEqual(requested, [EXPORT_URL, download]);
}

async function test4_redirectIntoPrivateRangeIsRefusedAndNotRetried() {
  const requested = fakeAxios(() => ({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
  await assert.rejects(fetchCsv(EXPORT_URL), /Only Google Sheets links/);
  assert.deepStrictEqual(requested, [EXPORT_URL], "the private hop must never be requested, and the refusal must not be retried");
}

async function test5_relativeRedirectStaysOnTheAllowedHost() {
  const requested = fakeAxios((url) =>
    url === EXPORT_URL ? { status: 302, headers: { location: "/spreadsheets/d/abc123/export?format=csv&gid=0" } } : { status: 200, data: "x,y" }
  );
  assert.strictEqual(await fetchCsv(EXPORT_URL), "x,y");
  assert.strictEqual(requested[1], "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0");
}

async function test6_redirectLoopIsCapped() {
  const requested = fakeAxios(() => ({ status: 302, headers: { location: EXPORT_URL } }));
  await assert.rejects(fetchCsv(EXPORT_URL), /redirected too many times/);
  assert.strictEqual(requested.length, 6, "the first request plus at most 5 redirect hops");
}

async function test7_htmlSignInPageIsStillReported() {
  fakeAxios(() => ({ status: 200, data: "<!DOCTYPE html><html>Sign in</html>" }));
  await assert.rejects(fetchCsv(EXPORT_URL), /HTML sign-in page/);
}

async function main() {
  const tests = [
    test1_auditSsrfTargetsAreRefusedWithoutAnyRequest,
    test2_lookalikesAndNonHttpsAreRefused,
    test3_realGoogleExportRedirectIsFollowed,
    test4_redirectIntoPrivateRangeIsRefusedAndNotRetried,
    test5_relativeRedirectStaysOnTheAllowedHost,
    test6_redirectLoopIsCapped,
    test7_htmlSignInPageIsStillReported,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    } finally {
      (axios as any).get = realGet;
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
