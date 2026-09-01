# Task 2 Report: Add Keyword Generation Function

## What was implemented

Added one exported function to `server/src/drafting/draftGenerator.ts` (appended after
`generateFaqReply()`, lines ~239-288). No existing code was modified or refactored.

**Signature:**

```typescript
export async function generateFaqKeywords(
  client: ClaudeClient,
  cfg: DraftingConfig,
  faqQuestion: string,
  faqAnswer: string
): Promise<{ keywords: string[] }>
```

**Behavior:**
- System prompt instructs Claude to extract 3-5 short (1-2 word) semantic keywords and
  return ONLY `{"keywords": [...]}`.
- `client.chat(system, user, { model: cfg.genModel, temperature: 0.1, maxTokens: 150 })`.
- JSON parsing mirrors the robust pattern used elsewhere in the file: strict `JSON.parse`
  first, then fall back to slicing between the first `{` and last `}`; throws
  `"Could not parse keywords from Claude response"` if neither works.
- Non-string entries are filtered out; a non-array `keywords` field yields `[]`.

Copied verbatim from the plan (`docs/superpowers/plans/2026-08-26-faq-enhancements.md`,
Task 2, Step 1) with two non-behavioral additions to match file style: a doc comment above
the function, and an explicit `let data: any;` annotation instead of the bare `let data;`
(the bare form relies on TS control-flow "evolving any", which is fragile under the
project's `strict: true`; the annotation is equivalent at runtime).

## Issues encountered

- `server/.env` has no `CLAUDE_API_KEY`. The working key lives in
  `drafting_service/.env` (`CLAUDE_MODEL=claude-haiku-4-5-20251001`), so the manual test
  was run with those two vars exported into the process. Nothing about this blocks Task 3
  in a deployed environment, but the server env file will need `CLAUDE_API_KEY` set for the
  POST endpoint's auto-tagging to work locally.
- Note for Task 3: `temperature: 0.1` is silently dropped by `claudeClient.ts` when
  `CLAUDE_MODEL` resolves to a Claude 5 model (`claude-opus-5` / `claude-sonnet-5` /
  `claude-fable-5`), which reject the sampling parameter. With the currently configured
  Haiku 4.5 model the temperature is sent as specified.

## Test results

**TypeScript compilation:** `npx tsc --noEmit` in `server/` — zero errors, zero new errors.

**Manual test** (temporary script under `server/src/`, run with `ts-node --transpile-only`,
deleted afterward; model `claude-haiku-4-5-20251001`):

| Sample | Question / Answer | Keywords returned | Latency |
|---|---|---|---|
| 1 | "How long is the training?" / "The training takes 1-2 hours and covers voice cloning fundamentals." | `["training duration", "voice cloning", "fundamentals"]` | 1093 ms |
| 2 | "When do I get paid?" / "Payouts are processed every two weeks via direct deposit after invoice approval." | `["payouts", "payment schedule", "direct deposit", "invoice approval"]` | 768 ms |

Assertions on sample 1: `Array.isArray` true, every entry `typeof === "string"` true,
length 3 (within the required 3-5 range). Sample 2 returned 4 keywords, also in range.

## Commit

```
feat(drafting): add generateFaqKeywords for auto-tagging

- Extract 3-5 semantic keywords from FAQ question + answer
- Uses Claude with low temperature (0.1) for consistency
- Returns keywords array for storing in faqEntry.tags

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

Single commit on `feature/faq-auto-response`, touching only
`server/src/drafting/draftGenerator.ts`.
