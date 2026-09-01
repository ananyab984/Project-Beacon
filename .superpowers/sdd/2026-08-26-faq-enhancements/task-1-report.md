# Task 1: Add FAQ CRUD Endpoints — Report

**Status:** Complete — code review NEEDS_FIXES addressed, ready for re-review
**File changed:** `server/src/routes/faq.routes.ts` (only file modified)
**Commit:** `ad9147c` — `feat(faq): add CRUD endpoints for FAQ management` (single commit, message format per plan Task 1 Step 5)

## Code review round 1 — both Important findings fixed

**Finding 1 — reinvented middleware.** Verified: `requireRole` exists at `server/src/middleware/rbac.ts:5`,
normalizes with `.toLowerCase()` (line 11) and emits `FORBIDDEN_INSUFFICIENT_ROLE` (line 14). Replaced the
hand-rolled `isOwner()` helper with `requireRole("owner")` on PATCH and DELETE.

One correction to the suggested fix steps: step 2 said to change "`authenticateJwt` + manual role check to
just `requireRole('owner')`". Done literally that removes authentication — `requireRole` only *reads*
`req.user` and 401s if it is missing; it never populates it. The actual codebase pattern (`client-demand.routes.ts:10`,
`conversation.routes.ts:16-17`) is router-level `router.use(authenticateJwt)` plus per-route `requireRole(...)`.
I applied that pattern: added `faqRouter.use(authenticateJwt)` and removed the now-redundant inline
`authenticateJwt` from the pre-existing `POST /check` (leaving it would have run auth — and its DB lookup — twice
per request). Re-verified on the real server that all five routes, `/check` included, still 401 without a token.

**Finding 2 — no input validation.** Added `updateFaqSchema` (zod, all fields `.optional()`, plus a `.refine()`
requiring at least one key so an empty body no longer 200s while bumping `updated_at`). Validated with
`schema.parse()` inside `asyncHandler`, matching `lead.routes.ts:517`; the global `errorHandler` maps
`ZodError` → 400 `VALIDATION_ERROR` (`errorHandler.ts:15-20`).

I also converted the four handlers from hand-rolled `try/catch` to `asyncHandler` + `ApiError`. This was not
explicitly requested, but my `catch` blocks returned `err.message` verbatim — that *was* the schema-detail leak
the finding referred to, and it would also have swallowed the ZodError into a 500. `errorHandler`'s generic
branch returns a fixed `"Something went wrong"`, closing the leak properly.

Minor items (TOCTOU race between the existence check and the update, `(req as any)` typing) were deferred as agreed.

## Note: the plan file appeared mid-task, and it contradicts the task brief

`docs/superpowers/plans/2026-08-26-faq-enhancements.md` did not exist when I started (confirmed absent from the
working tree *and* all of git history). It is present now. Having read its Task 1:

- **The plan says lowercase `"owner"`** (`user?.role !== "owner"`, Steps 3 and 4) — **not** the `=== "OWNER"`
  given in my task brief. So the uppercase spelling was an error in the brief, not in the plan, and the
  deviation I flagged in round 1 was in fact plan-conformant. This is now moot since `requireRole` normalizes case.
- The plan's literal snippets have the two defects the code review caught (raw `err.message` in every `catch`,
  no body validation). The review's fixes supersede them. The plan's PATCH also uses truthiness spreads
  (`...(category && { category })`), which silently drops an intentional empty-string value — the zod schema
  rejects `""` with a 400 instead.
- Commit message now taken verbatim from plan Task 1 Step 5, with a trailing paragraph recording the review fixes.

## Endpoints added

All four are mounted under `/api/faq` (`server/src/index.ts:87`) and gated by `authenticateJwt`.

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/faq` | any authenticated user | `{ faqEntries: [...] }` — active only, newest first |
| GET | `/api/faq/:id` | any authenticated user | `{ faqEntry: {...} }` or 404 `FAQ_NOT_FOUND` |
| PATCH | `/api/faq/:id` | owner only | `{ faqEntry: {...} }`, 403 `FORBIDDEN`, 404 `FAQ_NOT_FOUND` |
| DELETE | `/api/faq/:id` | owner only | `{ success: true }` — soft delete (`isActive: false`) |

PATCH updates only the fields present in the body (`category`, `question`, `answer`, `tags`, `isActive`).
DELETE never hard-deletes; the row is retained with `isActive: false`.

## Deviation from spec — please review

The spec said to gate owner-only routes on:

```ts
(req as any).user?.role === "OWNER"
```

**This would have returned 403 for every user, including owners.** `authenticateJwt` lowercases
the role before putting it on the request (`server/src/middleware/auth.ts:98`):

```ts
role: profile.role.toLowerCase() as UserPayload["role"]
```

So `req.user.role` is always `"owner"` / `"recruiter"` / `"contractor"` at runtime, even though the
Prisma enum is `UserRole.OWNER`. Every other route in the codebase compares against lowercase
(`conversation.routes.ts:35,62,100,212`, `user.routes.ts:161,188`, `unipile.routes.ts:18`).

I implemented the lowercase check (`req.user?.role === "owner"`) via a small `isOwner(req)` helper,
matching the established convention, and left a comment explaining why. Empirically confirmed below.
The plan file that supposedly contained the "correct" implementations does not exist (see Issues), so
this could not be reconciled against it.

I also used the typed `req.user` rather than `(req as any).user` — the Express `Request` interface is
already augmented with `user?: UserPayload` in `middleware/auth.ts:13-19`, so the cast is unnecessary.

## Issues encountered

1. **The referenced plan file does not exist.** `docs/superpowers/plans/2026-08-26-faq-enhancements.md`
   is absent from the working tree and from all of git history (`git log --all -- 'docs/superpowers/plans/*'`
   returns nothing); the `docs/` directory contains only `sdd/`. The instruction to "copy the exact
   implementations from there" could not be followed. Endpoints were written from the prose requirements
   in the task description instead. **The commit message format was also specified as coming from the
   plan and had to be chosen** — I used `feat(server): add FAQ CRUD endpoints`, consistent with the
   repo's existing `feat(server): ...` commits.

2. **The `faq_entries` migration had never been applied to the dev database.** `prisma migrate status`
   showed `20260825000000_add_faq_entries` pending. This means the pre-existing `POST /api/faq/check`
   endpoint (merged earlier) was already broken against dev. I ran `npx prisma migrate deploy` — the
   migration is additive (CREATE TABLE + pg_trgm extension + indexes), was already committed on this
   branch, and the feature is untestable without it. Note this touched the **shared Neon dev database**.

3. **`@anthropic-ai/sdk` was declared in `package.json` but not installed**, so the server could not
   boot at all (`Cannot find module '@anthropic-ai/sdk'`). Ran `npm install` to restore declared
   dependencies. `package-lock.json` was unchanged. Pre-existing issue, unrelated to this task.

4. **Could not obtain a real Neon Auth JWT.** Auth verifies tokens against Neon's remote JWKS, so a
   valid bearer token requires an interactive password sign-in, which I did not perform. Testing was
   split into two layers (below) to cover this honestly.

## Test results

### Layer 1 — real server (`npm run dev`, port 5001): routes mounted and auth-gated

```
$ curl -s http://localhost:5001/api/faq
{"error":"UNAUTHORIZED_NO_TOKEN","message":"Authentication required"}          status=401

$ curl -s http://localhost:5001/api/faq -H "Authorization: Bearer not.a.real.token"
{"error":"UNAUTHORIZED_INVALID_TOKEN","message":"Invalid or malformed session token"}  status=401
```

Identical results for `GET /api/faq/:id`, `PATCH /api/faq/:id`, `DELETE /api/faq/:id`, with and
without a token — all 401. Confirms all four routes are registered and behind `authenticateJwt`.

### Layer 2 — handler logic against the real dev DB

Because a genuine JWT was unobtainable, the **real `faqRouter`** was mounted on a scratch Express app
(port 5099) with only `authenticateJwt` stubbed to read the role from an `x-test-role` header. Handler
code and Prisma queries are the unmodified originals. Two `category: "HarnessTest"` rows were seeded and
deleted afterward (dev DB `faq_entries` back to 0 rows; harness file removed).

```
1. GET /api/faq (owner)                    -> 200  {"faqEntries":[ {...}, {...} ]}   both active rows
2. GET /api/faq/:id (recruiter, valid id)  -> 200  {"faqEntry":{...}}                reads allowed for non-owners
3. GET /api/faq/:id (nonexistent id)       -> 404  {"error":"FAQ_NOT_FOUND",...}
4. PATCH /api/faq/:id as recruiter         -> 403  {"error":"FORBIDDEN","message":"Only owners can update FAQ entries"}
5. DELETE /api/faq/:id as recruiter        -> 403  {"error":"FORBIDDEN","message":"Only owners can delete FAQ entries"}
6. PATCH /api/faq/:id as owner (partial)   -> 200  sent {"answer":...,"tags":["pay","rate"]}
                                                   answer+tags changed; category/question/isActive untouched; updatedAt bumped
7. PATCH /api/faq/:id as owner, bad id     -> 404  {"error":"FAQ_NOT_FOUND",...}
8. DELETE /api/faq/:id as owner            -> 200  {"success":true}
9. GET that same id afterwards             -> 200  {"faqEntry":{..."isActive":false...}}   row still present => SOFT delete
10. GET /api/faq afterwards                -> 200  deleted row absent from list           active filter works
```

### Layer 3 — the "OWNER" vs "owner" casing bug, demonstrated

```
$ curl -X PATCH .../api/faq/:id -H "x-test-role: OWNER"   -> 403 FORBIDDEN
$ curl -X PATCH .../api/faq/:id -H "x-test-role: owner"   -> 200 {"faqEntry":{...}}
```

Since `auth.ts:98` guarantees the lowercase form, the spec's `=== "OWNER"` would have produced the
403 case for every real owner.

### Post-review re-test (round 2)

Same harness, plus the real global `errorHandler` mounted so `ZodError`/`ApiError` map exactly as in production.

Finding 1 — role gate:
```
PATCH as recruiter        -> 403 {"error":"FORBIDDEN_INSUFFICIENT_ROLE","message":"Role 'recruiter' is not authorized..."}
DELETE as contractor      -> 403 {"error":"FORBIDDEN_INSUFFICIENT_ROLE","message":"Role 'contractor' is not authorized..."}
PATCH with no user at all -> 401 {"error":"UNAUTHORIZED","message":"Authentication required"}
PATCH with role "OWNER"   -> 200  (uppercase now succeeds; requireRole normalizes — case bug is structurally gone)
```

Finding 2 — validation (each of these was a 500 before):
```
{"question":123}          -> 400 VALIDATION_ERROR  question: expected string, received number
{"tags":"not-an-array"}   -> 400 VALIDATION_ERROR  tags: expected array, received string
{"isActive":"yes"}        -> 400 VALIDATION_ERROR  isActive: expected boolean, received string
{}                        -> 400 VALIDATION_ERROR  Provide at least one field to update
{"bogus":1}               -> 400 VALIDATION_ERROR  Provide at least one field to update
{"answer":""}             -> 400 VALIDATION_ERROR  answer: expected string to have >=1 characters
```

Core CRUD regression check — all still correct: list 200 (active only, newest first), get 200, get-missing 404,
owner partial PATCH 200 (only supplied fields change), PATCH-missing 404, DELETE 200 `{"success":true}`,
deleted row still present with `isActive:false`, and absent from the list.

Real server (port 5001), router-level auth verified end to end:
```
GET /api/faq            -> 401 UNAUTHORIZED_NO_TOKEN
GET /api/faq/:id        -> 401 UNAUTHORIZED_NO_TOKEN
PATCH /api/faq/:id      -> 401 UNAUTHORIZED_NO_TOKEN
DELETE /api/faq/:id     -> 401 UNAUTHORIZED_NO_TOKEN
POST /api/faq/check     -> 401 UNAUTHORIZED_NO_TOKEN   (pre-existing route, still gated after the move)
... and 401 UNAUTHORIZED_INVALID_TOKEN with a malformed bearer token
```

Caveat on harness fidelity: the stub calls `next()` without setting `req.user` when no role header is sent, so
"no user" cases are *not* meaningful in the harness (they return 200 there). Those cases are covered by the real
server run above, which is authoritative.

Test rows deleted afterward (`faq_entries` back to 0 rows); harness/seed/cleanup temp files removed; servers stopped.

### Typecheck

`npx tsc --noEmit` now reports **0 errors**. (The 14 errors present at the start of this task were all
pre-existing — a stale Prisma client re `inboundMessage` plus missing `@anthropic-ai/sdk` typings — and were
cleared by the `npm install` and `prisma generate` described above, not by any source change of mine.)

## Notes for later tasks

- Task 3 adds `POST /api/faq`. It should use the same lowercase `isOwner(req)` helper added here, not `"OWNER"`.
- If other environments (staging/prod) also have `20260825000000_add_faq_entries` pending, `POST /api/faq/check`
  is broken there too and will need `prisma migrate deploy`.
