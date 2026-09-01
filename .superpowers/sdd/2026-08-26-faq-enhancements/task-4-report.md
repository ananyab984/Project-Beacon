# Task 4 Report: Add FAQ CRUD Methods to API Client

**Status:** Complete
**File modified:** `client/src/lib/api.ts` (only file touched)

## Interfaces Added

Added and exported above the `api` object literal, under a new `// -------------------- FAQ types --------------------` header:

- `FaqEntry` — `id`, `category`, `question`, `answer`, `tags: string[]`, `isActive`, `createdAt`, `updatedAt` (all required)
- `CreateFaqInput` — `category`, `question`, `answer` (all required)
- `UpdateFaqInput` — `category?`, `question?`, `answer?`, `tags?`, `isActive?` (all optional)

All three are `export interface`, so Tasks 5+ can `import type { FaqEntry, CreateFaqInput, UpdateFaqInput } from "@/lib/api"`.

## Methods Added

Appended to the existing `// -------------------- FAQ --------------------` section of the `api` object, after the pre-existing `checkFaq`:

| Method | HTTP | Path | Returns |
| --- | --- | --- | --- |
| `listFaqs()` | GET | `/api/faq` | `{ faqEntries: FaqEntry[] }` |
| `getFaq(id)` | GET | `/api/faq/${id}` | `{ faqEntry: FaqEntry }` |
| `createFaq(data)` | POST | `/api/faq` | `{ faqEntry: FaqEntry; keywordsGenerated: boolean }` |
| `updateFaq(id, data)` | PATCH | `/api/faq/${id}` | `{ faqEntry: FaqEntry }` |
| `deleteFaq(id)` | DELETE | `/api/faq/${id}` | `{ success: boolean }` |

All five use the file's existing `request()` wrapper (which attaches the Neon Auth bearer token, prefixes `VITE_API_BASE_URL`, and normalizes errors into `ApiRequestError`). Each carries a one-line JSDoc comment matching the style of neighbouring methods such as `checkFaq` and the Unipile group.

Note: `api` in this file is an exported **object literal**, not a `class` as the plan's "Produces" sketch showed. The methods were added as object members to match the file's actual structure; signatures are identical to the spec.

## TypeScript Compilation Status

- `npm run build` in `client/` — **passes** (Vite/Nitro build completed, `built in 2.99s`).
- `npx tsc --noEmit -p tsconfig.json` — no errors from any FAQ code. Nine errors exist in the repo, all **pre-existing and unrelated**:
  - `src/components/features/client-demand-dialog.tsx` (2)
  - `src/components/features/contractor-add-lead-dialog.tsx` (2)
  - `src/components/features/conversations-page-view.tsx` (1)
  - `src/lib/api.ts` (4) — `Cannot find name 'ApiReportsAnalytics'` / `'ApiRecentReport'` in the Reports & Analytics methods. These types are defined in `client/src/lib/api-types.ts` but were never added to the import block at the top of `api.ts`. This predates Task 4 and was left untouched per the "do not refactor existing code" constraint.

## Verification of Importability / Signatures

A temporary probe file (`client/src/__faq_typecheck_tmp.ts`, since deleted) imported `api` plus all three interfaces and called every method, assigning `keywordsGenerated` to a `boolean` and `success` to a `boolean` and building a `FaqEntry[]` from the four entry-returning responses. `tsc --noEmit` produced zero FAQ-related diagnostics, confirming the interfaces are importable and the method signatures resolve as specified.

## Commit

Single commit, staging only `client/src/lib/api.ts`:

```
feat(api): add FAQ CRUD client methods

- listFaqs: fetch all active FAQs
- getFaq: fetch single FAQ by id
- createFaq: create FAQ (owner only), auto-generates keywords
- updateFaq: update FAQ fields (owner only)
- deleteFaq: soft delete FAQ (owner only)
- Add TypeScript interfaces for FaqEntry and inputs

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

Branch: `feature/faq-auto-response`

## Re-review Note: Reported Backslash Bug Not Reproducible

A review flagged `checkFaq` (~line 475) and `deleteFaq` (~line 506) as containing Windows-style backslash paths (`"\api\faq\check"`, `` `\api\faq\${id}` ``) that would 404 at runtime. **This is a false positive — no such characters exist in the file.**

Evidence, run against both the working tree and the committed blob at `780d019`:

```
$ grep -c -F '\' client/src/lib/api.ts
1
$ grep -n -F '\' client/src/lib/api.ts
29:const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
```

The single backslash in the whole file is on line 29, inside the pre-existing trailing-slash-stripping regex — unrelated to FAQ and correct as written.

`git show HEAD:client/src/lib/api.ts | grep -n 'api.faq' | cat -A` (with `cat -A` rendering literal bytes) confirms all six FAQ paths use forward slashes:

```
475:    return request("/api/faq/check", { method: "POST", ... });$
480:    return request("/api/faq");$
485:    return request(`/api/faq/${id}`);$
490:    return request("/api/faq", {$
498:    return request(`/api/faq/${id}`, {$
506:    return request(`/api/faq/${id}`, { method: "DELETE" });$
```

No edit was made and no fix commit was created, since there is no defect to correct. `git diff client/src/lib/api.ts` is empty — the working tree matches `780d019`. Task 4 stands as originally delivered.
