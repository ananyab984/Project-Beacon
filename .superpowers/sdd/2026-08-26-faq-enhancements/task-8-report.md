# Task 8: Final Integration & Testing — Report

**Date:** 2026-08-26
**Branch:** `feature/faq-auto-response` @ `ae736a3`
**Base:** `main` @ `3452f5e`

## Scope note

This is a static integration-verification pass. The environment cannot run Postgres
(Neon), the Vite dev server, or reach the Anthropic API, so no live end-to-end click-through
was performed. What *was* done instead: full TypeScript compilation of both packages, a
real production build of the client, a differential baseline against `main` to prove no
regressions, and a line-by-line trace of every integration seam (route → API client →
component). Manual test steps are in the checklist at the bottom.

---

## 1. Services start without errors

| Check | Result |
| --- | --- |
| `server/` — `npx tsc --noEmit` (same compiler as `npm run build`) | **PASS**, exit 0, zero errors |
| `client/` — `npx vite build` (same as `npm run build`) | **PASS**, built in 1.30s, no errors |
| `client/` — `npx tsc --noEmit` | 9 errors — **all 9 pre-existing on `main`** (see §7) |
| Prisma client generated with `FaqEntry` | **PASS** — `prisma.faqEntry` delegate present in `server/node_modules/.prisma/client/index.d.ts` |
| `faqRouter` mounted | **PASS** — `server/src/index.ts:21` imports, `:87` mounts at `/api/faq` |

Drafting is **in-process**, not a separate service. Commit `17d488f` folded the Python
`drafting_service/` into `server/src/drafting/` as TypeScript. `faq.routes.ts` calls
`generateFaqReply` / `generateFaqKeywords` directly via `loadDraftingConfig()` +
`new ClaudeClient(...)`. No separate `uvicorn` process is needed for the FAQ feature.

> The `drafting_service/*.py` changes in commit `f7f18f2` are now **dead code** for this
> feature — the live path is the TS port. Harmless, but they are not what runs.

---

## 2. FAQ Dashboard (owner only)

All code verified in place.

**Owner gating** — `client/src/routes/owner.index.tsx:219-224`:

```tsx
{user?.role === "owner" && (
  <div className="border-t pt-6">
    <FaqManager />
  </div>
)}
```

Frontend gating is cosmetic only; the real enforcement is server-side (§5).

**`client/src/components/dashboard/faq-manager.tsx`** (190 lines) — verified:

- **Create** — `CreateFaqForm` posts `{category, question, answer}`. Submit disabled until
  all three are non-empty. `tags` is deliberately *not* sent; the server generates it.
  Success toast reads `FAQ created with auto-generated keywords` when
  `keywordsGenerated` is true, and plain `FAQ created` when it is false — so the
  operator can tell auto-tagging actually ran.
- **Edit** — `EditFaqForm` seeds from the existing row and exposes a comma-separated
  keywords input (`faq-keywords`, properly `htmlFor`-labelled). Tags are held as raw text
  while typing and only `split(",").map(trim).filter(Boolean)` on submit, so a trailing
  comma cannot write an empty tag.
- **Delete** — native `confirm()` guard whose text explicitly says
  *"this is a soft delete, not a permanent removal"*. Button disables and reads
  `Deleting...` while the mutation is in flight.
- **Persistence across refresh** — react-query `queryKey: ["faqs"]`, invalidated on every
  successful create/update/delete. Data is server-sourced on mount, so a refresh re-fetches
  from Neon. No local-only state.

---

## 3. LinkedIn "Check FAQ" button

`client/src/components/features/conversations-page-view.tsx`

- Import `checkFaqAndAutofill` — line 23
- Loading state `isCheckingFaq` — line 71
- Handler `handleCheckFaq` — line 120, passes `lastLeadMessage?.text` and `setDraft`
- Button — lines 428-433: `disabled={isCheckingFaq}`, swaps
  `<Loader2 className="animate-spin" />` for `<MessageCircleQuestion />` and the label for
  `Checking…` while in flight. **Loading state confirmed.**

---

## 4. Email "Check FAQ" button

`client/src/components/features/email-queue-page-view.tsx`

- Sources the candidate's latest message from a `["email-replies", selected?.leadId]` query
  that **shares its key with `<EmailRepliesSection />`**, so react-query dedupes the two —
  no duplicate network call. Picks the last `sender === "THEM"` message (lines 88-91).
- Autofill callback (lines 92-97) calls `setBody(draft)` **then `markDirty()`** — autosave
  is correctly triggered, matching the manual-typing path at line 436.
  `markDirty` is a hoisted `function` declaration at line 248, so the line-95 call site
  above its definition is valid.
- Button — lines 386-395. Adds `disabled={... || !lastCandidateEmail}` (stricter than
  LinkedIn's) plus a `title` tooltip explaining *why* it is disabled.

**Both buttons share one implementation** — `client/src/lib/faq.ts` — so LinkedIn and email
behavior cannot drift apart. Good factoring.

---

## 5. Error scenarios

| Scenario | Handling | Verified at |
| --- | --- | --- |
| Empty / missing candidate message | Client short-circuits before any network call: `toast.error("No reply from the candidate yet to check")` | `client/src/lib/faq.ts:17-20` |
| Empty message reaches server anyway | `400 MISSING_LEAD_MESSAGE` | `faq.routes.ts:25-27` |
| No matching FAQ | `{match: false}` → `toast.info("No confident FAQ match for this reply")` | `faq.routes.ts:46-48`, `faq.ts:29` |
| Claude timeout / API failure on check | `502 FAQ_GENERATION_FAILED` → `toast.error("Drafting service unavailable — check the FAQ manually")` | `faq.routes.ts:58-63`, `faq.ts:32-34` |
| Claude failure during **create** | Caught and swallowed — FAQ still created with `tags: []` and `keywordsGenerated: false`. A Claude outage never blocks FAQ authoring. | `faq.routes.ts:130-138` |
| Non-owner creates/updates/deletes | `403 FORBIDDEN_INSUFFICIENT_ROLE` via `requireRole("owner")` on POST/PATCH/DELETE | `faq.routes.ts:124, 158, 173` |
| Unauthenticated | `401 UNAUTHORIZED` — `faqRouter.use(authenticateJwt)` applies to every route | `faq.routes.ts:14` |

**Error-shape wiring confirmed end-to-end.** `client/src/lib/api.ts:48-51` sets both
`err.status` and `err.code` on the thrown `ApiRequestError`, which is exactly what the
`err?.status === 502` branch in `faq.ts:32` reads. The chain is sound.

Note the read routes (`GET /` and `GET /:id`) are intentionally **not** owner-gated — any
authenticated user can read FAQs, which recruiters need. Only mutations are owner-only.
`POST /check` is likewise open to all authenticated users, as required.

---

## 6. Database

**Schema** — `server/prisma/schema.prisma:926-938`, `FaqEntry` → `@@map("faq_entries")`,
with `tags String[] @default([])`, `isActive Boolean @map("is_active")`, `@@index([isActive])`.

**Migration** — `server/prisma/migrations/20260825000000_add_faq_entries/migration.sql`
creates the table, enables `pg_trgm`, adds a `search_vector tsvector GENERATED ALWAYS AS
(to_tsvector('english', question || ' ' || answer)) STORED` column, and builds two GIN
indexes (`search_vector`, and `question gin_trgm_ops`). Both indexes are exactly what the
`/check` query in `faq.routes.ts:29-41` needs — the query will use them, not seq-scan.

**Soft delete confirmed** — `faq.routes.ts:178` is `prisma.faqEntry.update({data: {isActive: false}})`.
There is **no `prisma.faqEntry.delete` call anywhere in the codebase**. `GET /` filters
`where: {isActive: true}`, so soft-deleted rows vanish from the UI while the row persists.

**Seed** — `server/prisma/seed.ts` carries 14 FAQ entries. Run `npm run seed` in `server/`.

**Verification helper** — `server/verify_faq.sql` (committed) holds two ready SQL checks.

### Caveat: `search_vector` is invisible to Prisma

The generated column exists only in the migration SQL, not in `schema.prisma`. Prisma will
therefore report **schema drift** and `prisma migrate dev` / `prisma db push` may offer to
**drop `search_vector` and both GIN indexes** — which would break `/api/faq/check` at
runtime while still typechecking. Use `prisma migrate deploy` in production, and never
accept a drift-reset on this table without re-applying the tail of
`20260825000000_add_faq_entries/migration.sql`. Worth a comment in the schema before merge.

---

## 7. Regression check vs `main`

To rule out that the FAQ work introduced the client type errors, `main` was checked out into
a scratch worktree and typechecked with the same toolchain.

**`main` baseline — 9 errors. `feature/faq-auto-response` — the same 9 errors**, identical
files and messages, differing only in line numbers (shifted by the inserted FAQ code):

- `client-demand-dialog.tsx` (203, 383) — 2
- `contractor-add-lead-dialog.tsx` (228, 229) — 2
- `conversations-page-view.tsx` — 1 (`Row` `v` prop typed `string`, given `Element`; from
  the enrichment work in `733c850`, at line 463 on main → 487 here, **not** an FAQ line)
- `api.ts` — 4 (`ApiReportsAnalytics` / `ApiRecentReport` used but never imported from
  `api-types.ts`, where both are exported; identical on main at lines 420-425)

**The FAQ branch introduces zero new TypeScript errors.** None of the 9 sit in FAQ code.
`vite build` does not run `tsc`, so none of them block the build either. They are
pre-existing debt, out of scope for this task.

---

## 8. Issues found

**None blocking.** Three things to be aware of:

1. **`CLAUDE_API_KEY` is missing from both `server/.env.example` and the local `server/.env`.**
   `server/src/config.ts:58` reads `process.env.CLAUDE_API_KEY || ""`. Without it, the
   feature degrades *gracefully* rather than crashing — `/api/faq/check` returns 502 and the
   user sees the "Drafting service unavailable" toast, and FAQ creation succeeds with empty
   tags — but **auto-tagging and FAQ phrasing will silently not work** during manual testing,
   and a tester could easily mistake this for a code defect. Add `CLAUDE_API_KEY=` (and
   optionally `CLAUDE_MODEL=haiku`) to `.env.example`, and set a real key in `.env` before
   testing. *This is the single most important prerequisite for §Manual Testing below.*

2. **Stale `DRAFTING_SERVICE_URL` in `.env.example`.** Drafting is in-process now; the var is
   vestigial and may mislead an operator into starting a service that isn't used.

3. **Prisma drift on `search_vector`** — see §6 caveat. Operational footgun, not a code bug.

Minor / non-blocking: `faq-manager.tsx` uses `any` on the sub-form props and mutation
payloads (loses type safety the API client already provides), and uses native `confirm()`
rather than the project's dialog components — inconsistent with the rest of the UI, though
functionally correct. `id` in `faq.routes.ts:142` uses the deprecated `String.substr`, and
overrides the model's own `@default(uuid())` for no clear reason. All cosmetic.

Also note `.superpowers/` and `docs/` are **untracked** — the SDD ledger, task reports, and
the plan are not committed. `client/src/routeTree.gen.ts` shows as modified but the diff is
line-endings only (LF→CRLF), no content change.

---

## Manual testing checklist

**Prerequisites**

- [ ] Add `CLAUDE_API_KEY=<real key>` to `server/.env` — *without this, steps marked ⚠ will fail*
- [ ] `cd server && npx prisma migrate deploy` (**deploy**, not `dev` — see §6 caveat)
- [ ] `cd server && npm run seed` (loads 14 FAQ entries)
- [ ] `cd server && npm run dev` → expect no startup errors
- [ ] `cd client && npm run dev` → serves on **port 8002** (per `vite dev --port 8002`)
- [ ] Log in as an **owner**

**Dashboard CRUD**

- [ ] `/owner/` → "Manage FAQs" section renders below the roster
- [ ] Log in as a **recruiter** → section is absent
- [ ] "Add FAQ" → verify Create button stays disabled until all 3 fields are filled
- [ ] Create one ⚠ → toast should say *"FAQ created **with auto-generated keywords**"*.
      If it says only "FAQ created", `CLAUDE_API_KEY` is missing or Claude failed
- [ ] New FAQ shows blue keyword chips
- [ ] Edit → keywords field pre-filled comma-separated; change one, Save, verify it persists
- [ ] Delete → confirm dialog mentions soft delete; cancel does nothing; accept removes it from list
- [ ] Hard refresh → surviving FAQs still present, deleted one still gone

**LinkedIn Check FAQ**

- [ ] Open a LinkedIn conversation where the candidate has replied
- [ ] Click "Check FAQ" → button shows spinner + "Checking…" ⚠
- [ ] On match: compose box autofills, toast names the matched question. **Confirm nothing was sent**
- [ ] On a candidate message unrelated to any FAQ: toast *"No confident FAQ match for this reply"*
- [ ] Open a conversation with **no** candidate reply → toast *"No reply from the candidate yet to check"*

**Email Check FAQ**

- [ ] Open an email queue item with a candidate reply → "Check FAQ" enabled
- [ ] Open one with no reply → button **disabled**, tooltip explains why
- [ ] Click on a replied item ⚠ → body autofills; **wait for the autosave indicator** (this
      is the `markDirty()` path and the main thing Task 7 added)
- [ ] Navigate away and back → autofilled draft persisted

**Errors**

- [ ] Temporarily set `CLAUDE_API_KEY=bad` and restart server → Check FAQ shows
      *"Drafting service unavailable — check the FAQ manually"*
- [ ] With the bad key, create an FAQ → **still succeeds**, toast omits "with auto-generated
      keywords", chips are empty. Restore the real key afterward
- [ ] As a recruiter, `curl -X POST /api/faq` with a recruiter JWT → **403 FORBIDDEN_INSUFFICIENT_ROLE**
- [ ] `curl -X POST /api/faq/check -d '{"leadMessage":""}'` → **400 MISSING_LEAD_MESSAGE**

**Database**

- [ ] `psql $DATABASE_URL -f server/verify_faq.sql` → row count and sample rows
- [ ] `SELECT tags FROM faq_entries WHERE question = '<your new FAQ>';` → non-empty array ⚠
- [ ] Delete via dashboard, then
      `SELECT id, is_active FROM faq_entries WHERE id='<id>';` → **row exists, `is_active = false`**
- [ ] `SELECT search_vector IS NOT NULL FROM faq_entries LIMIT 1;` → `t` (confirms the
      generated column survived migration)

---

## Recommendation

**Ready for final code review and merge**, conditional on two small pre-merge items:

1. Add `CLAUDE_API_KEY` to `server/.env.example` (and drop or comment the stale
   `DRAFTING_SERVICE_URL`). One-line change; without it the feature looks broken to anyone
   setting up fresh.
2. Add a comment in `schema.prisma` above `model FaqEntry` warning that `search_vector` and
   the GIN indexes live only in the migration and must not be dropped by a drift reset.

Neither is a code defect and neither blocks review. Everything else checks out: both
packages compile, the client builds, the branch adds **zero** new type errors against
`main`, all three seams (route → API client → component) are correctly wired including the
error-shape contract, owner-gating is enforced server-side and not merely hidden in the UI,
delete is genuinely soft, and both Check FAQ buttons share one implementation so they cannot
diverge.

The one thing this report **cannot** vouch for is live runtime behavior — the match
thresholds in particular. `faq.routes.ts:44-46` carries an explicit author note that
`rank < 0.15 && sim < 0.3` is uncalibrated. Expect to tune those against real candidate
messages after the first production exposure; treat early false-negatives ("No confident
match" on questions that clearly are FAQs) as threshold tuning, not as a bug.
