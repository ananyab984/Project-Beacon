/**
 * Bug: from /unauthorized, signing back in could land you on /unauthorized
 * again (login followed a ?redirect= into another role's area), and a
 * session that expired mid-use never sent anyone to sign in at all.
 *
 * Run: cd client && npx tsx src/lib/authRedirect.test.ts
 */
import assert from "node:assert";
import { safeRedirect, shouldReauthenticate } from "./authRedirect";

// safeRedirect: only your own role's area, only same-origin paths
assert.strictEqual(safeRedirect("/recruiter/leads", "recruiter"), "/recruiter/leads");
assert.strictEqual(safeRedirect("/recruiter?tab=queue", "recruiter"), "/recruiter?tab=queue");
assert.strictEqual(
  safeRedirect("/owner/settings", "recruiter"),
  "/recruiter",
  "another role's page must not bounce you to /unauthorized",
);
assert.strictEqual(safeRedirect("/unauthorized", "owner"), "/owner");
assert.strictEqual(safeRedirect("/recruiterx", "recruiter"), "/recruiter", "prefix lookalike");
assert.strictEqual(
  safeRedirect("//evil.example.com", "owner"),
  "/owner",
  "protocol-relative open redirect",
);
assert.strictEqual(
  safeRedirect("/\\evil.example.com", "owner"),
  "/owner",
  "backslash open redirect",
);
assert.strictEqual(safeRedirect("https://evil.example.com", "owner"), "/owner");
assert.strictEqual(safeRedirect(undefined, "CONTRACTOR"), "/contractor");

// shouldReauthenticate: only a dead session, never on a signed-out page
assert.ok(shouldReauthenticate(401, "UNAUTHORIZED_TOKEN_EXPIRED", "/recruiter/leads"));
assert.ok(shouldReauthenticate(401, "UNAUTHORIZED_INVALID_TOKEN", "/unauthorized"));
assert.ok(!shouldReauthenticate(401, "UNAUTHORIZED_TOKEN_EXPIRED", "/login"), "would reload-loop");
assert.ok(!shouldReauthenticate(401, "UNAUTHORIZED_TOKEN_EXPIRED", "/onboarding/connect"));
assert.ok(
  !shouldReauthenticate(403, "FORBIDDEN", "/owner"),
  "a 403 is a permission answer, not a dead session",
);
assert.ok(
  !shouldReauthenticate(401, "EMAIL_NOT_VERIFIED", "/owner"),
  "other 401s are handled by their own screens",
);
console.log("All auth redirect tests passed");
