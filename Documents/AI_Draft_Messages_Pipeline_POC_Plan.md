# AI Draft Messages Pipeline — POC Implementation Plan

**Project:** Global3 Recruitment CRM
**Feature:** AI-generated outreach drafts (LinkedIn + Email), personalized per lead
**Provider (POC):** Groq API (OpenAI-compatible), provider-abstracted for later swap
**Scope decisions locked in:**
- **Style:** Personalize *within* the existing templates — keep exact structure, links, and sign-off; the model tailors the opening and phrasing per lead.
- **Channels:** Both — Email (long-form) and LinkedIn (short-form).
- **Stack:** TanStack Start (React 19) + Nitro `cloudflare-module` preset. Groq call runs **server-side** in a `createServerFn`; the key never reaches the browser.

---

## 1. Current state (what we're replacing)

Both draft surfaces already exist and today call **hardcoded template functions**:

| Surface | Route | Component | Current generator |
|---|---|---|---|
| Email queue | `recruiter.email-queue` | `src/components/g3/email-queue-page-view.tsx` | `generateEmailDraft(name, language)` — long-form + subject |
| Conversations | `recruiter.conversations` | `src/components/g3/conversations-page-view.tsx` | `generateLinkedInDraft(name, language)` — short, char-limited |

- Both template strings already match the two pasted formats almost verbatim (global3.io, `app.global3.io/apply`, `resources@global3.io`, "Resources Team" sign-off).
- "Generate Draft" buttons + editors + autosave already wired. **We are not building new UI — we are replacing the generator behind the button.**
- Personalization context is available: each `EmailQueueItem` / `Conversation` carries `lead_id` → `RecruiterLead` with `first_name`, `target_language`, `source_language`, `country_of_residence`, `services`, `years_of_exp`, `source`, `profile_link`.
- AI feature flag already exists: `FEATURES.ai` (`src/lib/feature-flags.ts`) + `useAiToolsEnabled` (`src/hooks/use-ai-tools.ts`). The POC gates behind this and **falls back to the existing hardcoded template** when the flag is off or the API errors.

---

## 2. Target architecture

```
Recruiter clicks "Generate Draft"
  │
  ▼  (client, react-query mutation)
useGenerateDraft({ channel, leadId })
  │
  ▼  createServerFn  ── runs in the Cloudflare Worker, key stays server-side
generateDraft.server.ts
  ├─ resolve lead context (POC: from mock store passed in / by id)
  ├─ build channel-specific prompt (system + user, brand constants + lead vars)
  ├─ POST https://api.groq.com/openai/v1/chat/completions   (GROQ_API_KEY from env)
  ├─ parse JSON response  →  { subject?, body }
  ├─ guardrails: enforce required links, length cap, strip invented claims
  └─ return { subject?, body, model, ms }
  │
  ▼
UI fills subject/body editor → recruiter edits → Send (mock toast)
```

**Why a server function (not a direct client fetch):** the Groq key is a secret. A client-side call would ship it in the browser bundle. `createServerFn` (already available in the installed `@tanstack/react-start`) executes only in the Worker.

---

## 3. Files to add / change

### New
| File | Purpose |
|---|---|
| `client/.dev.vars` | Local secret: `GROQ_API_KEY=gsk_...` (already gitignored ✓). Loaded by Nitro/wrangler dev. |
| `client/src/lib/ai/groq.ts` | Thin, provider-abstracted chat client over `fetch` (no SDK — safest on Worker runtime). Reads key from env, returns raw completion. |
| `client/src/lib/ai/prompts.ts` | Brand constants + `buildEmailPrompt(lead)` / `buildLinkedInPrompt(lead)`. The template *skeleton* lives here so output stays on-brand. |
| `client/src/lib/ai/draft.server.ts` | `generateDraft = createServerFn(...)` — orchestrates prompt → Groq → guardrails → typed result. Zod-validate the JSON. |
| `client/src/hooks/use-generate-draft.ts` | react-query `useMutation` wrapper (loading/error state for the button). |

### Changed
| File | Change |
|---|---|
| `email-queue-page-view.tsx` | `handleGenerateDraft` → async: call `useGenerateDraft`, show spinner on the button, set subject+body from result, `markDirty()`. On flag-off/error → fall back to `generateEmailDraft` + toast. |
| `conversations-page-view.tsx` | `handleGenerateLinkedInDraft` → async equivalent; set `draft` from result; fallback to `generateLinkedInDraft`. |
| (keep) both `generate*Draft` functions | Retained as the deterministic fallback + the prompt's structural reference. |

---

## 4. Secret handling (Cloudflare / Nitro `cloudflare-module`)

- **Local dev:** `client/.dev.vars` → `GROQ_API_KEY=...`. Read inside the server function via `process.env.GROQ_API_KEY` (Nitro's cloudflare-module preset maps bindings/`.dev.vars` onto `process.env` in the Worker). *Verify on first run with a log; if the preset exposes it via the request `env` binding instead, read it from the server-fn context.*
- **Production:** `wrangler secret put GROQ_API_KEY` (never commit). Same `process.env` read at runtime.
- **Never** use a `VITE_`-prefixed var for the key — those are inlined into the client bundle.

---

## 5. Prompt design (personalize-within-template)

**Brand constants** (in `prompts.ts`): company `Global3`, site `global3.io`, apply portal `https://app.global3.io/apply`, contact `resources@global3.io`, email sign-off `Resources Team`.

**Model inputs per lead:** `first_name`, `target_language` (falls back to role), `country_of_residence`, `services`, `years_of_exp`, `source`. Explicit rule: **use only these facts; invent nothing.**

**System prompt (shared):** "You are Global3's outreach assistant writing to freelance linguists. Personalize the opening line using ONLY the provided facts. Preserve the template's structure, required links, and sign-off exactly. Never invent achievements, projects, or credentials. Return strict JSON."

**Email channel** — return `{ "subject": string, "body": string }`:
- Warm, professional, long-form; open with a personalized line referencing their language/country/service.
- Must include: mission mention + `global3.io`, apply portal link, `resources@global3.io`, "Best regards, Resources Team".
- Length target ~120–180 words.

**LinkedIn channel** — return `{ "body": string }`:
- Short, direct, character-conscious (**≤ 600 chars**), no subject.
- Must include: "freelance Native [language]", `global3.io`, apply link.

**Model settings:** `model: llama-3.3-70b-versatile` (quality) — swap to `llama-3.1-8b-instant` if latency matters; `temperature: 0.5`; `response_format: { type: "json_object" }`. *Confirm the exact current Groq model ID at build time.*

---

## 6. Guardrails / post-processing (the "pipeline" part)

After the model returns, before handing to the UI:
1. **Zod-validate** the JSON shape (`{subject?, body}`); on parse failure → fallback template.
2. **Required-link enforcement:** if `app.global3.io/apply` or `global3.io` missing, append the canonical line rather than trust the model.
3. **Length cap:** LinkedIn hard-truncate/regenerate if > 600 chars.
4. **Sign-off check (email):** ensure "Resources Team" present.
5. **Fact-leak guard (light, POC):** the prompt forbids invented claims; log the raw output for spot-checking. (A stricter validator can come post-POC.)
6. **Fallback everywhere:** any error/timeout → deterministic `generate*Draft` + a toast noting AI was unavailable. The recruiter is never blocked.

---

## 7. Build phases

**Phase 0 — Plumbing (round-trip proof)**
- Add `.dev.vars`, `groq.ts`, and a `generateDraft` server fn that returns a canned string. Wire the email button to it. Confirm client → Worker → back works and the key is readable server-side. *Gate: no key in the browser bundle.*

**Phase 1 — Real email generation**
- Implement `buildEmailPrompt` + real Groq call + zod parse + guardrails. Personalize from lead context. Verify subject+body populate and autosave fires.

**Phase 2 — LinkedIn channel**
- `buildLinkedInPrompt`, char-cap guardrail, wire `conversations-page-view.tsx`.

**Phase 3 — UX polish**
- Button spinner + disabled state during generation; "Regenerate" affordance; show real "AI" badge only when the draft actually came from the model; error-fallback toast; latency/model shown in a subtle caption (nice for a demo).

**Phase 4 — Optional (post-POC, note only)**
- Multiple variants (generate 2–3, recruiter picks); tone selector (formal/warm); persist generated drafts into the mock store; per-recruiter rate limiting; streaming tokens.

---

## 8. Testing / demo checklist

- [ ] `bun run dev` (port 8002) — server fn reachable, `.dev.vars` picked up.
- [ ] Toggle `FEATURES.ai` off → button still works via template fallback.
- [ ] Toggle on → email draft is personalized, on-brand, links intact.
- [ ] LinkedIn draft ≤ 600 chars, includes apply link.
- [ ] Kill the key / force an error → graceful fallback + toast, no crash.
- [ ] Inspect built client bundle → **no `GROQ_API_KEY` string present.**
- [ ] Deploy: `wrangler secret put GROQ_API_KEY`, verify in preview.

---

## 9. Open items to confirm before/at build

1. **Env access mechanism** — confirm `process.env.GROQ_API_KEY` resolves inside the server fn under the `cloudflare-module` preset (vs. reading from the request `env` binding). Verified with a one-line log in Phase 0.
2. **Groq model ID** — confirm current recommended model (`llama-3.3-70b-versatile` assumed).
3. **Lead context passing** — POC can pass the selected lead's fields from the client to the server fn (simplest), or resolve by `lead_id` server-side once a real DB exists. POC: pass fields.
