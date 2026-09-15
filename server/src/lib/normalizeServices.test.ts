/**
 * Unit tests for normalizeServices -- specifically the JSON-array-of-objects
 * detection added to stop it from shredding a JSON payload into garbage
 * tokens (e.g. "rate", "10", "{id", "it-IT}") via the plain delimiter split.
 *
 * Run: cd server && npx ts-node src/lib/normalizeServices.test.ts
 */

import assert from "node:assert";
import { normalizeServices } from "./normalizeServices";

function test1_legacyColonDelimitedStringUnaffected() {
  assert.deepStrictEqual(
    normalizeServices("Sub:Dubbing:Audio Description"),
    ["Subtitling", "Dubbing", "Audio Description"]
  );
}

function test2_legacyArrayInputUnaffected() {
  assert.deepStrictEqual(normalizeServices(["voiceover", "qc"]), ["Voice Over", "Quality Control"]);
}

function test3_jsonArrayOfServiceObjectsExtractsCleanLabels() {
  const raw = JSON.stringify([
    { id: 1788358696814, task: "Quality Control", service: "dub", min_rate: 8, rate: 10, source_language: "en-US", target_language: "it-IT" },
    { id: 1788358845347, task: "Voice Generation", min_rate: 2, rate: 3, source_language: "en-US", target_language: "it-IT" },
  ]);
  assert.deepStrictEqual(normalizeServices(raw), ["Quality Control", "Voice Generation"]);
}

function test4_duplicateTaskValuesAcrossObjectsCollapseViaExistingDedupe() {
  const raw = JSON.stringify([
    { task: "Quality Control", source_language: "en-US", target_language: "it-IT" },
    { task: "Quality Control", source_language: "en-US", target_language: "fr-FR" },
  ]);
  assert.deepStrictEqual(normalizeServices(raw), ["Quality Control"]);
}

function test5_malformedJsonStartingWithBracketFallsBackGracefully() {
  assert.doesNotThrow(() => normalizeServices("[not json"));
  assert.deepStrictEqual(normalizeServices("[not json"), ["[not json"]);
}

function test6_emptyOrNullInputReturnsEmptyArray() {
  assert.deepStrictEqual(normalizeServices(null), []);
  assert.deepStrictEqual(normalizeServices(undefined), []);
  assert.deepStrictEqual(normalizeServices(""), []);
}

function main() {
  const tests = [
    test1_legacyColonDelimitedStringUnaffected,
    test2_legacyArrayInputUnaffected,
    test3_jsonArrayOfServiceObjectsExtractsCleanLabels,
    test4_duplicateTaskValuesAcrossObjectsCollapseViaExistingDedupe,
    test5_malformedJsonStartingWithBracketFallsBackGracefully,
    test6_emptyOrNullInputReturnsEmptyArray,
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
