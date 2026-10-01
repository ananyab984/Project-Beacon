/** Pure-function parity check for the drafting_service -> server/src/drafting
 * port. Asserts the TS ports of readability.py and difflib.SequenceMatcher
 * produce output matching the actual Python implementations, computed once
 * by hand and hardcoded below as the reference values. Run via:
 *   npx ts-node scripts/verify-drafting-port.ts
 * Exits non-zero on any mismatch. */

import { fleschKincaidGrade, fleschReadingEase } from "../src/drafting/readability";
import { sequenceMatcherRatio } from "../src/drafting/lib/sequenceMatcher";

let failures = 0;

function check(label: string, got: number, expected: number, tolerance = 1e-4) {
  const pass = Math.abs(got - expected) < tolerance;
  console.log(`${pass ? "PASS" : "FAIL"} ${label}: got=${got} expected=${expected}`);
  if (!pass) failures++;
}

// --- readability.py parity -------------------------------------------------
// Reference values computed by running the actual Python
// drafting_service/core/readability.py against these exact strings.
const readabilitySamples: [string, [number, number]][] = [
  [
    "Hi Alex, I hope this email finds you well. We recently reviewed your profile and believe your background would be a strong asset to our team.",
    [79.755385, 5.364615],
  ],
  ["Short note.", [100.0, 0.0]],
  ["", [0.0, 0.0]],
  [
    "The quick brown fox jumps over the lazy dog. This is a simple sentence used for testing readability scores across multiple sentence boundaries!",
    [62.745109, 7.364565],
  ],
];

readabilitySamples.forEach(([text, [expectedFre, expectedFk]], i) => {
  check(`readability[${i}] flesch_reading_ease`, fleschReadingEase(text), expectedFre, 1e-3);
  check(`readability[${i}] flesch_kincaid_grade`, fleschKincaidGrade(text), expectedFk, 1e-3);
});

// --- difflib.SequenceMatcher.ratio() parity ---------------------------------
// Reference values computed via Python's actual difflib.SequenceMatcher.
const seqMatcherPairs: [string, string, number][] = [
  ["hello world", "hello there", 0.6363636364],
  ["", "", 1.0],
  ["abc", "xyz", 0.0],
  [
    "The quick brown fox jumps over the lazy dog.",
    "The quick brown fox leaps over the lazy dog.",
    0.9318181818,
  ],
  ["a".repeat(250) + "unique-tail", "a".repeat(250) + "different-tail-xyz", 0.9678638941],
  [
    "Hi Alex, I hope this finds you well. Sfera Studios OOONA WinCaps.",
    "Hi Alex, I hope this note finds you well! Sfera Studios, OOONA and WinCaps.",
    0.9142857143,
  ],
];

seqMatcherPairs.forEach(([a, b, expected], i) => {
  check(`sequenceMatcherRatio[${i}]`, sequenceMatcherRatio(a, b), expected, 1e-9);
});

console.log(failures === 0 ? "\nAll pure-function parity checks passed." : `\n${failures} MISMATCH(ES) DETECTED.`);
process.exit(failures === 0 ? 0 : 1);
