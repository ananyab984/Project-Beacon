import assert from "node:assert/strict";
import { buildFollowUpPrompt, type FollowUpInput } from "./draftGenerator";

const base: FollowUpInput = { channel: "email", firstName: "Ana", services: ["Subtitling"], sourceLanguage: "English", targetLanguage: "Portuguese", daysSince: 4, step: 1, previousMessage: "Hi Ana, we'd love to have you.", applyUrl: "https://x.test/g/abc" };

const [sys1, user1] = buildFollowUpPrompt(base);
assert.ok(sys1.includes("first follow-up") && !sys1.includes("LAST"), "step 1 is a light check-in");
assert.ok(sys1.includes("Include a subject line") && sys1.includes('"subject"'), "email asks for a subject");
assert.ok(sys1.includes("Never invent"), "grounded in the given facts only");
assert.ok(user1.includes("First name: Ana") && user1.includes("English -> Portuguese") && user1.includes("Days since our last message: 4"));
assert.ok(user1.includes("Hi Ana, we'd love to have you."), "earlier message supplied as context");
assert.ok(user1.includes("https://x.test/g/abc"), "apply link supplied");

const [sys2] = buildFollowUpPrompt({ ...base, channel: "linkedin", step: 2, daysSince: 8 });
assert.ok(sys2.includes("LAST follow-up"), "step 2 is the final nudge");
assert.ok(sys2.includes("under 300 characters") && !sys2.includes('"subject"'), "LinkedIn is short with no subject");

const [, user3] = buildFollowUpPrompt({ ...base, previousMessage: null, services: [], sourceLanguage: null, targetLanguage: null });
assert.ok(user3.includes("(not available)") && !user3.includes("Services:") && !user3.includes("Languages:"), "missing facts are left out, not invented");
console.log("followUpPrompt: all assertions passed");
