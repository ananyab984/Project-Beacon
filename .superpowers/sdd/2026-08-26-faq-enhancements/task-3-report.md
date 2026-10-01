# Task 3: Add POST /api/faq Endpoint with Auto-Tagging — Report

**Status:** Complete
**File changed:** `server/src/routes/faq.routes.ts` (only file modified)
**Commit:** `a59a78f` — `feat(faq): add POST /api/faq with auto-keyword generation` (single commit, message verbatim from plan Task 3 Step 5)

## Endpoint

| Method | Path | Auth | Success | Failure |
|---|---|---|---|---|
| POST | `/api/faq` | owner only | `201 { faqEntry, keywordsGenerated }` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN_INSUFFICIENT_ROLE` |

Located in `server/src/routes/faq.routes.ts`, between the `createFaqSchema`/`updateFaqSchema`
declarations and the `PATCH /:id` handler. Registered on the router that `server/src/index.ts:87`
mounts at `/api/faq`, under the router-level `faqRouter.use(authenticateJwt)` added by Task 1.

Behavior, per plan:
1. `requireRole("owner")` gate (Task 1's middleware, not a hand-rolled check).
2. Keywords via `generateFaqKeywords(client, draftingConfig, question, answer)` from Task 2, wrapped
   in try/catch — on throw the FAQ is still created with `tags: []` and `keywordsGenerated: false`,
   and the failure is logged with `console.warn`. `keywordsGenerated` is `tags.length > 0`, so an
   empty-but-successful generation also reports `false`.
3. ID generated as `faq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`.
4. Created with the generated `tags` and `isActive: true`.

## Deviations from the plan's literal snippet (both per the task brief's integration notes)

1. **`requireRole("owner")` + `asyncHandler` instead of the plan's inline role check and try/catch.**
   The plan snippet re-applies `authenticateJwt` inline (now redundant — Task 1 moved it to the
   router) and hand-rolls `user?.role !== "owner"` returning `error: "FORBIDDEN"`. Using the
   middleware makes the code match PATCH/DELETE and gives the same `FORBIDDEN_INSUFFICIENT_ROLE`
   code as the rest of the app; it also normalizes role casing. The outer `try/catch` returning
   `err.message` verbatim was replaced with `asyncHandler`, matching Task 1's fix for the same
   schema-detail leak (the global `errorHandler` returns a fixed `"Something went wrong"` on 500).
   The inner try/catch around keyword generation is unchanged and still swallows failures.

2. **Zod validation was added** (the brief's optional-but-recommended item). `createFaqSchema` —
   `category`, `question`, `answer` all `z.string().min(1)`, no `.optional()`, following Task 1's
   `updateFaqSchema` pattern. `errorHandler.ts:15-20` maps `ZodError` → `400 VALIDATION_ERROR`, so
   missing fields return 400 rather than the plan's `MISSING_FIELDS` shape (same status, different
   `error` string) — and empty strings and wrong types now 400 too, which the plan's `!category`
   truthiness check would have half-caught (`""`) and half-missed (`123` would have reached Prisma).
   `tags` is deliberately not in the schema: it is auto-generated, and a client-sent `tags` is ignored
   (verified below).

No existing function was refactored; nothing beyond the endpoint was added.

## Test results

`npx tsc --noEmit` in `server/` — **0 errors**, no new errors.

End-to-end testing against the real server is still blocked by the same issue Task 1 hit: auth
verifies bearer tokens against Neon's remote JWKS, so a valid token needs an interactive sign-in.
Same two-layer approach as Task 1.

### Layer 1 — real server (`npm run dev`, port 5001)

```
POST /api/faq  (no token)                       -> 401
POST /api/faq  (Bearer not.a.real.token)        -> 401
```
Confirms the route is registered and sits behind `authenticateJwt`.

### Layer 2 — real `faqRouter` + real `errorHandler`, only `authenticateJwt` stubbed

Temporary harness on port 5099 (role read from an `x-test-role` header); handler code, zod schema,
`requireRole`, `errorHandler` and Prisma calls are the unmodified originals. Run twice — once with no
`CLAUDE_API_KEY` (server/.env as it stands today) and once with the key + model exported from
`drafting_service/.env` (`claude-haiku-4-5-20251001`).

**With `CLAUDE_API_KEY` present:**
```
201  owner, valid body               tags=["training duration","voice cloning","setup time"]  isActive=true  keywordsGenerated=true
403  recruiter                       {"error":"FORBIDDEN_INSUFFICIENT_ROLE","message":"Role 'recruiter' is not authorized..."}
403  contractor                      {"error":"FORBIDDEN_INSUFFICIENT_ROLE","message":"Role 'contractor' is not authorized..."}
401  no user at all                  {"error":"UNAUTHORIZED","message":"Authentication required"}
400  missing answer                  VALIDATION_ERROR  answer: expected string, received undefined
400  missing question+answer         VALIDATION_ERROR  question: ...; answer: ...
400  empty body {}                   VALIDATION_ERROR  category/question/answer all reported
400  category: ""                    VALIDATION_ERROR  category: Too small: expected string to have >=1 characters
400  category: 123                   VALIDATION_ERROR  category: expected string, received number
201  body includes tags:["injected"] tags=["general","information","support"]   <- client tags ignored, generated tags win
201  x-test-role: OWNER (uppercase)  keywordsGenerated=true                     <- requireRole normalizes case
```

**Without `CLAUDE_API_KEY` (graceful-failure path):**
```
201  owner, valid body               tags=[]  isActive=true  keywordsGenerated=false
```
Server log: `[faqRouter] Keyword generation failed, creating FAQ without tags: Claude call failed
after 4 attempts: Could not resolve authentication method...` — FAQ still created, as required. All
403/401/400 cases identical to the run above.

ID format confirmed on every 201 (`faq_1787745370118_qbjj4zxl4`). All 6 rows created across the two
runs were deleted afterward (`category = "HarnessT3"` count back to 0 on the shared Neon dev DB);
harness file removed; servers/jobs stopped.

## Notes for later tasks

- **`CLAUDE_API_KEY` is still absent from `server/.env`** (it lives only in `drafting_service/.env`).
  Until it is added, every POST from the running server will return `keywordsGenerated: false` with
  empty `tags`. Not a code defect — the try/catch is doing its job — but Task 5's UI should not
  present `keywordsGenerated: false` as an error.
- **Latency on the failure path:** `claudeClient` retries 4 times with exponential backoff, so a POST
  with a missing/invalid key takes roughly **28 seconds** before returning 201. Correct per spec (FAQ
  still created), but a client with a short HTTP timeout will look like it failed. Worth a look if the
  UI in Task 5/6 shows a spinner.

## Commit message

```
feat(faq): add POST /api/faq with auto-keyword generation

- Only owners can create FAQs
- Automatically extracts 3-5 keywords using Claude
- Gracefully handles keyword generation failures (FAQ still created)
- Returns keywordsGenerated flag to indicate success

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```
