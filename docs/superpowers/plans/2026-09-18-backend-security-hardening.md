# Backend Security Hardening (Non-Business-Logic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Status (2026-09-18): 11 of 12 tasks complete, 1 blocked

Executed directly in-session (tasks small enough not to need the full
subagent-driven-development pipeline), each verified with `tsc --noEmit` plus
the relevant existing test suite before moving to the next task, all on
branch `fix/backend-security-hardening`, single PR per the user's request.

- **Tasks 1–8, 10–12: DONE**, each committed individually with its own test
  evidence (see commit messages on the branch for exact verification steps).
- **Task 9 (List-Unsubscribe headers): BLOCKED, not implemented.** Checked
  this repo's own Unipile documentation
  (`Documents/Unipile_Authentication_and_Subscription_Management_Implementation_Plan.md`,
  the `unipile_poc` README) for confirmation that the `/emails` send endpoint
  accepts custom headers — found none either way (the only documented
  `headers` field is on a *different* endpoint, webhook registration). Since
  Unipile's send API might reject an unrecognized field outright — breaking
  real outreach email, the exact risk the user flagged — this was left
  untouched rather than guessed at. Needs Unipile's actual current API
  reference (or their support) checked before it's safe to implement.
- **Task 7 turned out bigger than scoped**: the same read-then-write race
  existed in FOUR places in that block (Requirement increment/decrement AND
  the parallel ClientDemand increment/decrement), not just the one
  originally found — fixed all four consistently, since they're the
  identical bug with the identical fix shape.
- **Found in passing, not caused by this branch**:
  `enrichmentEvaluation.test.ts` fails 2 of 3 tests (stale `test_`-prefixed
  data in the shared dev DB) — confirmed via `git stash` to fail identically
  on `main` with none of this branch's changes applied. Unrelated to any of
  these 12 tasks; flagged to the user separately, not fixed here (out of
  scope, and not a regression to chase down under this plan).

**Goal:** Close the pure-hygiene / infra-hardening findings from the pre-production security audit (2026-09-17/18) without touching any recruiting business rule (DNC, enrichment gating, duplicate gating, stage transitions, outreach caps) or any behavior a legitimate user currently relies on.

**Architecture:** Twelve small, independent tasks against the existing Node/Express server (`server/src`) and the Python enrichment service (`enrichment_pipeline/`). No new services, no schema changes beyond what's already in Prisma, no frontend changes.

**Tech Stack:** Node/Express/TypeScript/Prisma (server), FastAPI/Python (enrichment_pipeline), existing test convention (standalone `*.test.ts` scripts using `node:assert`, run via `npx ts-node`, hitting the real dev DB with `test_`-prefixed data + explicit `cleanup()`).

## Global Constraints

- No changes to business logic: DNC enforcement, enrichment/duplicate gating, lead stage-transition validation, outreach volume caps, AI draft caps, contractor-assignment ownership scoping, and the `GET /api/leads` field-level identity exposure are **explicitly out of scope** for this plan — deferred to a separate, dedicated pass.
- The Owner self-service role-escalation fix (`POST /api/auth/profile`) is a known Critical finding but is **explicitly deferred** per the user's decision on 2026-09-18 — do not fix it as part of this plan.
- No frontend/client changes.
- Every task must leave `npx tsc --noEmit` clean in `server/` and leave every existing `*.test.ts` file passing.
- New helpers follow this codebase's established self-contained-resilience convention: catch their own errors, log, and degrade gracefully rather than throwing upward, unless the task says otherwise.
- Task 11 (internal service auth) requires a new required env var on **both** `server/` and `enrichment_pipeline/` deployments before/at ship time — confirmed with the user, who will set it.

---

### Task 1: Remove dead JWT/refresh-token config, fix `.env.example` placeholders

**Files:**
- Modify: `server/src/config.ts:37-40`
- Modify: `server/.env.example:4-6`

**Context:** `jwtSecret`, `jwtExpiresIn`, `refreshTokenSecret`, `refreshTokenExpiresIn` are dead — grep confirms zero usage anywhere else in `server/src` (auth is 100% Neon Auth/JWKS now, see `middleware/auth.ts`). Their hardcoded fallback values are also copy-pasted verbatim into `.env.example`, which trains anyone copying that file into a real `.env` to think these are fine production values.

- [ ] **Step 1:** In `server/src/config.ts`, delete lines 37-40:
```typescript
  jwtSecret: process.env.JWT_SECRET || "super_secret_jwt_access_key_global3_2026",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || "super_secret_jwt_refresh_key_global3_2026",
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
```
- [ ] **Step 2:** In `server/.env.example`, replace lines 4-6:
```
# JWT Secrets (can use defaults for development)
JWT_SECRET=super_secret_jwt_access_key_global3_2026
REFRESH_TOKEN_SECRET=super_secret_jwt_refresh_key_global3_2026
```
with nothing (delete the block entirely — these vars are dead, so don't even list them as optional).
- [ ] **Step 3:** Run `cd server && npx tsc --noEmit` — must stay clean (proves nothing else referenced the removed fields).
- [ ] **Step 4:** Grep `server/src` and `server/.env.example` for `JWT_SECRET|REFRESH_TOKEN_SECRET|jwtSecret|refreshTokenSecret|jwtExpiresIn|refreshTokenExpiresIn` — must return zero hits.
- [ ] **Step 5:** Commit: `git add server/src/config.ts server/.env.example && git commit -m "chore: remove dead JWT config fields, unused since Neon Auth migration"`

---

### Task 2: Constant-time comparison for the Unipile webhook secret/token

**Files:**
- Modify: `server/src/services/unipile.service.ts:987-994`
- Test: `server/src/services/webhookAuth.test.ts` (new)

**Context:** `UnipileService.handleWebhookEvent` currently compares the path token and secret header with plain `!==` (lines 988, 992). `crypto` is already imported in this file (used for `crypto.createHash` a few lines below). A constant-time compare removes a theoretical timing side-channel with zero behavior change for both the accept and reject cases.

- [ ] **Step 1: Write the failing test** — `server/src/services/webhookAuth.test.ts`:
```typescript
/**
 * Run: cd server && npx ts-node src/services/webhookAuth.test.ts
 */
import assert from "node:assert";
import { safeCompare } from "./unipile.service";

function test1_equalStringsMatch() {
  assert.strictEqual(safeCompare("abc123", "abc123"), true);
}

function test2_differentSameLengthStringsDoNotMatch() {
  assert.strictEqual(safeCompare("abc123", "abc124"), false);
}

function test3_differentLengthStringsDoNotMatch() {
  assert.strictEqual(safeCompare("short", "much-longer-value"), false);
}

function test4_emptyStringsHandledSafely() {
  assert.strictEqual(safeCompare("", ""), true);
  assert.strictEqual(safeCompare("", "x"), false);
}

function main() {
  const tests = [test1_equalStringsMatch, test2_differentSameLengthStringsDoNotMatch, test3_differentLengthStringsDoNotMatch, test4_emptyStringsHandledSafely];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```
- [ ] **Step 2: Run it, confirm it fails** (`safeCompare` doesn't exist yet / isn't exported):
Run: `cd server && npx ts-node src/services/webhookAuth.test.ts`
Expected: `TSError` — `safeCompare` is not exported from `./unipile.service`.
- [ ] **Step 3: Implement `safeCompare` and use it at the two call sites.** In `unipile.service.ts`, near the top-level helper functions (not inside the class), add:
```typescript
/** Constant-time string comparison for secrets — a plain `!==` on a fixed
 * webhook path token/secret leaks a timing signal proportional to how many
 * leading characters match. Exported for webhookAuth.test.ts. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
```
Then replace lines 988 and 992:
```typescript
    if (!safeCompare(token, config.unipileWebhookPathToken)) {
      throw { statusCode: 401, message: "Invalid webhook path token" };
    }

    if (!safeCompare(secretHeader || "", config.unipileWebhookSecret)) {
      throw { statusCode: 401, message: "Invalid webhook secret header" };
    }
```
(`secretHeader` is typed `string | undefined` — coerce to `""` so `safeCompare` always receives two strings; an empty string can never equal a real, non-empty `unipileWebhookSecret`, so behavior for the "header missing" case is unchanged.)
- [ ] **Step 4: Run the test again, confirm it passes.**
Run: `cd server && npx ts-node src/services/webhookAuth.test.ts`
Expected: `All 4 tests passed`
- [ ] **Step 5:** Run the existing webhook tests to confirm no regression: `npx ts-node src/__tests__/webhook.test.ts` and `npx ts-node src/services/emailReplyThreading.test.ts` — both must still pass unchanged (they test valid/invalid token+secret combinations end-to-end).
- [ ] **Step 6:** Commit: `git add server/src/services/unipile.service.ts server/src/services/webhookAuth.test.ts && git commit -m "fix: constant-time comparison for Unipile webhook secret/token"`

---

### Task 3: Document the request body size limit explicitly

**Files:**
- Modify: `server/src/index.ts:67`

**Context:** `express.json()` is called with no options, silently relying on Express's built-in 100kb default. Making the limit explicit is a no-op today (same 100kb) but removes the "is this intentional?" question for the next person reading this file, and gives a single place to raise it later if a real payload ever needs more.

- [ ] **Step 1:** Change line 67 from:
```typescript
app.use(express.json());
```
to:
```typescript
// Matches Express's own default (100kb) — made explicit so it reads as a
// deliberate choice, not an oversight, and so raising it later is a one-line change.
app.use(express.json({ limit: "100kb" }));
```
- [ ] **Step 2:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 3:** Manually confirm no existing route sends a body close to/over 100kb (spot check `POST /api/leads/check-bulk-duplicates` and `POST /api/email-queue/batch-send`, the two largest-payload routes found during the audit) — if either could plausibly need more, flag it in the task report rather than guessing a new limit.
- [ ] **Step 4:** Commit: `git add server/src/index.ts && git commit -m "chore: make express.json body size limit explicit"`

---

### Task 4: Strip service name/version from the unauthenticated `/health` endpoint

**Files:**
- Modify: `server/src/index.ts:71-73`

**Context:** `GET /health` currently returns `{ status: "healthy", service: "global3-server", version: "1.0.0" }` to any unauthenticated caller. The version is a static, never-bumped literal (low value to an attacker today), but there's no reason to disclose it. Hosting platforms (Render, Vercel, etc.) only check the HTTP status code for liveness, not the JSON body shape, so this is safe to narrow.

- [ ] **Step 1:** Change:
```typescript
app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "global3-server", version: "1.0.0" });
});
```
to:
```typescript
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});
```
- [ ] **Step 2:** Grep the codebase (`server/`, `client/`, any deploy scripts) for `"global3-server"` or a health-check consumer that reads `.service`/`.version` from this response — none expected, but confirm before removing.
- [ ] **Step 3:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 4:** Commit: `git add server/src/index.ts && git commit -m "fix: stop exposing service name/version on unauthenticated /health"`

---

### Task 5: Centralized log redaction for the two flagged verbatim-PII log sites

**Files:**
- Create: `server/src/lib/logSanitizer.ts`
- Test: `server/src/lib/logSanitizer.test.ts`
- Modify: `server/src/routes/faq.routes.ts:31`
- Modify: `server/src/services/unipile.service.ts` (the `ambiguous email backfill` warning, ~line 1400)
- Modify: `server/src/jobs/reenrichment.job.ts:82-85` (remove the one-time raw-response debug dump)

**Context:** The audit flagged two real verbatim-PII log lines: the incoming lead message logged (truncated) in `faq.routes.ts:31`, and a lead's email address logged in full in `unipile.service.ts`'s "ambiguous email backfill" warning. Rather than hand-editing each site with ad hoc masking, add one small reusable helper so future call sites have a ready-made safe option.

- [ ] **Step 1: Write the failing test** — `server/src/lib/logSanitizer.test.ts`:
```typescript
/**
 * Run: cd server && npx ts-node src/lib/logSanitizer.test.ts
 */
import assert from "node:assert";
import { redactForLog } from "./logSanitizer";

function test1_masksEmailAddresses() {
  const result = redactForLog("contact me at jane.doe@example.com please");
  assert.ok(!result.includes("jane.doe@example.com"), "raw email must not appear");
  assert.ok(result.includes("j***@example.com"), `expected masked email, got: ${result}`);
}

function test2_truncatesLongText() {
  const long = "a".repeat(200);
  const result = redactForLog(long, 50);
  assert.strictEqual(result.length, 53); // 50 chars + "..."
  assert.ok(result.endsWith("..."));
}

function test3_shortTextUnaffectedByTruncation() {
  const result = redactForLog("short message", 100);
  assert.strictEqual(result, "short message");
}

function test4_handlesEmptyAndNullish() {
  assert.strictEqual(redactForLog(""), "");
  assert.strictEqual(redactForLog(null as any), "");
  assert.strictEqual(redactForLog(undefined as any), "");
}

function main() {
  const tests = [test1_masksEmailAddresses, test2_truncatesLongText, test3_shortTextUnaffectedByTruncation, test4_handlesEmptyAndNullish];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```
- [ ] **Step 2: Run it, confirm it fails** (module doesn't exist yet).
- [ ] **Step 3: Implement** `server/src/lib/logSanitizer.ts`:
```typescript
/** Masks obvious PII (email addresses) and truncates long text before it
 * goes into a console.log/console.warn call — for the handful of call sites
 * that log lead-supplied free text or identifiers for debugging. Not a
 * general-purpose PII scrubber (doesn't touch phone numbers, names, etc.) —
 * scoped to what the audit actually found logged verbatim. */
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export function redactForLog(text: string | null | undefined, maxLen = 100): string {
  if (!text) return "";
  const masked = text.replace(EMAIL_PATTERN, "$1***$2");
  if (masked.length <= maxLen) return masked;
  return `${masked.slice(0, maxLen)}...`;
}
```
- [ ] **Step 4: Run the test again, confirm it passes.**
- [ ] **Step 5: Apply at the flagged call sites.**

In `server/src/routes/faq.routes.ts`, add the import and change line 31:
```typescript
import { redactForLog } from "../lib/logSanitizer";
// ...
console.log(`[FAQ] Incoming check request with message: "${redactForLog(leadMessage, 100)}"`);
```

In `server/src/services/unipile.service.ts`, add the import near the top and change the ambiguous-backfill warning (~line 1400) from logging `fromIdentity` raw to:
```typescript
console.warn(`[unipile webhook] Ambiguous email backfill for chatId=${chatId}: ${candidates.length} conversations share lead email ${redactForLog(fromIdentity)} -- refusing to guess.`);
```

In `server/src/jobs/reenrichment.job.ts`, remove the now-unneeded one-time debug dump (lines 82-85 — this was scaffolding to learn Autumn's `/credits` response shape during development, and isn't lead-specific PII, but it's no longer needed and does print internal account/credit data to shared logs):
```typescript
    const data = await autumnGet<Record<string, unknown>>("/credits");
    return parseCreditSnapshot(data);
```
(removing the `if (!creditsShapeLogged) { ... }` block and the now-unused `creditsShapeLogged` module-level flag it references — grep the file for `creditsShapeLogged` to remove its declaration too).
- [ ] **Step 6:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 7:** Run the existing FAQ and reenrichment test suites to confirm no regression: `npx ts-node src/routes/faqCheck.test.ts`, `npx ts-node src/routes/enrichmentEvaluation.test.ts` (or whichever covers reenrichment — check for a `reenrichment*.test.ts` file first).
- [ ] **Step 8:** Commit: `git add server/src/lib/logSanitizer.ts server/src/lib/logSanitizer.test.ts server/src/routes/faq.routes.ts server/src/services/unipile.service.ts server/src/jobs/reenrichment.job.ts && git commit -m "fix: redact lead PII from FAQ/webhook logs, drop stale debug dump"`

---

### Task 6: Audit-log RBAC and ownership rejections

**Files:**
- Modify: `server/src/middleware/rbac.ts:5-21`
- Modify: `server/src/routes/lead.routes.ts` (the `assertContractorOwnsLead` helper, ~line 38)

**Context:** A 403 from `requireRole` or `assertContractorOwnsLead` currently leaves no trace anywhere — no log line at all. This is purely additive (nothing about the response the caller receives changes) but gives an actual audit trail for repeated cross-tenant probing.

- [ ] **Step 1:** In `server/src/middleware/rbac.ts`, inside `requireRole`'s rejection branch, add one line before the `return res.status(403)...`:
```typescript
    const normalizedRole = req.user.role.toLowerCase() as Role;
    if (!allowedRoles.includes(normalizedRole)) {
      console.warn(`[rbac] DENIED user=${req.user.id} role=${req.user.role} path=${req.method} ${req.originalUrl} requiredRoles=[${allowedRoles.join(",")}]`);
      return res.status(403).json({
        error: "FORBIDDEN_INSUFFICIENT_ROLE",
        message: `Role '${req.user.role}' is not authorized to access this resource`,
      });
    }
```
- [ ] **Step 2:** Read `server/src/routes/lead.routes.ts` around the `assertContractorOwnsLead` helper (~line 38) to get its exact current signature and rejection branch, then add an equivalent one-line `console.warn` there (`user=... leadId=... path=...`) immediately before it returns/throws its 403/404. Match the file's existing error-throwing convention (`ApiError` vs. direct `res.status`) — don't change what's thrown, only add the log line before it.
- [ ] **Step 3:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 4:** Run the existing cross-tenant isolation tests to confirm the 403/404 response bodies are byte-identical to before (only a new server-side log line was added): `npx ts-node src/routes/crossContractorMessagingIsolation.test.ts`, `npx ts-node src/routes/leadContractorParity.test.ts`.
- [ ] **Step 5:** Commit: `git add server/src/middleware/rbac.ts server/src/routes/lead.routes.ts && git commit -m "feat: log RBAC and lead-ownership rejections for audit trail"`

---

### Task 7: Fix the `Requirement.filled` lost-increment race condition

**Files:**
- Modify: `server/src/routes/lead.routes.ts:958-978`
- Test: `server/src/routes/requirementFilledConcurrency.test.ts` (new)

**Context:** `PATCH /api/leads/:id` on a stage change to `ONBOARDED` reads `matchingReq.filled`, computes `matchingReq.filled + 1` in JS, then writes it via a separate `prisma.requirement.update` call — not atomic. Two leads onboarding into the same requirement at the same moment can both read the same starting value and one increment is silently lost. Fix: use Prisma's atomic `{ increment: 1 }`, then derive `gap`/`status` from the update's own return value (which reflects the truly-post-increment row), not the stale pre-write snapshot.

- [ ] **Step 1: Write the failing test** — `server/src/routes/requirementFilledConcurrency.test.ts`:
```typescript
/**
 * Regression test for the lost-increment race in PATCH /api/leads/:id's
 * stage->ONBOARDED handler (lead.routes.ts). Simulates two concurrent
 * onboardings into the same requirement the way the route handler currently
 * computes the update, to prove the fix is atomic at the DB level.
 * Run: cd server && npx ts-node src/routes/requirementFilledConcurrency.test.ts
 */
import assert from "node:assert";
import { prisma } from "../prisma";

async function test1_concurrentIncrementsAreNotLost() {
  const req = await prisma.requirement.create({
    data: {
      id: `test_req_concurrency_${Date.now()}`,
      title: "Test Requirement",
      language: "Spanish",
      headcountNeeded: 10,
      filled: 0,
      gap: 10,
      status: "ACTIVE",
      priority: "MEDIUM",
    },
  });

  try {
    // Fire 5 concurrent atomic increments the same way the fixed route code
    // will -- this is the exact operation being validated, not a mock.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.requirement.update({
          where: { id: req.id },
          data: { filled: { increment: 1 } },
        })
      )
    );

    const final = await prisma.requirement.findUniqueOrThrow({ where: { id: req.id } });
    assert.strictEqual(final.filled, 5, `expected all 5 concurrent increments to land, got filled=${final.filled}`);
  } finally {
    await prisma.requirement.delete({ where: { id: req.id } });
  }
}

async function main() {
  const tests = [test1_concurrentIncrementsAreNotLost];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```
- [ ] **Step 2: Run it against the CURRENT (unfixed) route code path conceptually** — this test exercises the atomic increment directly (proving Prisma/Postgres itself handles it correctly), so it should already pass on its own; it's here to pin the behavior the route fix must use. Run: `cd server && npx ts-node src/routes/requirementFilledConcurrency.test.ts` — expect PASS (this confirms your Prisma/Postgres setup supports atomic increment as expected before you touch the route).
- [ ] **Step 3: Fix the route.** In `server/src/routes/lead.routes.ts`, replace lines 968-978:
```typescript
          if (matchingReq) {
            const newFilled = matchingReq.filled + 1;
            const newGap = Math.max(0, matchingReq.headcountNeeded - newFilled);
            await prisma.requirement.update({
              where: { id: matchingReq.id },
              data: {
                filled: newFilled,
                gap: newGap,
                status: newGap === 0 ? "FULFILLED" : matchingReq.status,
              },
            });
          }
```
with:
```typescript
          if (matchingReq) {
            // Atomic at the DB level (UPDATE ... SET filled = filled + 1) --
            // fixes a lost-increment race where two leads onboarding into the
            // same requirement at once could both read the same starting
            // `filled` value and overwrite each other. gap/status are derived
            // from THIS update's own returned row, not the pre-write snapshot.
            const updatedReq = await prisma.requirement.update({
              where: { id: matchingReq.id },
              data: { filled: { increment: 1 } },
            });
            const newGap = Math.max(0, updatedReq.headcountNeeded - updatedReq.filled);
            if (newGap !== updatedReq.gap || (newGap === 0 && updatedReq.status !== "FULFILLED")) {
              await prisma.requirement.update({
                where: { id: matchingReq.id },
                data: { gap: newGap, status: newGap === 0 ? "FULFILLED" : updatedReq.status },
              });
            }
          }
```
- [ ] **Step 4:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 5:** Run the new test again plus the existing requirement-related tests to confirm no regression (check for any `requirement*.test.ts` files alongside `leadContractorParity.test.ts`, which touches stage transitions).
- [ ] **Step 6:** Commit: `git add server/src/routes/lead.routes.ts server/src/routes/requirementFilledConcurrency.test.ts && git commit -m "fix: atomic Requirement.filled increment, closes lost-increment race"`

---

### Task 8: Circuit breaker around third-party API calls

**Files:**
- Create: `server/src/lib/circuitBreaker.ts`
- Test: `server/src/lib/circuitBreaker.test.ts`
- Modify: `server/src/drafting/claudeClient.ts` (wrap the Claude call)
- Modify: wherever the Groq client call lives (grep `groqApiKey` usage in `server/src` to find it)

**Context:** `retryWithBackoff` already exists and handles per-call retry, but nothing trips open after sustained failures — a degraded upstream (Claude/Groq/Unipile/BrightData all erroring) still gets hit on every single request. A minimal circuit breaker (open after N consecutive failures within a window, half-open retry after a cooldown) is purely additive: under normal conditions (the common case) it's a no-op passthrough.

- [ ] **Step 1: Write the failing test** — `server/src/lib/circuitBreaker.test.ts`:
```typescript
/**
 * Run: cd server && npx ts-node src/lib/circuitBreaker.test.ts
 */
import assert from "node:assert";
import { CircuitBreaker } from "./circuitBreaker";

async function test1_passesThroughOnSuccess() {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  const result = await cb.call(() => Promise.resolve("ok"));
  assert.strictEqual(result, "ok");
}

async function test2_opensAfterThresholdFailures() {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => cb.call(() => Promise.reject(new Error("upstream down"))));
  }
  // 4th call should be rejected immediately by the OPEN breaker, not attempt the upstream at all
  let upstreamCalled = false;
  await assert.rejects(
    () => cb.call(() => { upstreamCalled = true; return Promise.resolve("should not run"); }),
    /circuit breaker is open/i
  );
  assert.strictEqual(upstreamCalled, false, "breaker must short-circuit without calling the upstream function");
}

async function test3_halfOpensAfterCooldownAndCloses() {
  const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 50 });
  await assert.rejects(() => cb.call(() => Promise.reject(new Error("fail"))));
  await assert.rejects(() => cb.call(() => Promise.reject(new Error("fail"))));
  await new Promise((resolve) => setTimeout(resolve, 60));
  const result = await cb.call(() => Promise.resolve("recovered"));
  assert.strictEqual(result, "recovered");
}

async function main() {
  const tests = [test1_passesThroughOnSuccess, test2_opensAfterThresholdFailures, test3_halfOpensAfterCooldownAndCloses];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`, err);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```
- [ ] **Step 2: Run it, confirm it fails** (module doesn't exist).
- [ ] **Step 3: Implement** `server/src/lib/circuitBreaker.ts`:
```typescript
/** Minimal per-instance circuit breaker: after `failureThreshold` consecutive
 * failures, short-circuits further calls for `cooldownMs` instead of hitting
 * the upstream at all, then allows one probe call through (half-open) --
 * closing again on success, re-opening on failure. Intended for one
 * long-lived instance per third-party dependency (Claude, Groq, ...), not a
 * new instance per call. Transparent under normal conditions: a healthy
 * upstream never trips it. */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: BreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt < this.options.cooldownMs) {
        throw new Error("circuit breaker is open -- upstream has failed repeatedly, refusing to call it again yet");
      }
      this.state = "HALF_OPEN";
    }

    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      this.state = "CLOSED";
      return result;
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.options.failureThreshold) {
        this.state = "OPEN";
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}
```
- [ ] **Step 4: Run the test again, confirm it passes.**
- [ ] **Step 5: Wrap the Claude call.** Read `server/src/drafting/claudeClient.ts` in full first to find the exact `chat()` method body and its existing `retryWithBackoff` usage, then wrap that call site with a module-level `CircuitBreaker` instance (e.g. `failureThreshold: 5, cooldownMs: 30_000`), calling `breaker.call(() => retryWithBackoff(...))` so retries still happen normally within an open window, but a truly dead upstream stops being hammered.
- [ ] **Step 6: Wrap the Groq call.** Grep `server/src` for where `config.groqApiKey` is actually used to make an API call (likely in a `groqClient.ts` or inline in `processInboundMessage.ts`/reply classification code) and apply the same pattern.
- [ ] **Step 7:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 8:** Run existing drafting/FAQ tests to confirm no regression under normal (non-failing) conditions.
- [ ] **Step 9:** Commit: `git add server/src/lib/circuitBreaker.ts server/src/lib/circuitBreaker.test.ts server/src/drafting/claudeClient.ts <groq client file> && git commit -m "feat: circuit breaker around Claude/Groq calls to stop hammering a dead upstream"`

---

### Task 9: `List-Unsubscribe` headers on outbound email

**Files:**
- Modify: `server/src/services/unipile.service.ts` (`sendEmail`, ~lines 751-830)

**Context:** `sendEmail`'s payload has no `List-Unsubscribe`/`List-Unsubscribe-Post` header, which Gmail/Yahoo increasingly require for bulk senders and which materially helps deliverability. This only adds headers — `to`/`from`/`subject`/`body` are untouched.

- [ ] **Step 1:** Read `server/src/services/unipile.service.ts`'s `sendEmail` method in full (lines ~751-830) to see the exact shape of the payload object sent to Unipile's API and confirm whether Unipile's send API accepts a `headers` or `custom_headers` field (check any existing comments/types referencing Unipile's email-send schema, or their docs reference if linked in this file).
- [ ] **Step 2:** Add a `List-Unsubscribe` header pointing at a mailto or a real unsubscribe endpoint. If no unsubscribe landing endpoint exists yet, use the mailto form only (`List-Unsubscribe: <mailto:unsubscribe@yourdomain>`), which needs no new server route — confirm the sending domain/address to use from `config.ts` or existing outreach-domain configuration before hardcoding one.
- [ ] **Step 3:** Add `List-Unsubscribe-Post: List-Unsubscribe=One-Click` alongside it (required by Gmail/Yahoo for the header to count).
- [ ] **Step 4:** If Unipile's send API does NOT support custom headers (confirm via Step 1), stop here and report this as CANNOT-IMPLEMENT-AS-SCOPED in the task report — this would need a different email-sending path, out of scope for this plan.
- [ ] **Step 5:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 6:** Run existing outreach/email-queue send tests to confirm the rest of the payload is unchanged.
- [ ] **Step 7:** Commit: `git add server/src/services/unipile.service.ts && git commit -m "feat: add List-Unsubscribe headers to outbound email"`

---

### Task 10: Clean up orphaned scraped-data output files (Python)

**Files:**
- Modify: `enrichment_pipeline/main.py` (the `output/duplicate_review_queue.json` and results-file writes, ~lines 77-105)

**Context:** `main.py`'s CLI/batch path writes full scraped-profile JSON (including candidate PII) to `output/duplicate_review_queue.json` and a results file, and never deletes them. This only matters for the CLI/batch entrypoint (`main.py`'s `--serve` FastAPI path returns results over HTTP and doesn't write these files at all, per the earlier audit) — confirm that scoping before touching anything.

- [ ] **Step 1:** Read `enrichment_pipeline/main.py` lines ~1-120 in full to see exactly which code path writes these files (CLI batch mode vs. the FastAPI `--serve` mode) and confirm whether these output files are actually consumed downstream by anything else (e.g., manually reviewed by an operator, or read by another script) before deleting them automatically.
- [ ] **Step 2:** If they're purely transient (no other reader), add a cleanup step after the batch run completes successfully — e.g. delete the results file once its contents have been returned/logged, or move to a `retention_days`-based cleanup if an operator does need to review them shortly after a run. **Do not delete on failure paths** — a failed run's output is exactly what you'd want to keep for debugging.
- [ ] **Step 3:** If Step 1 reveals these files ARE actively used by a human review workflow (the filename `duplicate_review_queue.json` suggests this is plausible), do NOT blind-delete them — instead, propose a time-based retention cleanup (e.g., delete files older than 7 days on each run's startup) rather than deleting them immediately, and note this change in the task report so the user can confirm the retention window before it ships.
- [ ] **Step 4:** Run the Python test suite for `main.py`/orchestrator if one covers this path (check `enrichment_pipeline/tests/` for a relevant file) to confirm no regression.
- [ ] **Step 5:** Commit: `git add enrichment_pipeline/main.py && git commit -m "fix: clean up orphaned scraped-profile output files"`

---

### Task 11: Shared-secret auth between the Node enrichment job and the Python service

**Files:**
- Modify: `server/src/config.ts` (new required env var)
- Modify: `server/src/jobs/enrichment.job.ts:88-122` (add header)
- Modify: `enrichment_pipeline/config.py` (new config field)
- Modify: `enrichment_pipeline/main.py:239-269` (add auth dependency to `/enrich` and `/enrich/batch`, NOT `/health`)

**Context:** User-approved despite the deployment coordination requirement. `enrichment.job.ts` calls the Python service's `/enrich` with zero authentication; the Python side accepts any caller. Adding a shared secret closes a real cost-abuse hole (arbitrary parties triggering paid BrightData/Tavily/Claude calls). **`/health` must stay unauthenticated** — Render's platform health check hits it with no credentials, and breaking that would take the service permanently "not live."

- [ ] **Step 1:** In `server/src/config.ts`, add a new required field near `enrichmentServiceUrl` (line 57), following the existing `requireEnv` pattern used for `unipileWebhookSecret`:
```typescript
  // Shared secret proving a call to the enrichment service actually came
  // from this server, not an arbitrary caller who found the URL -- the
  // service has no other authentication and every call triggers real,
  // paid BrightData/Tavily/Claude usage.
  enrichmentServiceSharedSecret: requireEnv("ENRICHMENT_SERVICE_SHARED_SECRET"),
```
- [ ] **Step 2:** In `server/.env.example`, add `ENRICHMENT_SERVICE_SHARED_SECRET=your_shared_secret_here` near the `ENRICHMENT_SERVICE_URL` line.
- [ ] **Step 3:** In `server/src/jobs/enrichment.job.ts`, find the `axios.post(`${config.enrichmentServiceUrl}/enrich`, {...}, { timeout, signal })` call (~line 90) and add a headers option:
```typescript
        axios.post(
          `${config.enrichmentServiceUrl}/enrich`,
          { /* existing body unchanged */ },
          { timeout: 4_200_000, signal, headers: { "X-Enrichment-Shared-Secret": config.enrichmentServiceSharedSecret } }
        ),
```
(Read the exact current object structure first — the body fields and the second options object — to make sure the `headers` key merges into the existing options object rather than replacing it.) Also check `enrichment.job.ts` for a second call site if `/enrich/batch` is ever invoked from Node (grep the file for `/enrich/batch`) and apply the same header there.
- [ ] **Step 4:** In `enrichment_pipeline/config.py`, read `load_config()`'s full body first (not just the dataclass fields shown earlier), then add a new required field `enrichment_service_shared_secret: str` to the `Config` dataclass and load it the same way `brightdata_api_key` etc. are loaded (raising `ConfigError` when `require_keys=True` and it's missing, matching the existing pattern).
- [ ] **Step 5:** In `enrichment_pipeline/main.py`, add a FastAPI dependency that checks the `X-Enrichment-Shared-Secret` header against `config.enrichment_service_shared_secret`, using `secrets.compare_digest` (Python's constant-time comparison, mirroring Task 2's `safeCompare` on the Node side) rather than `==`:
```python
from fastapi import Depends, Header
import secrets

def verify_shared_secret(x_enrichment_shared_secret: str = Header(default="")):
    if not secrets.compare_digest(x_enrichment_shared_secret, config.enrichment_service_shared_secret):
        raise HTTPException(status_code=401, detail="Invalid or missing shared secret")
```
Then add `dependencies=[Depends(verify_shared_secret)]` to the `@app.post("/enrich", ...)` and `@app.post("/enrich/batch", ...)` route decorators — explicitly leave `/` and `/health` untouched (no auth dependency), since the platform's own health check must keep working with zero credentials.
- [ ] **Step 6:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 7:** Manually verify locally (both services running with the same `ENRICHMENT_SERVICE_SHARED_SECRET` set): confirm `/health` still returns 200 with no header, `/enrich` returns 401 with no/wrong header, and `/enrich` succeeds with the correct header — this task's core behavior can't be proven by the existing DB-hitting test convention alone, since it's a live two-service integration; do this as a manual check and report the result in the task report rather than skipping verification.
- [ ] **Step 8:** Commit: `git add server/src/config.ts server/.env.example server/src/jobs/enrichment.job.ts enrichment_pipeline/config.py enrichment_pipeline/main.py enrichment_pipeline/.env.example && git commit -m "feat: require shared-secret auth between Node and the enrichment service"`
- [ ] **Step 9:** **Do not deploy until the user has set `ENRICHMENT_SERVICE_SHARED_SECRET` to the same value on both the server and enrichment_pipeline deployments** — flag this explicitly and loudly in the final report; a mismatched or missing value on either side means every enrichment call starts failing.

---

### Task 12: `npm audit fix` for the server's moderate dependency findings

**Files:**
- Modify: `server/package.json`, `server/package-lock.json`

**Context:** `npm audit` in `server/` shows 3 moderate findings (qs/body-parser/express — array-limit bypass and a DoS via `isBuffer`), all with a fix available via `npm audit fix` (patch/minor bump, not a breaking major version change).

- [ ] **Step 1:** Run `cd server && npm audit` to confirm the current findings match what's expected (3 moderate, all fixable).
- [ ] **Step 2:** Run `cd server && npm audit fix` (not `--force`, which can pull in breaking major versions).
- [ ] **Step 3:** Run `cd server && npm audit` again to confirm the 3 moderate findings are gone and nothing new appeared.
- [ ] **Step 4:** Run `cd server && npx tsc --noEmit` — clean.
- [ ] **Step 5:** Run the full existing server test suite (every `*.test.ts` file under `server/src`) to confirm the dependency bump didn't break anything at runtime — this is the one task in this plan touching third-party code Express itself depends on, so this check matters more than usual.
- [ ] **Step 6:** Commit: `git add server/package.json server/package-lock.json && git commit -m "chore: npm audit fix — resolve 3 moderate findings in qs/body-parser/express"`

---

## Explicitly deferred (not in this plan)

- **Owner self-escalation fix** (`POST /api/auth/profile`) — Critical severity, deferred per user decision on 2026-09-18.
- **JWT `algorithms` allowlist** on `jwtVerify` — needs the actual signing algorithm confirmed against a real Neon Auth token first; guessing wrong would break all authentication. Recommend as a fast follow-up once confirmed.
- **Lead PATCH `flags`/`fieldSources` race condition** (`lead.routes.ts`, the read-then-merge-then-write pattern before the `$transaction` at line 915) — real, but fixing it correctly requires either moving the read inside the transaction or adding optimistic-concurrency versioning, both of which are more invasive than "safe hygiene." Recommend as its own small dedicated task once scoped properly.
- All business-logic findings from the audit: DNC enforcement at send time, enrichment-status gate, duplicate-detection gate, stage-transition state machine, per-recruiter send/draft caps, contractor-assignment ownership scoping, `GET /api/leads` field-level identity exposure, bounce/complaint webhook handling, on-demand GDPR deletion endpoint.
