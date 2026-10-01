# Task 5 Report: Create FAQ Manager Component

## File Created

`client/src/components/dashboard/faq-manager.tsx` (new file, 163 lines)

The `client/src/components/dashboard/` directory did not previously exist and was created.

## Sub-components Implemented

| Component | Export | Purpose |
|---|---|---|
| `FaqManager` | named export | Main container. Fetches FAQs via React Query (`queryKey: ["faqs"]`), renders the list, owns create/update/delete mutations and the `isCreating` / `editingId` UI state. |
| `CreateFaqForm` | module-local | Category / Question / Answer inputs. Submit disabled until all three are non-empty. Keywords are auto-generated server-side, so no tags field here. |
| `EditFaqForm` | module-local | Pre-populated from the FAQ row, plus a comma-separated Keywords field that splits/trims into `tags[]`. |

Behavior implemented per spec:
- List of active FAQs with category, question, answer, and tag pills
- Create with auto-generated keywords (toast reflects `response.keywordsGenerated`)
- Edit all four fields including keyword refinement
- Delete (soft delete server-side) via `api.deleteFaq`
- React Query cache invalidation on every mutation success
- `sonner` toasts for success and error paths on all three mutations
- Loading state (`Loading FAQs...`) and per-button pending states ("Creating..." / "Saving...")

## TypeScript Compilation Status

`npx tsc --noEmit` reports **zero errors in `faq-manager.tsx`**.

`npm run build` (`vite build`) **succeeds** — built in 832ms, no errors.

Nine pre-existing type errors remain elsewhere in the client and are unrelated to this task:
- `src/components/features/client-demand-dialog.tsx` (2)
- `src/components/features/contractor-add-lead-dialog.tsx` (2)
- `src/components/features/conversations-page-view.tsx` (1)
- `src/lib/api.ts` (4) — missing `ApiReportsAnalytics` / `ApiRecentReport` types

The `api.ts` errors were verified to predate the FAQ work (present at commit `9b81c8b`, before Task 4).

## Deviations from the Plan Code

Two minimal changes from the plan snippet, both required for a clean compile; no behavior change:

1. Dropped the unused `useEffect` from the React import. The plan imported it but never used it.
2. Annotated the `EditFaqForm` `onSubmit` callback parameter as `(data: any)` in the `FaqManager` JSX. `EditFaqForm` has `any`-typed props, so the parameter had no contextual type.

## Integration Notes for Task 6

- Import as a named export: `import { FaqManager } from "@/components/dashboard/faq-manager";`
- The component takes **no props** and renders its own `<h2>Manage FAQs</h2>` heading, so the parent should not add a duplicate title.
- Root element is `<div className="space-y-6">` with no outer card/border. Wrap it in whatever section chrome the dashboard uses.
- It self-manages data fetching, so it needs to be mounted inside the app's existing `QueryClientProvider`, and a `sonner` `<Toaster />` must be present for toasts to appear (already used elsewhere in the app, e.g. `owner.leads.tsx`).
- The owner-only gate is Task 6's responsibility — this component does no role checking.
- Note the app uses TanStack Router with a generated `routeTree.gen.ts`; adding a new route file will regenerate it.

## BLOCKER for runtime testing — bug in Task 4's `api.ts`

Two API paths in `client/src/lib/api.ts` use **backslashes instead of forward slashes**, which JavaScript interprets as escape sequences:

- Line 475 (`checkFaq`): `request("\api\faq\check", ...)` → resolves to the string `afaqcheck` (the `\a`, `\f`, `\c` escapes collapse; `\f` becomes a literal form-feed character)
- Line 506 (`deleteFaq`): `` request(`\api\faq\${id}`, ...) `` → resolves to `afaq\x0c<id>`

These compile fine but **fail at runtime**. `deleteFaq` is called directly by this component, so the Delete button will not work until this is fixed. `listFaqs`, `getFaq`, `createFaq`, and `updateFaq` use correct forward-slash paths and are unaffected.

The fix belongs to Task 4's file and was left untouched per the "no refactoring" constraint. It should be corrected to `"/api/faq/check"` and `` `/api/faq/${id}` `` before browser verification of delete.

## Commit

Single commit, `feature/faq-auto-response` branch:

```
feat(client): create FAQ manager component for owner dashboard

- Display all active FAQs in editable list
- Create new FAQ with auto-keyword generation
- Edit existing FAQs (category, question, answer, keywords)
- Delete FAQs with confirmation
- Real-time UI updates via React Query
- Toast notifications for user feedback

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

Only `client/src/components/dashboard/faq-manager.tsx` was staged. The pre-existing
working-tree changes (`client/src/routeTree.gen.ts`, `server/verify_faq.sql`) were left uncommitted.

---

## Review Round 1 — Three Important Findings Fixed

Commit `167c545` — `fix(faq-manager): add delete confirmation, field validation, empty-tag filtering`

**Finding 1 — no delete confirmation.** Delete is now gated behind a `confirm()` dialog, and the
button is `disabled={deleteMutation.isPending}` with a "Deleting..." label so a double-click cannot
fire two requests. Used `confirm()` rather than the Radix `AlertDialog` to match the established
codebase pattern for soft deletes (`owner.recruiters.tsx:348,531`,
`recruiter-language-mapping-dialog.tsx:248`), including the "history is preserved" wording.

**Finding 2 — no EditFaqForm validation.** Added `isValid` matching CreateFaqForm's rule; Save is
now `disabled={isLoading || !isValid}`.

**Finding 3 — empty-string tags persisted.** Fixed, but *not* via the suggested `.filter(Boolean)`
on the input's `onChange`. That fix has a bug: the field is controlled through
`split → filter → join`, so filtering on every keystroke deletes the comma the moment the user
types it, making a multi-keyword list impossible to enter. Instead the raw text is held in a
`tagsText` string state and split/trimmed/filtered once in `handleSubmit`. Clearing the field now
yields `[]`, never `[""]`, and typing still works. Tag display also filters empty strings
(`faq.tags.filter(Boolean)`) to hide any already in the DB.

Also fixed the minor `htmlFor`/`id` pairing on the keywords label. The static id is safe because
`editingId` allows only one EditFaqForm open at a time. Left the `any` types and the redundant
fragment alone — flagged non-blocking, and changing them is out of scope for this task.

**Verification:** `npx tsc --noEmit` reports zero errors in `faq-manager.tsx`; `npm run build`
passes. Behavior was verified by reading the control flow, not by driving the browser — see the
`api.ts` blocker above, which still prevents an end-to-end delete test.
