# Inbound Reply Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically classify every inbound lead reply into one of a client-defined, owner-editable set of categories, surface the current classification on the lead, and let a recruiter/owner override it manually.

**Architecture:** Event-driven classification plugged into the existing `processInboundMessage.ts` webhook hook. A new `GroqClient` (mirroring `ClaudeClient`'s `chat()` interface) classifies each inbound reply's text against an owner-managed category list stored in a new `ReplyCategory` table. The result is written onto `Lead` as denormalized "current state," with every classification attempt (auto or manual) also logged to an insert-only `ReplyClassificationEvent` history table, following this codebase's existing `StageHistory`/`LeadFlagEvent` pattern.

**Tech Stack:** `groq-sdk` (OpenAI-compatible client for the Groq API), Prisma/PostgreSQL, Express + Zod + the existing `asyncHandler`/`ApiError`/`requireRole` middleware, React/TanStack Query/TanStack Router (client), this project's no-framework `node:assert` test convention (see Global Constraints).

Design spec: [docs/superpowers/specs/2026-09-08-inbound-reply-classification-design.md](../specs/2026-09-08-inbound-reply-classification-design.md)

## Global Constraints

- **Test convention:** this project has **no test runner configured** (no Jest/Vitest — confirmed via `server/package.json`). Every test file is a standalone script using `node:assert`, with a `main()` that runs each `testN_description` function in sequence and calls `process.exit(1)` on any failure. Run with `npx ts-node <file>.test.ts` from `server/`. This exactly matches `server/src/lib/retryWithBackoff.test.ts` and `server/src/__tests__/webhook.test.ts` — every test step in this plan follows that same shape, not `describe`/`it`.
- **Tests hit the real dev database** (the Neon dev instance already configured in `server/.env`), using `test_`-prefixed ids/names and an explicit `cleanup()` function — matching `webhook.test.ts`'s convention — never a mocked Prisma client.
- Classification is per-**lead** (a single current-state field on `Lead`), not per-message.
- The classifier stores **sub-category only** (one of the doc's 33 leaf categories) as `Lead.replyCategoryId`. The 6 top-level groups exist only as `ReplyCategory.groupName`, used for dashboard grouping — never duplicated onto `Lead`.
- Confidence threshold for accepting an auto-classification: **0.65** (matches `semanticFaqSearch.ts`'s proven threshold).
- No language-detection gate on this feature.
- **Override-preservation rule:**
  - A confident new auto-classification (≥ 0.65) always overwrites the Lead's current state, regardless of whether it was `AUTO` or `MANUAL`.
  - A low-confidence/unclassified result only overwrites the Lead if its current `replyClassificationSource` is `AUTO` or `null`. If it's `MANUAL`, the Lead is left untouched.
  - Every classification attempt (confident or not) always writes one `ReplyClassificationEvent`, regardless of whether the Lead itself was updated.
- Scope is **classify & tag only** — no automated routing/notifications this iteration.
- `ReplyCategory` deletion is a hard delete; `Lead.replyCategoryId` and `ReplyClassificationEvent.categoryId` are `onDelete: SetNull`.
- Env vars `GROQ_API_KEY` and `GROQ_MODEL` are already present in `server/.env` (real key) and `server/.env.example` (placeholder) — no task needs to touch either file.
- `GroqClient.chat()` mirrors `ClaudeClient.chat()`'s exact public shape: `chat(system: string, user: string, opts?: ChatOptions): Promise<Completion>`, so any test double for it only needs to implement that one method.
- This codebase returns **flat scalar fields** from `Lead`/`Conversation` queries (no relation objects like `assignedTo: {...}`) — `replyCategoryId` and `replyClassificationSource` follow that same flat-scalar convention; the client resolves a category's display name by matching `replyCategoryId` against the already-fetched `GET /api/reply-categories` list, not via a nested `replyCategory` object.
- Prisma accepts a plain JS `number` for a `Decimal` column on write — never wrap `confidence` in `new Prisma.Decimal(...)` before passing it to `create()`/`update()`.

---

### Task 1: Database Schema — ReplyCategory, ReplyClassificationEvent, Lead columns

**Files:**
- Modify: `server/prisma/schema.prisma`
- Modify: `server/prisma/seed.ts`
- Test: `server/src/lib/__tests__/replyCategorySchema.test.ts`

**Interfaces:**
- Produces: `ReplyCategory` model (`id`, `groupName`, `name` (unique), `description`, `isActive`, `createdAt`, `updatedAt`), `ReplyClassificationEvent` model (`id`, `leadId`, `categoryId`, `confidence`, `source`, `changedByUserId`, `createdAt`), `ClassificationSource` enum (`AUTO`, `MANUAL`), and on `Lead`: `replyCategoryId`, `replyClassificationSource`, `replyClassifiedAt`. Every later task depends on these exact field names and the `ClassificationSource` enum values.

- [ ] **Step 1: Add the `ClassificationSource` enum**

In `server/prisma/schema.prisma`, right after the existing `enum MessageSender { ME THEM }` block (around line 210), add:

```prisma
enum ClassificationSource {
  AUTO
  MANUAL
}
```

- [ ] **Step 2: Add the `ReplyCategory` and `ReplyClassificationEvent` models**

Immediately after the `ContractorAssignment` model and before the `FaqEntry` model (they sit in the same "supporting tables" section of the file), add:

```prisma
// ----------------------------------------------------------------------------
// REPLY CATEGORIES — owner-editable taxonomy for inbound reply classification
// (Inbound_Reply_Classification.docx: 6 groups, 33 sub-categories). Mirrors
// FaqEntry's shape: `groupName` is free text like FaqEntry.category so the
// owner can add/rename groups without a migration; `name` is the actual
// classification value stored on Lead; `description` is both the doc's
// "Description / Trigger" column and the text fed to the classifier prompt.
// ----------------------------------------------------------------------------
model ReplyCategory {
  id          String   @id @default(uuid())
  groupName   String   @map("group_name")
  name        String   @unique
  description String
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  leads  Lead[]
  events ReplyClassificationEvent[]

  @@index([isActive])
  @@map("reply_categories")
}

// ----------------------------------------------------------------------------
// REPLY CLASSIFICATION EVENTS — insert-only audit log, one row per
// classification attempt (auto or manual). Lead.replyCategoryId is the fast
// "current state" read; this table is the source of truth for history,
// mirroring the StageHistory / LeadFlagEvent pattern already used for other
// denormalized Lead fields.
// ----------------------------------------------------------------------------
model ReplyClassificationEvent {
  id              String               @id @default(uuid())
  leadId          String               @map("lead_id")
  lead            Lead                 @relation(fields: [leadId], references: [id], onDelete: Cascade)
  categoryId      String?              @map("category_id")
  category        ReplyCategory?       @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  confidence      Decimal?             @db.Decimal(4, 3)
  source          ClassificationSource
  changedByUserId String?              @map("changed_by_user_id")
  changedBy       User?                @relation(fields: [changedByUserId], references: [id])
  createdAt       DateTime             @default(now()) @map("created_at")

  @@index([leadId])
  @@map("reply_classification_events")
}
```

- [ ] **Step 3: Add the new columns and relation to `Lead`**

In the `Lead` model, immediately after the `justEnrichedUntil` field (right before the `stage` field), add:

```prisma
  replyCategoryId           String?               @map("reply_category_id")
  replyCategory             ReplyCategory?        @relation(fields: [replyCategoryId], references: [id], onDelete: SetNull)
  replyClassificationSource ClassificationSource? @map("reply_classification_source")
  replyClassifiedAt         DateTime?             @map("reply_classified_at")
```

In the same model's `// relations` block (right before `@@index([enrichmentStatus])`), add:

```prisma
  classificationEvents ReplyClassificationEvent[]
```

- [ ] **Step 4: Add the inverse relation to `User`**

In the `User` model, right after `escalationsOwned Escalation[] @relation("EscalationOwner")`, add:

```prisma
  replyClassificationEvents ReplyClassificationEvent[]
```

- [ ] **Step 5: Generate and run the migration**

```bash
cd server
npx prisma migrate dev --name add_reply_classification
```

Expected: migration succeeds against the Neon dev instance in `server/.env`, and `node_modules/.prisma/client` regenerates with the new `ReplyCategory`/`ReplyClassificationEvent` types and the new `Lead`/`User` fields.

- [ ] **Step 6: Add the 33-category seed data**

In `server/prisma/seed.ts`, right after the closing `];` of the existing `FAQ_ENTRIES` array, add:

```ts
const REPLY_CATEGORIES: { groupName: string; name: string; description: string }[] = [
  // Onboarding & Platform Access
  { groupName: "Onboarding & Platform Access", name: "Identity Verification Issue", description: "Veriff failure, document not accepted, unsupported ID type" },
  { groupName: "Onboarding & Platform Access", name: "Manual Verification Request", description: "Candidate requests video call as alternative to Veriff" },
  { groupName: "Onboarding & Platform Access", name: "MSA Query", description: "Signing issues, clause clarification, wrong date, PDF copy request" },
  { groupName: "Onboarding & Platform Access", name: "Login Issue", description: "Password reset, 2FA setup, authenticator app, backup code" },
  { groupName: "Onboarding & Platform Access", name: "Onboarding Link", description: "Link expired, not received, needs to be resent" },
  { groupName: "Onboarding & Platform Access", name: "Payment Details Setup", description: "WISE, PayPal, bank transfer, Payment ID field clarification" },
  { groupName: "Onboarding & Platform Access", name: "Onboarding Status Check", description: "What are the next steps? What stage am I at?" },
  { groupName: "Onboarding & Platform Access", name: "Email Change / Re-registration", description: "Candidate wants to change login email or re-register" },

  // Payment & Invoicing
  { groupName: "Payment & Invoicing", name: "Invoice Submission Query", description: "Submission link, deadline, format, invoice template" },
  { groupName: "Payment & Invoicing", name: "Payment Terms Clarification", description: "Net 30, currency, WISE fees, bank transfer charges" },
  { groupName: "Payment & Invoicing", name: "Tax Form Query", description: "W-8BEN, tax documentation for international freelancers" },
  { groupName: "Payment & Invoicing", name: "Rate Query", description: "RTM rate, hourly rate, per-word rate, premium rate request" },
  { groupName: "Payment & Invoicing", name: "Payment Method Request", description: "Bank transfer, direct ACH, alternative to WISE/PayPal" },

  // Training & Projects
  { groupName: "Training & Projects", name: "Training Materials Not Received", description: "No materials after onboarding completion" },
  { groupName: "Training & Projects", name: "Practice File / Evaluation Query", description: "When will I receive it? Is it paid?" },
  { groupName: "Training & Projects", name: "Feedback Pending on Practice File", description: "No response after submission" },
  { groupName: "Training & Projects", name: "Project Availability Query", description: "When will I get assigned? Any projects available?" },
  { groupName: "Training & Projects", name: "Minimum Volume / Work Guarantee", description: "Candidate asking for guaranteed minimum hours or tasks" },

  // Role & Workflow Clarification
  { groupName: "Role & Workflow Clarification", name: "Dubbing Adaptor Role Confusion", description: "Mistaken for voice-over role; needs clarification on adaptation vs recording" },
  { groupName: "Role & Workflow Clarification", name: "AI Usage / Voice Cloning Concern", description: "Candidate concerned about AI training or voice data usage" },
  { groupName: "Role & Workflow Clarification", name: "Subtitling vs Dubbing Scope", description: "What exactly does each role involve at G3?" },
  { groupName: "Role & Workflow Clarification", name: "AVL vs Document Translation", description: "Candidate from document translation background asking about fit" },
  { groupName: "Role & Workflow Clarification", name: "Portfolio / Confidentiality Query", description: "Can I share completed work? NDA implications?" },

  // Candidate Interest & Application
  { groupName: "Candidate Interest & Application", name: "New Application / CV Submission", description: "Candidate applying or sharing CV directly via email" },
  { groupName: "Candidate Interest & Application", name: "Follow-up – No Response Received", description: "Candidate chasing a previous email with no reply" },
  { groupName: "Candidate Interest & Application", name: "Rate Negotiation", description: "Candidate requesting a higher or premium rate" },
  { groupName: "Candidate Interest & Application", name: "Remove from Mailing List", description: "Candidate requesting to unsubscribe or be removed from database" },
  { groupName: "Candidate Interest & Application", name: "Referral Introduction", description: "Referred by a partner, colleague, or internal team member" },

  // General Queries
  { groupName: "General Queries", name: "Company Legitimacy Concern", description: "Candidate questioning whether G3 is a genuine company" },
  { groupName: "General Queries", name: "Data Privacy / ID Security Concern", description: "Reluctant to share ID; questions about data handling" },
  { groupName: "General Queries", name: "Availability / Capacity Update", description: "Candidate sharing or updating their availability" },
  { groupName: "General Queries", name: "Time Zone / Scheduling Query", description: "Asking about call times, IST/CEST/PST conversions" },
  { groupName: "General Queries", name: "General Interest / LinkedIn Outreach", description: "Broad networking outreach with no specific role in mind" },
];
```

Then, in the `main()` function, right after the existing `for (const f of FAQ_ENTRIES) { ... }` loop, add:

```ts
  for (const c of REPLY_CATEGORIES) {
    await prisma.replyCategory.upsert({
      where: { name: c.name },
      update: { groupName: c.groupName, description: c.description },
      create: c,
    });
    console.log(`Seeded reply category: ${c.name}`);
  }
```

- [ ] **Step 7: Run the seed**

```bash
cd server
npx ts-node prisma/seed.ts
```

Expected: 33 `Seeded reply category: ...` lines, no errors.

- [ ] **Step 8: Write and run a schema smoke test**

Create `server/src/lib/__tests__/replyCategorySchema.test.ts`:

```ts
/**
 * Smoke test for the ReplyCategory / ReplyClassificationEvent schema and the
 * Lead.replyCategoryId / SetNull-on-delete behavior.
 *
 * Run: cd server && npx ts-node src/lib/__tests__/replyCategorySchema.test.ts
 */

import assert from "node:assert";
import { prisma } from "../../prisma";

const TEST_CATEGORY_NAME = "test_Rate Query";

async function cleanup() {
  const lead = await prisma.lead.findFirst({ where: { fullName: "Test Classification Lead" } });
  if (lead) {
    await prisma.replyClassificationEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.replyCategory.deleteMany({ where: { name: TEST_CATEGORY_NAME } });
}

async function test1_seededCategoriesExist() {
  const count = await prisma.replyCategory.count({ where: { isActive: true } });
  assert.ok(count >= 33, `expected at least 33 active reply categories, got ${count}`);
}

async function test2_deletingCategorySetsLeadFieldNull() {
  const category = await prisma.replyCategory.create({
    data: { groupName: "Payment & Invoicing", name: TEST_CATEGORY_NAME, description: "test row" },
  });

  const lead = await prisma.lead.create({
    data: {
      fullName: "Test Classification Lead",
      source: "LINKEDIN",
      replyCategoryId: category.id,
      replyClassificationSource: "AUTO",
      replyClassifiedAt: new Date(),
    },
  });

  await prisma.replyCategory.delete({ where: { id: category.id } });

  const reloaded = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(reloaded?.replyCategoryId, null, "Lead.replyCategoryId must be nulled when its category is deleted");
}

async function test3_classificationEventStoresConfidenceAsPlainNumber() {
  const lead = await prisma.lead.create({
    data: { fullName: "Test Classification Lead", source: "LINKEDIN" },
  });

  const event = await prisma.replyClassificationEvent.create({
    data: { leadId: lead.id, categoryId: null, confidence: 0.42, source: "AUTO" },
  });

  assert.strictEqual(Number(event.confidence), 0.42);
  assert.strictEqual(event.source, "AUTO");

  await prisma.replyClassificationEvent.delete({ where: { id: event.id } });
  await prisma.lead.delete({ where: { id: lead.id } });
}

async function main() {
  const tests = [test1_seededCategoriesExist, test2_deletingCategorySetsLeadFieldNull, test3_classificationEventStoresConfidenceAsPlainNumber];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  await cleanup();
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```

Run: `cd server && npx ts-node src/lib/__tests__/replyCategorySchema.test.ts`
Expected: `All 3 tests passed`.

- [ ] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/seed.ts server/prisma/migrations server/src/lib/__tests__/replyCategorySchema.test.ts
git commit -m "feat: add ReplyCategory/ReplyClassificationEvent schema and seed 33 categories"
```

---

### Task 2: GroqClient

**Files:**
- Create: `server/src/drafting/groqClient.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/drafting/config.ts`
- Test: `server/src/drafting/groqClient.test.ts`

**Interfaces:**
- Consumes: `Completion`, `ChatOptions` types from `server/src/drafting/claudeClient.ts` (already defined: `{ text, model, prompt_tokens, completion_tokens, latency_ms }` and `{ model?, temperature?, jsonMode?, maxTokens? }`); `retryWithBackoff`, `isRetryableByDefault` from `server/src/lib/retryWithBackoff.ts`.
- Produces: `GroqClient` class with `chat(system: string, user: string, opts?: ChatOptions): Promise<Completion>`, `GroqError` class, and `DraftingConfig.groqApiKey: string` / `DraftingConfig.groqModel: string`. Task 3 imports `GroqClient` and `GroqError` from this file.

- [ ] **Step 1: Install the Groq SDK**

```bash
cd server
npm install groq-sdk
```

- [ ] **Step 2: Add `groqApiKey`/`groqModel` to the base config**

In `server/src/config.ts`, right after the `claudeApiKey`/`claudeModel`/... block (after the `retryBackoffBase` line), add:

```ts
  // Groq (inbound reply classification) -- same "empty string, throw at call
  // time" pattern as claudeApiKey: classification-only failure must never
  // block the whole server from booting.
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
```

- [ ] **Step 3: Add `groqApiKey`/`groqModel` to `DraftingConfig`**

In `server/src/drafting/config.ts`, add two fields to the `DraftingConfig` interface:

```ts
export interface DraftingConfig {
  apiKey: string;
  genModel: string;
  genTemperature: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBackoffBase: number;
  groqApiKey: string;
  groqModel: string;
}
```

And in `loadDraftingConfig()`, add the two fields to the returned object:

```ts
export function loadDraftingConfig(): DraftingConfig {
  return {
    apiKey: serverConfig.claudeApiKey,
    genModel: resolveClaudeModel(serverConfig.claudeModel),
    genTemperature: serverConfig.genTemperature,
    requestTimeoutMs: serverConfig.requestTimeoutSeconds * 1000,
    maxRetries: serverConfig.maxRetries,
    retryBackoffBase: serverConfig.retryBackoffBase,
    groqApiKey: serverConfig.groqApiKey,
    groqModel: serverConfig.groqModel,
  };
}
```

- [ ] **Step 4: Write `GroqClient`**

Create `server/src/drafting/groqClient.ts`:

```ts
/** Groq chat client for inbound reply classification -- mirrors
 * ClaudeClient's public interface exactly (same Completion shape, same
 * chat(system, user, opts) signature, same retryWithBackoff usage) so
 * callers written against one read identically against the other.
 *
 * Unlike ClaudeClient, jsonMode here uses Groq's native OpenAI-compatible
 * `response_format: { type: "json_object" }` instead of a manual
 * JSON-salvage step -- Groq's models support real JSON mode; Anthropic's
 * don't, which is why claudeClient.ts needs its own extractJsonText salvage.
 */

import Groq from "groq-sdk";
import type { DraftingConfig } from "./config";
import type { Completion, ChatOptions } from "./claudeClient";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";

export class GroqError extends Error {}

export class GroqClient {
  private client: Groq;
  private cfg: DraftingConfig;

  constructor(cfg: DraftingConfig) {
    this.cfg = cfg;
    this.client = new Groq({ apiKey: cfg.groqApiKey, maxRetries: 0, timeout: cfg.requestTimeoutMs });
  }

  /** Run one chat completion. Set jsonMode to force a JSON object response. */
  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<Completion> {
    const model = opts.model || this.cfg.groqModel;
    // Lower than ClaudeClient's 0.5 default -- classification wants
    // determinism, not creativity.
    const temperature = opts.temperature ?? 0.3;
    const jsonMode = opts.jsonMode ?? false;
    // Classification responses are tiny: {categoryId, confidence}.
    const maxTokens = opts.maxTokens ?? 256;

    try {
      return await retryWithBackoff(
        async (signal) => {
          const started = Date.now();
          const response = await this.client.chat.completions.create(
            {
              model,
              temperature,
              max_tokens: maxTokens,
              response_format: jsonMode ? { type: "json_object" } : undefined,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            },
            { signal }
          );
          const latencyMs = Date.now() - started;
          const text = response.choices[0]?.message?.content ?? "";

          return {
            text,
            model: response.model,
            prompt_tokens: response.usage?.prompt_tokens ?? null,
            completion_tokens: response.usage?.completion_tokens ?? null,
            latency_ms: latencyMs,
          };
        },
        {
          isRetryable: isRetryableByDefault,
          deadlineMs: 15000,
          onRetry: (err, attempt, delayMs) => {
            console.warn(
              `[groqClient] Groq call failed (attempt ${attempt + 1}/5): ${(err as any)?.message || err} — retrying in ${(delayMs / 1000).toFixed(1)}s`
            );
          },
        }
      );
    } catch (err: any) {
      throw new GroqError(`Groq call failed after retries: ${err?.cause?.message ?? err?.message ?? err}`);
    }
  }
}
```

- [ ] **Step 5: Write a live smoke test**

Create `server/src/drafting/groqClient.test.ts`:

```ts
/**
 * Smoke test for GroqClient -- makes one real call against the configured
 * GROQ_API_KEY to confirm the client is wired correctly end-to-end.
 *
 * Run: cd server && npx ts-node src/drafting/groqClient.test.ts
 */

import assert from "node:assert";
import { GroqClient } from "./groqClient";
import { loadDraftingConfig } from "./config";

async function test1_plainTextCompletion() {
  const client = new GroqClient(loadDraftingConfig());
  const result = await client.chat(
    "You are a terse assistant. Reply with exactly one word.",
    "What is the capital of France?"
  );
  assert.ok(result.text.length > 0, "expected non-empty completion text");
  assert.ok(result.text.toLowerCase().includes("paris"), `expected "paris" in response, got: ${result.text}`);
  assert.ok(result.latency_ms >= 0);
}

async function test2_jsonMode() {
  const client = new GroqClient(loadDraftingConfig());
  const result = await client.chat(
    'You classify sentiment. Respond with a JSON object: {"sentiment": "positive" | "negative" | "neutral"}.',
    "I love this product!",
    { jsonMode: true }
  );
  const parsed = JSON.parse(result.text);
  assert.ok(["positive", "negative", "neutral"].includes(parsed.sentiment), `unexpected sentiment: ${parsed.sentiment}`);
}

async function main() {
  const tests = [test1_plainTextCompletion, test2_jsonMode];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
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

Run: `cd server && npx ts-node src/drafting/groqClient.test.ts`
Expected: `All 2 tests passed`. If `test1` fails with an auth error, confirm `GROQ_API_KEY` in `server/.env` is set (it should already be, per the design spec conversation) and that the model name in `GROQ_MODEL` is currently valid on Groq's API — if `llama-3.3-70b-versatile` has been deprecated, check `https://console.groq.com/docs/models` for the current production model name and update `GROQ_MODEL` in `server/.env` accordingly.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/config.ts server/src/drafting/config.ts server/src/drafting/groqClient.ts server/src/drafting/groqClient.test.ts
git commit -m "feat: add GroqClient mirroring ClaudeClient's chat() interface"
```

---

### Task 3: Classifier Module

**Files:**
- Create: `server/src/lib/replyClassifier.ts`
- Test: `server/src/lib/replyClassifier.test.ts`

**Interfaces:**
- Consumes: `GroqClient` (has `chat(system, user, opts): Promise<Completion>`) from Task 2.
- Produces: `classifyReply(client: { chat: GroqClient["chat"] }, messageText: string, categories: Array<{ id: string; name: string; description: string }>): Promise<ClassificationResult | null>` and `export interface ClassificationResult { categoryId: string; confidence: number }`. Task 4 imports both from this file.

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/replyClassifier.test.ts`:

```ts
/**
 * Unit tests for the reply classifier's decision logic, against a fake
 * GroqClient (no real Groq calls) -- table-driven cases across the doc's 6
 * category groups, plus the confidence-threshold and hallucination guards.
 *
 * Run: cd server && npx ts-node src/lib/replyClassifier.test.ts
 */

import assert from "node:assert";
import { classifyReply } from "./replyClassifier";

const CATEGORIES = [
  { id: "cat_rate_query", name: "Rate Query", description: "RTM rate, hourly rate, per-word rate, premium rate request" },
  { id: "cat_login_issue", name: "Login Issue", description: "Password reset, 2FA setup, authenticator app, backup code" },
  { id: "cat_ai_voice", name: "AI Usage / Voice Cloning Concern", description: "Candidate concerned about AI training or voice data usage" },
];

function fakeClient(responseText: string) {
  return {
    chat: async () => ({ text: responseText, model: "fake", prompt_tokens: null, completion_tokens: null, latency_ms: 0 }),
  };
}

async function test1_confidentMatchReturnsResult() {
  const client = fakeClient(JSON.stringify({ categoryId: "cat_rate_query", confidence: 0.9 }));
  const result = await classifyReply(client as any, "What's your hourly rate for RTM work?", CATEGORIES);
  assert.deepStrictEqual(result, { categoryId: "cat_rate_query", confidence: 0.9 });
}

async function test2_belowThresholdReturnsNull() {
  const client = fakeClient(JSON.stringify({ categoryId: "cat_login_issue", confidence: 0.4 }));
  const result = await classifyReply(client as any, "hmm not sure what this is about", CATEGORIES);
  assert.strictEqual(result, null);
}

async function test3_explicitNullCategoryReturnsNull() {
  const client = fakeClient(JSON.stringify({ categoryId: null, confidence: 0 }));
  const result = await classifyReply(client as any, "Just saying hi!", CATEGORIES);
  assert.strictEqual(result, null);
}

async function test4_hallucinatedCategoryIdIsRejected() {
  const client = fakeClient(JSON.stringify({ categoryId: "cat_does_not_exist", confidence: 0.95 }));
  const result = await classifyReply(client as any, "Some message", CATEGORIES);
  assert.strictEqual(result, null, "a categoryId not in the provided list must never be trusted");
}

async function test5_emptyCategoryListReturnsNullWithoutCallingClient() {
  let called = false;
  const client = { chat: async () => { called = true; return { text: "{}", model: "fake", prompt_tokens: null, completion_tokens: null, latency_ms: 0 }; } };
  const result = await classifyReply(client as any, "Some message", []);
  assert.strictEqual(result, null);
  assert.strictEqual(called, false, "must not call the client when there are no categories to match against");
}

async function main() {
  const tests = [
    test1_confidentMatchReturnsResult,
    test2_belowThresholdReturnsNull,
    test3_explicitNullCategoryReturnsNull,
    test4_hallucinatedCategoryIdIsRejected,
    test5_emptyCategoryListReturnsNullWithoutCallingClient,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx ts-node src/lib/replyClassifier.test.ts`
Expected: fails immediately with a module-not-found/compile error, since `./replyClassifier` doesn't exist yet.

- [ ] **Step 3: Implement `classifyReply`**

Create `server/src/lib/replyClassifier.ts`:

```ts
/** Classifies one inbound lead reply against the owner-managed
 * ReplyCategory list, using Groq (see groqClient.ts) for the actual
 * intent-matching call. Returns null ("Unclassified") when no category
 * clears CONFIDENCE_THRESHOLD, when the model can't find a plausible match,
 * or when the model returns a categoryId that isn't in the provided list
 * (never trust a hallucinated id onto a real Lead record). */

export interface ClassificationResult {
  categoryId: string;
  confidence: number;
}

export interface ReplyCategoryForClassification {
  id: string;
  name: string;
  description: string;
}

// Matches semanticFaqSearch.ts's proven confidence cutoff for the FAQ
// semantic fallback -- kept identical here rather than introducing a second
// tuned threshold with no data yet to justify a different number.
const CONFIDENCE_THRESHOLD = 0.65;

interface ChatLike {
  chat(system: string, user: string, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<{ text: string }>;
}

export async function classifyReply(
  client: ChatLike,
  messageText: string,
  categories: ReplyCategoryForClassification[]
): Promise<ClassificationResult | null> {
  if (categories.length === 0) return null;

  const categoryList = categories.map((c) => `- id: "${c.id}", name: "${c.name}" — ${c.description}`).join("\n");

  const system =
    "You classify inbound email/LinkedIn replies from freelance linguist candidates into exactly one category from a fixed list. " +
    "Pick the single best-matching category id and a confidence score from 0 to 1. " +
    'If nothing in the list plausibly matches, return {"categoryId": null, "confidence": 0}. ' +
    'Respond with a JSON object: {"categoryId": string | null, "confidence": number}.';

  const user = `Categories:\n${categoryList}\n\nReply to classify:\n"""\n${messageText}\n"""`;

  const completion = await client.chat(system, user, { jsonMode: true, maxTokens: 200 });

  let parsed: { categoryId?: string | null; confidence?: number };
  try {
    parsed = JSON.parse(completion.text);
  } catch {
    return null; // malformed model output -- treat as unclassified rather than throwing
  }

  if (!parsed.categoryId || typeof parsed.confidence !== "number") return null;
  if (parsed.confidence < CONFIDENCE_THRESHOLD) return null;
  if (!categories.some((c) => c.id === parsed.categoryId)) return null; // guard against a hallucinated id

  return { categoryId: parsed.categoryId, confidence: parsed.confidence };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx ts-node src/lib/replyClassifier.test.ts`
Expected: `All 5 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/replyClassifier.ts server/src/lib/replyClassifier.test.ts
git commit -m "feat: add classifyReply with confidence threshold and hallucination guard"
```

---

### Task 4: Wire Classification into the Inbound Webhook

**Files:**
- Modify: `server/src/services/processInboundMessage.ts`
- Test: `server/src/services/processInboundMessage.test.ts`

**Interfaces:**
- Consumes: `classifyReply`, `ClassificationResult` from `server/src/lib/replyClassifier.ts` (Task 3); `GroqClient` from `server/src/drafting/groqClient.ts` (Task 2); `loadDraftingConfig` from `server/src/drafting/config.ts`; `Lead.replyCategoryId`/`replyClassificationSource`/`replyClassifiedAt` and `ReplyClassificationEvent` (Task 1).
- Produces: `resolveLeadIdForInboundMessage(msg: { channel: string; threadId: string | null }): Promise<string | null>` and `applyClassificationResult(leadId: string, result: ClassificationResult | null): Promise<void>`, both exported alongside the existing `processInboundMessage`. No later task consumes these directly, but they're exported so this task's own tests can exercise the decision logic without a live Groq call.

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/processInboundMessage.test.ts`:

```ts
/**
 * Unit tests for the inbound-message classification wiring. Exercises
 * resolveLeadIdForInboundMessage and applyClassificationResult directly
 * against the real dev DB (no live Groq calls -- classifyReply itself is
 * covered by replyClassifier.test.ts).
 *
 * Run: cd server && npx ts-node src/services/processInboundMessage.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";
import { resolveLeadIdForInboundMessage, applyClassificationResult } from "./processInboundMessage";

const TEST_CHAT_ID = "test_chat_classification_001";

async function cleanup() {
  const lead = await prisma.lead.findFirst({ where: { fullName: "Test Wiring Lead" } });
  if (lead) {
    await prisma.replyClassificationEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.conversation.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
  }
  await prisma.replyCategory.deleteMany({ where: { name: { startsWith: "test_" } } });
}

async function makeLeadWithConversation(recruiterId: string) {
  const lead = await prisma.lead.create({ data: { fullName: "Test Wiring Lead", source: "LINKEDIN" } });
  await prisma.conversation.create({
    data: {
      leadId: lead.id,
      recruiterId,
      candidateName: "Test Wiring Lead",
      channel: "LINKEDIN",
      unipileChatId: TEST_CHAT_ID,
    },
  });
  return lead;
}

async function getOrCreateTestRecruiter(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { role: "RECRUITER" } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: { name: "Test Recruiter", email: `test_recruiter_${Date.now()}@example.com`, role: "RECRUITER" },
  });
  return created.id;
}

async function test1_resolvesLeadIdFromMatchingConversation() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);

  const leadId = await resolveLeadIdForInboundMessage({ channel: "LINKEDIN", threadId: TEST_CHAT_ID });
  assert.strictEqual(leadId, lead.id);
}

async function test2_returnsNullWhenNoConversationMatches() {
  const leadId = await resolveLeadIdForInboundMessage({ channel: "LINKEDIN", threadId: "test_chat_does_not_exist" });
  assert.strictEqual(leadId, null);
}

async function test3_confidentResultAlwaysOverwrites() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const category = await prisma.replyCategory.create({ data: { groupName: "Payment & Invoicing", name: "test_Rate Query Wiring", description: "test" } });

  // Start the lead with a MANUAL override -- a confident AUTO result must
  // still win over it.
  await prisma.lead.update({ where: { id: lead.id }, data: { replyCategoryId: category.id, replyClassificationSource: "MANUAL" } });

  const otherCategory = await prisma.replyCategory.create({ data: { groupName: "General Queries", name: "test_Other Category Wiring", description: "test" } });
  await applyClassificationResult(lead.id, { categoryId: otherCategory.id, confidence: 0.8 });

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, otherCategory.id);
  assert.strictEqual(updated?.replyClassificationSource, "AUTO");

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].source, "AUTO");
  assert.strictEqual(Number(events[0].confidence), 0.8);

  await prisma.replyCategory.deleteMany({ where: { id: { in: [category.id, otherCategory.id] } } });
}

async function test4_lowConfidenceOverManualLeavesLeadUntouched() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId);
  const category = await prisma.replyCategory.create({ data: { groupName: "Payment & Invoicing", name: "test_Rate Query Wiring 2", description: "test" } });

  await prisma.lead.update({ where: { id: lead.id }, data: { replyCategoryId: category.id, replyClassificationSource: "MANUAL" } });

  await applyClassificationResult(lead.id, null);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, category.id, "a MANUAL override must survive a low-confidence auto result");
  assert.strictEqual(updated?.replyClassificationSource, "MANUAL");

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 1, "the attempt must still be logged even though the Lead wasn't updated");
  assert.strictEqual(events[0].categoryId, null);

  await prisma.replyCategory.delete({ where: { id: category.id } });
}

async function test5_lowConfidenceOverAutoOrUnsetClearsToUnclassified() {
  const recruiterId = await getOrCreateTestRecruiter();
  const lead = await makeLeadWithConversation(recruiterId); // starts with replyClassificationSource = null

  await applyClassificationResult(lead.id, null);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, null);
  assert.strictEqual(updated?.replyClassificationSource, "AUTO");
}

async function main() {
  const tests = [
    test1_resolvesLeadIdFromMatchingConversation,
    test2_returnsNullWhenNoConversationMatches,
    test3_confidentResultAlwaysOverwrites,
    test4_lowConfidenceOverManualLeavesLeadUntouched,
    test5_lowConfidenceOverAutoOrUnsetClearsToUnclassified,
  ];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
      await cleanup();
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  await cleanup();
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx ts-node src/services/processInboundMessage.test.ts`
Expected: fails to compile — `resolveLeadIdForInboundMessage`/`applyClassificationResult` are not yet exported from `processInboundMessage.ts`.

- [ ] **Step 3: Implement the wiring**

Replace the full contents of `server/src/services/processInboundMessage.ts` with:

```ts
/**
 * Async handoff for inbound webhook messages.
 *
 * Called via setImmediate() after the webhook has already responded 200,
 * so latency here never blocks Unipile's retry window.
 *
 * Classifies the reply against the owner-managed ReplyCategory list (see
 * replyClassifier.ts) and updates the originating Lead's current
 * classification state, subject to the override-preservation rule: a
 * confident result always wins; a low-confidence/unclassified result only
 * overwrites a Lead whose current source is AUTO or unset, never MANUAL.
 */

import { prisma } from "../prisma";
import { GroqClient } from "../drafting/groqClient";
import { loadDraftingConfig } from "../drafting/config";
import { classifyReply, ClassificationResult } from "../lib/replyClassifier";

/** Resolves the Lead a given inbound message belongs to, via the
 * Conversation whose unipileChatId matches the message's threadId -- the
 * same correlation Unipile's own webhook handler already relies on (see
 * unipile.service.ts's `prisma.conversation.findUnique({ where: {
 * unipileChatId } })` lookup). Returns null if no conversation matches
 * (nothing to classify against). */
export async function resolveLeadIdForInboundMessage(msg: { channel: string; threadId: string | null }): Promise<string | null> {
  if (!msg.threadId) return null;
  const conversation = await prisma.conversation.findUnique({ where: { unipileChatId: msg.threadId } });
  return conversation?.leadId ?? null;
}

/** Applies one classification attempt's outcome to a Lead and always logs
 * a ReplyClassificationEvent, per the override-preservation rule described
 * in the module doc comment above. */
export async function applyClassificationResult(leadId: string, result: ClassificationResult | null): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { replyClassificationSource: true } });
  if (!lead) return;

  await prisma.replyClassificationEvent.create({
    data: {
      leadId,
      categoryId: result?.categoryId ?? null,
      confidence: result?.confidence ?? null,
      source: "AUTO",
    },
  });

  const isConfident = result !== null;
  const priorWasManual = lead.replyClassificationSource === "MANUAL";

  if (!isConfident && priorWasManual) {
    return; // a human override survives an ambiguous/unrelated follow-up reply
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      replyCategoryId: result?.categoryId ?? null,
      replyClassificationSource: "AUTO",
      replyClassifiedAt: new Date(),
    },
  });
}

export async function processInboundMessage(inboundMessageId: string): Promise<void> {
  try {
    const msg = await prisma.inboundMessage.findUnique({
      where: { id: inboundMessageId },
    });

    if (!msg) {
      console.warn(`[processInbound] InboundMessage ${inboundMessageId} not found — skipping.`);
      return;
    }

    if (msg.processed) {
      console.log(`[processInbound] InboundMessage ${inboundMessageId} already processed — skipping.`);
      return;
    }

    console.log(
      `[processInbound] Processing ${msg.channel} message from "${msg.sender}" (id=${msg.id}): "${msg.content.slice(0, 80)}…"`
    );

    try {
      const leadId = await resolveLeadIdForInboundMessage({ channel: msg.channel, threadId: msg.threadId });
      if (!leadId) {
        console.log(`[processInbound] No matching conversation/lead for InboundMessage ${inboundMessageId} — skipping classification.`);
      } else {
        const categories = await prisma.replyCategory.findMany({ where: { isActive: true } });
        const draftingConfig = loadDraftingConfig();
        const groqClient = new GroqClient(draftingConfig);
        const result = await classifyReply(groqClient, msg.content, categories);
        await applyClassificationResult(leadId, result);
        console.log(`[processInbound] Classified InboundMessage ${inboundMessageId} for lead ${leadId}: ${result ? `${result.categoryId} (${result.confidence})` : "Unclassified"}`);
      }
    } catch (classifyErr: any) {
      // Classification failure must never block marking the message
      // processed -- matches this function's existing error-isolation
      // contract (see the outer try/catch below).
      console.error(`[processInbound] Classification failed for InboundMessage ${inboundMessageId}:`, classifyErr?.message || classifyErr);
    }

    await prisma.inboundMessage.update({
      where: { id: inboundMessageId },
      data: { processed: true },
    });

    console.log(`[processInbound] Marked InboundMessage ${inboundMessageId} as processed.`);
  } catch (err: any) {
    // Fire-and-forget: log but never throw — this runs after the HTTP
    // response is already sent, so there's nobody to catch it.
    console.error(`[processInbound] Failed to process InboundMessage ${inboundMessageId}:`, err?.message || err);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx ts-node src/services/processInboundMessage.test.ts`
Expected: `All 5 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/processInboundMessage.ts server/src/services/processInboundMessage.test.ts
git commit -m "feat: wire Groq classification into the inbound webhook handler"
```

---

### Task 5: Reply Category CRUD API

**Files:**
- Create: `server/src/routes/replyCategories.routes.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/replyCategories.routes.test.ts`

**Interfaces:**
- Consumes: `authenticateJwt`, `requireRole` middleware; `asyncHandler`, `ApiError`; `prisma.replyCategory` (Task 1).
- Produces: `replyCategoriesRouter` (Express `Router`), mounted at `/api/reply-categories`. Task 7 (client) consumes this API's shape: `GET /` → `{ replyCategories: ReplyCategory[] }`, `POST /` → `{ replyCategory }`, `PATCH /:id` → `{ replyCategory }`, `DELETE /:id` → `{ success: true }`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/routes/replyCategories.routes.test.ts`. This test calls the route handlers' underlying logic the same way `webhook.test.ts` calls `UnipileService.handleWebhookEvent` directly rather than spinning up an HTTP server — but since this router's logic is Express-route-shaped (not a plain service function), test it through Prisma directly for the CRUD behavior and rely on Task 5's own manual verification (Step 6 below) for the RBAC/HTTP-layer wiring, matching how this codebase already splits "business logic" tests from "route wiring" for its other CRUD routers:

```ts
/**
 * Unit tests for the ReplyCategory CRUD behavior (create/update/delete +
 * the unique-name constraint + SetNull-on-delete cascade to Lead). HTTP-
 * layer concerns (RBAC, status codes) are covered by manual verification
 * against the running dev server -- see Task 5, Step 6 of the
 * implementation plan.
 *
 * Run: cd server && npx ts-node src/routes/replyCategories.routes.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";

const TEST_NAME = "test_CRUD Category";
const TEST_NAME_RENAMED = "test_CRUD Category Renamed";

async function cleanup() {
  await prisma.replyCategory.deleteMany({ where: { name: { in: [TEST_NAME, TEST_NAME_RENAMED] } } });
}

async function test1_createAndFetch() {
  const created = await prisma.replyCategory.create({
    data: { groupName: "General Queries", name: TEST_NAME, description: "A test category" },
  });
  assert.strictEqual(created.isActive, true, "new categories default to active");

  const fetched = await prisma.replyCategory.findUnique({ where: { id: created.id } });
  assert.strictEqual(fetched?.name, TEST_NAME);
}

async function test2_duplicateNameRejected() {
  await assert.rejects(
    () => prisma.replyCategory.create({ data: { groupName: "General Queries", name: TEST_NAME, description: "dup" } }),
    /Unique constraint/i
  );
}

async function test3_updateRenamesAndDeactivates() {
  const existing = await prisma.replyCategory.findUniqueOrThrow({ where: { name: TEST_NAME } });
  const updated = await prisma.replyCategory.update({
    where: { id: existing.id },
    data: { name: TEST_NAME_RENAMED, isActive: false },
  });
  assert.strictEqual(updated.name, TEST_NAME_RENAMED);
  assert.strictEqual(updated.isActive, false);
}

async function test4_deleteRemovesRow() {
  const existing = await prisma.replyCategory.findUniqueOrThrow({ where: { name: TEST_NAME_RENAMED } });
  await prisma.replyCategory.delete({ where: { id: existing.id } });
  const gone = await prisma.replyCategory.findUnique({ where: { id: existing.id } });
  assert.strictEqual(gone, null);
}

async function main() {
  const tests = [test1_createAndFetch, test2_duplicateNameRejected, test3_updateRenamesAndDeactivates, test4_deleteRemovesRow];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  await cleanup();
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx ts-node src/routes/replyCategories.routes.test.ts`
Expected: fails at `test1` — `prisma.replyCategory` doesn't exist until Task 1's migration ran. If Task 1 is already done (it is, by this point in the plan), this test should actually pass immediately since it only exercises Prisma directly, not the new router. Run it now as a baseline before writing the router in Step 3, and re-run after Step 3 to confirm nothing regressed.

- [ ] **Step 3: Write the router**

Create `server/src/routes/replyCategories.routes.ts`:

```ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { prisma } from "../prisma";

export const replyCategoriesRouter = Router();

replyCategoriesRouter.use(authenticateJwt);

const createReplyCategorySchema = z.object({
  groupName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});

const updateReplyCategorySchema = z
  .object({
    groupName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

// GET /api/reply-categories — list all active categories. Any authenticated
// role (needed for the manual-override dropdown on the lead card).
replyCategoriesRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const replyCategories = await prisma.replyCategory.findMany({
      where: { isActive: true },
      orderBy: [{ groupName: "asc" }, { name: "asc" }],
    });
    return res.json({ replyCategories });
  })
);

// GET /api/reply-categories/:id — single category.
replyCategoriesRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const replyCategory = await prisma.replyCategory.findUnique({ where: { id: req.params.id } });
    if (!replyCategory) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");
    return res.json({ replyCategory });
  })
);

// POST /api/reply-categories — create a category. Owner only.
replyCategoriesRouter.post(
  "/",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const { groupName, name, description } = createReplyCategorySchema.parse(req.body);
    const replyCategory = await prisma.replyCategory.create({
      data: { groupName, name, description, isActive: true },
    });
    return res.status(201).json({ replyCategory });
  })
);

// PATCH /api/reply-categories/:id — update provided fields only. Owner only.
replyCategoriesRouter.patch(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const patch = updateReplyCategorySchema.parse(req.body);

    const existing = await prisma.replyCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");

    const replyCategory = await prisma.replyCategory.update({ where: { id: req.params.id }, data: patch });
    return res.json({ replyCategory });
  })
);

// DELETE /api/reply-categories/:id — hard delete. Owner only. Lead rows
// referencing this category fall back to "Unclassified" via onDelete:
// SetNull (see schema.prisma), so this never errors on existing leads.
replyCategoriesRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.replyCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");

    await prisma.replyCategory.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  })
);
```

- [ ] **Step 4: Mount the router**

In `server/src/index.ts`, add the import next to the `faqRouter` import:

```ts
import { replyCategoriesRouter } from "./routes/replyCategories.routes";
```

And mount it next to the FAQ mount line:

```ts
app.use("/api/reply-categories", replyCategoriesRouter);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx ts-node src/routes/replyCategories.routes.test.ts`
Expected: `All 4 tests passed`.

- [ ] **Step 6: Manual RBAC/HTTP verification**

Start the dev server (`cd server && npm run dev`) and verify with `curl` (or the running client once Task 7 lands):
1. `GET /api/reply-categories` with a valid recruiter or contractor token succeeds (200, non-owner roles can read).
2. `POST /api/reply-categories` with a non-owner token returns 403.
3. `POST /api/reply-categories` with an owner token and a valid body returns 201.
4. `DELETE /api/reply-categories/:id` on a category that has leads pointing at it succeeds, and re-fetching one of those leads shows `replyCategoryId: null`.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/replyCategories.routes.ts server/src/routes/replyCategories.routes.test.ts server/src/index.ts
git commit -m "feat: add reply category CRUD API"
```

---

### Task 6: Manual Override on `PATCH /api/leads/:id`

**Files:**
- Modify: `server/src/routes/lead.routes.ts`
- Test: `server/src/routes/leadReplyOverride.test.ts`

**Interfaces:**
- Consumes: `Lead.replyCategoryId`/`replyClassificationSource`/`replyClassifiedAt`, `ReplyClassificationEvent` (Task 1).
- Produces: `PATCH /api/leads/:id` now accepts an optional `replyCategoryId: string | null` field. Task 8 (client) calls this with `{ replyCategoryId }` to implement the override dropdown.

- [ ] **Step 1: Write the failing tests**

Create `server/src/routes/leadReplyOverride.test.ts`:

```ts
/**
 * Unit tests for the manual reply-classification override path on
 * PATCH /api/leads/:id. Exercises the Prisma-level behavior the route
 * handler performs, matching this codebase's existing "business logic
 * over HTTP wiring" test split (see replyCategories.routes.test.ts).
 *
 * Run: cd server && npx ts-node src/routes/leadReplyOverride.test.ts
 */

import assert from "node:assert";
import { prisma } from "../prisma";

async function cleanup() {
  await prisma.replyClassificationEvent.deleteMany({ where: { lead: { fullName: "Test Override Lead" } } });
  await prisma.lead.deleteMany({ where: { fullName: "Test Override Lead" } });
  await prisma.replyCategory.deleteMany({ where: { name: { startsWith: "test_override_" } } });
  await prisma.user.deleteMany({ where: { email: "test_override_owner@example.com" } });
}

/** Mirrors exactly what the PATCH /:id handler does when `replyCategoryId`
 * is present in the request body (see Step 3 below) -- used here to test
 * the underlying data changes without spinning up an HTTP server. */
async function applyManualOverride(leadId: string, replyCategoryId: string | null, changedByUserId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { replyCategoryId, replyClassificationSource: "MANUAL", replyClassifiedAt: new Date() },
  });
  await prisma.replyClassificationEvent.create({
    data: { leadId, categoryId: replyCategoryId, confidence: null, source: "MANUAL", changedByUserId },
  });
}

async function test1_overrideSetsManualSourceAndLogsEvent() {
  const owner = await prisma.user.create({ data: { name: "Test Override Owner", email: "test_override_owner@example.com", role: "OWNER" } });
  const category = await prisma.replyCategory.create({ data: { groupName: "General Queries", name: "test_override_Category", description: "test" } });
  const lead = await prisma.lead.create({ data: { fullName: "Test Override Lead", source: "LINKEDIN" } });

  await applyManualOverride(lead.id, category.id, owner.id);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, category.id);
  assert.strictEqual(updated?.replyClassificationSource, "MANUAL");
  assert.ok(updated?.replyClassifiedAt);

  const events = await prisma.replyClassificationEvent.findMany({ where: { leadId: lead.id } });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].source, "MANUAL");
  assert.strictEqual(events[0].changedByUserId, owner.id);
  assert.strictEqual(events[0].confidence, null, "a human override has no confidence score");
}

async function test2_overrideToNullClearsToUnclassified() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "test_override_owner@example.com" } });
  const lead = await prisma.lead.findFirstOrThrow({ where: { fullName: "Test Override Lead" } });

  await applyManualOverride(lead.id, null, owner.id);

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.strictEqual(updated?.replyCategoryId, null);
  assert.strictEqual(updated?.replyClassificationSource, "MANUAL", "explicitly clearing to Unclassified is still a MANUAL action");
}

async function main() {
  const tests = [test1_overrideSetsManualSourceAndLogsEvent, test2_overrideToNullClearsToUnclassified];
  let failed = 0;
  await cleanup();
  for (const t of tests) {
    try {
      await t();
      console.log(`PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${t.name}`);
      console.error(err);
    }
  }
  await cleanup();
  await prisma.$disconnect();
  if (failed > 0) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`All ${tests.length} tests passed`);
}

main();
```

- [ ] **Step 2: Run the test to verify it fails**

This test only exercises Prisma directly (matching Task 5's test-split convention), so it should already pass before touching the route file — run it now as a baseline:

Run: `cd server && npx ts-node src/routes/leadReplyOverride.test.ts`
Expected: `All 2 tests passed` (this confirms the Task 1 schema is in place; the actual route wiring is verified manually in Step 4 below).

- [ ] **Step 3: Extend the `PATCH /api/leads/:id` handler**

In `server/src/routes/lead.routes.ts`, add one field to the existing schema (find the `const schema = z.object({ ... closureReason: z.string().optional(), });` block inside the `/:id` PATCH handler):

```ts
      closureReason: z.string().optional(),
      replyCategoryId: z.string().uuid().nullable().optional(),
    });
```

Immediately after `const patch = schema.parse(req.body);`, add:

```ts
    // A caller sending `replyCategoryId` (even explicitly `null`) is
    // performing a manual override -- distinct from the auto-classifier's
    // own writes (see processInboundMessage.ts), which always use source
    // "AUTO". Setting these two alongside `replyCategoryId` here means they
    // ride along in the single `prisma.lead.update` call below.
    if ("replyCategoryId" in patch) {
      (patch as any).replyClassificationSource = "MANUAL";
      (patch as any).replyClassifiedAt = new Date();
    }
```

Then, immediately after the existing `const updated = await prisma.lead.update({ where: { id: existing.id }, data: { ...patch, lastActivityAt: new Date() } });` call, add:

```ts

    if ("replyCategoryId" in patch) {
      await prisma.replyClassificationEvent.create({
        data: {
          leadId: existing.id,
          categoryId: patch.replyCategoryId ?? null,
          confidence: null,
          source: "MANUAL",
          changedByUserId: req.user!.id,
        },
      });
    }
```

- [ ] **Step 4: Manual HTTP verification**

Start the dev server and verify with `curl` (or the running client once Task 8 lands):
1. `PATCH /api/leads/:id` with `{ "replyCategoryId": "<some valid ReplyCategory id>" }` as a recruiter → 200, and re-fetching the lead shows `replyCategoryId` set and `replyClassificationSource: "MANUAL"`.
2. Same call as a contractor who does **not** own that lead → 403 (the existing contractor-ownership check already covers the new field, since it's part of the same `patch` object).
3. `PATCH /api/leads/:id` with `{ "replyCategoryId": null }` → 200, lead's `replyCategoryId` clears to `null`, `replyClassificationSource` stays `"MANUAL"`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/lead.routes.ts server/src/routes/leadReplyOverride.test.ts
git commit -m "feat: add manual reply-classification override to PATCH /api/leads/:id"
```

---

### Task 7: Client API Layer + Owner Reply Category Dashboard

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/lib/api-types.ts`
- Create: `client/src/routes/owner.reply-categories.tsx`
- Modify: `client/src/routes/owner.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/reply-categories` (Task 5).
- Produces: `api.listReplyCategories()`, `api.createReplyCategory()`, `api.updateReplyCategory()`, `api.deleteReplyCategory()`, and the `ReplyCategory`/`CreateReplyCategoryInput`/`UpdateReplyCategoryInput` types in `client/src/lib/api.ts`. Task 8 imports `ReplyCategory` and `api.listReplyCategories` from here. `ApiLead.replyCategoryId`/`replyClassificationSource`/`replyClassifiedAt` are added to `client/src/lib/api-types.ts` for Task 8.

- [ ] **Step 1: Add reply-category types and CRUD calls to `client/src/lib/api.ts`**

Right after the existing `FaqCheckResponse` interface (before `export const api = {`), add:

```ts
// -------------------- Reply Category types --------------------

export interface ReplyCategory {
  id: string;
  groupName: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReplyCategoryInput {
  groupName: string;
  name: string;
  description: string;
}

export interface UpdateReplyCategoryInput {
  groupName?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
}
```

Right after the existing `deleteFaq` method (before the closing `};` of the `api` object), add:

```ts

  // -------------------- Reply Categories --------------------

  /** List all active reply categories */
  async listReplyCategories(): Promise<{ replyCategories: ReplyCategory[] }> {
    return request("/api/reply-categories");
  },

  /** Create a reply category (owner only) */
  async createReplyCategory(data: CreateReplyCategoryInput): Promise<{ replyCategory: ReplyCategory }> {
    return request("/api/reply-categories", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /** Update a reply category (owner only) */
  async updateReplyCategory(id: string, data: UpdateReplyCategoryInput): Promise<{ replyCategory: ReplyCategory }> {
    return request(`/api/reply-categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  /** Delete a reply category (owner only) */
  async deleteReplyCategory(id: string): Promise<{ success: boolean }> {
    return request(`/api/reply-categories/${id}`, { method: "DELETE" });
  },
```

- [ ] **Step 2: Add classification fields to `ApiLead`**

In `client/src/lib/api-types.ts`, in the `ApiLead` interface, right after `availabilityFromDate: string | null;`, add:

```ts
  replyCategoryId: string | null;
  replyClassificationSource: "AUTO" | "MANUAL" | null;
  replyClassifiedAt: string | null;
```

- [ ] **Step 3: Add the "Reply Categories" nav item**

In `client/src/routes/owner.tsx`, add `Tags` to the `lucide-react` import:

```ts
import { LayoutGrid, Building2, Users, ContactRound, HelpCircle, Settings, Sparkles, BarChart3, Plus, Mail, MessagesSquare, Link2, Tags } from "lucide-react";
```

And add the nav entry right after the FAQs entry in `useNav()`:

```ts
    { to: "/owner/faqs", label: "FAQs", icon: HelpCircle },
    { to: "/owner/reply-categories", label: "Reply Categories", icon: Tags },
```

- [ ] **Step 4: Create the dashboard route**

Create `client/src/routes/owner.reply-categories.tsx` (a self-contained route file, mirroring the actual structure of `client/src/routes/owner.faqs.tsx` rather than a separately-imported manager component — that's the pattern this codebase's FAQ page actually uses):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ReplyCategory } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/owner/reply-categories")({
  component: ReplyCategoriesPage,
});

function ReplyCategoriesPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ReplyCategory | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reply-categories"],
    queryFn: async () => {
      const result = await api.listReplyCategories();
      return result.replyCategories;
    },
  });

  const createMutation = useMutation({
    mutationFn: (formData: any) => api.createReplyCategory(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reply-categories"] });
      toast.success("Reply category created");
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast.error(`Failed to create reply category: ${err.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.updateReplyCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reply-categories"] });
      toast.success("Reply category updated");
      setEditingCategory(null);
    },
    onError: (err: any) => {
      toast.error(`Failed to update reply category: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteReplyCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reply-categories"] });
      toast.success("Reply category deleted");
    },
    onError: (err: any) => {
      toast.error(`Failed to delete reply category: ${err.message}`);
    },
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading reply categories...</div>;
  }

  const grouped = new Map<string, ReplyCategory[]>();
  for (const c of data ?? []) {
    const list = grouped.get(c.groupName) ?? [];
    list.push(c);
    grouped.set(c.groupName, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Reply Categories</h1>
          <p className="text-muted-foreground mt-1">Manage the categories inbound lead replies are classified into.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus size={16} />
          Create Category
        </Button>
      </div>

      {grouped.size > 0 ? (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([groupName, categories]) => (
            <div key={groupName} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{groupName}</h2>
              {categories.map((category) => (
                <div key={category.id} className="border rounded-lg p-4 hover:bg-muted/50 transition">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base mb-1">{category.name}</h3>
                      <p className="text-sm text-muted-foreground">{category.description}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => setEditingCategory(category)} className="gap-1">
                        <Pencil size={16} />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete the category "${category.name}"? Leads currently classified with it will show as Unclassified.`)) {
                            deleteMutation.mutate(category.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 size={16} />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-4">No reply categories yet. Create one to get started.</p>
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus size={16} />
            Create your first category
          </Button>
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Reply Category</DialogTitle>
          </DialogHeader>
          <CategoryForm onSubmit={createMutation.mutate} isLoading={createMutation.isPending} onCancel={() => setIsCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      {editingCategory && (
        <Dialog open={!!editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Reply Category</DialogTitle>
            </DialogHeader>
            <CategoryForm
              initial={editingCategory}
              onSubmit={(data: any) => updateMutation.mutate({ id: editingCategory.id, data })}
              isLoading={updateMutation.isPending}
              onCancel={() => setEditingCategory(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CategoryForm({ initial, onSubmit, isLoading, onCancel }: { initial?: ReplyCategory; onSubmit: (data: any) => void; isLoading: boolean; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    groupName: initial?.groupName ?? "",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
  });
  const isValid = formData.groupName.trim() && formData.name.trim() && formData.description.trim();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="rc-group" className="text-sm font-medium">Group</label>
        <Input
          id="rc-group"
          placeholder="e.g., Payment & Invoicing"
          value={formData.groupName}
          onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="rc-name" className="text-sm font-medium">Name</label>
        <Input
          id="rc-name"
          placeholder="e.g., Rate Query"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="rc-description" className="text-sm font-medium">Description / Trigger</label>
        <Textarea
          id="rc-description"
          placeholder="What kind of reply should match this category?"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="min-h-24"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)} disabled={isLoading || !isValid}>
          {isLoading ? "Saving..." : initial ? "Save Category" : "Create Category"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Regenerate the route tree**

```bash
cd client
npm run dev
```

Expected: the TanStack Router Vite plugin auto-regenerates `client/src/routeTree.gen.ts` to include the new `/owner/reply-categories` route the moment the dev server starts (it watches `src/routes/`). Confirm by opening `client/src/routeTree.gen.ts` and checking for a `ReplyCategoriesRoute` entry, then stop the dev server (Ctrl+C).

- [ ] **Step 6: Manual verification**

With the dev server running (`npm run dev` in both `server/` and `client/`), sign in as an owner and navigate to `/owner/reply-categories`. Verify: the 33 seeded categories render grouped under their 6 headers; creating, editing, and deleting a category all work and toast correctly.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/api.ts client/src/lib/api-types.ts client/src/routes/owner.reply-categories.tsx client/src/routes/owner.tsx client/src/routeTree.gen.ts
git commit -m "feat: add owner reply category management dashboard"
```

---

### Task 8: Lead Classification Badge + Override Dropdown

**Files:**
- Modify: `server/src/routes/conversation.routes.ts`
- Modify: `client/src/lib/api-types.ts`
- Modify: `client/src/components/features/conversations-page-view.tsx`

**Interfaces:**
- Consumes: `ReplyCategory`, `api.listReplyCategories`, `api.updateLead` (Task 7); `ApiConversation.lead` (extended below).

- [ ] **Step 1: Expose classification fields on the conversation's lead projection**

In `server/src/routes/conversation.routes.ts`, there are five occurrences of the same `select` clause:

```ts
lead: { select: { fullName: true, displayName: true, profileLink: true, email: true } },
```

Replace **all five** with:

```ts
lead: { select: { fullName: true, displayName: true, profileLink: true, email: true, replyCategoryId: true, replyClassificationSource: true } },
```

(The two occurrences using `include: { lead: true }` already return every scalar field, including the new ones — leave those two unchanged.)

- [ ] **Step 2: Extend `ApiConversation.lead`**

In `client/src/lib/api-types.ts`, update the `ApiConversation` interface's `lead` field:

```ts
  lead?: {
    fullName: string | null;
    displayName: string | null;
    email?: string | null;
    profileLink?: string | null;
    replyCategoryId?: string | null;
    replyClassificationSource?: "AUTO" | "MANUAL" | null;
  };
```

- [ ] **Step 3: Add the badge and override dropdown to the conversation header**

In `client/src/components/features/conversations-page-view.tsx`, add the reply-categories query right after the existing `conversations` query (near the top of `ConversationsPageView`):

```tsx
  const { data: replyCategoriesData } = useQuery({
    queryKey: ["reply-categories"],
    queryFn: async () => {
      const result = await api.listReplyCategories();
      return result.replyCategories;
    },
  });
  const replyCategories = replyCategoriesData ?? [];

  const overrideClassificationMutation = useMutation({
    mutationFn: ({ leadId, replyCategoryId }: { leadId: string; replyCategoryId: string | null }) =>
      api.updateLead(leadId, { replyCategoryId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations", "own"] });
      toast.success("Reply classification updated");
    },
    onError: (err: any) => {
      toast.error(`Failed to update classification: ${err.message}`);
    },
  });
```

Add `useMutation` to the existing `@tanstack/react-query` import (currently `import { useQuery, useQueryClient } from "@tanstack/react-query";`):

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
```

Then, in the conversation header block (the `<div className="shrink-0 flex items-center justify-between ...">` block containing the existing `<Badge variant="outline" ...>LinkedIn</Badge>`), add the classification badge + dropdown next to it:

```tsx
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1 text-[10px]"><Linkedin className="h-3 w-3" />LinkedIn</Badge>
                    <select
                      className="h-6 rounded-md border border-border bg-background px-1.5 text-[10px]"
                      value={conv.lead?.replyCategoryId ?? ""}
                      onChange={(e) =>
                        overrideClassificationMutation.mutate({
                          leadId: conv.leadId,
                          replyCategoryId: e.target.value || null,
                        })
                      }
                      disabled={overrideClassificationMutation.isPending}
                    >
                      <option value="">Unclassified</option>
                      {replyCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
```

replacing the existing standalone `<Badge variant="outline" className="gap-1 text-[10px]"><Linkedin className="h-3 w-3" />LinkedIn</Badge>` line in that header block.

- [ ] **Step 4: Manual verification**

With both dev servers running, open the Conversations page as a recruiter with at least one lead conversation. Verify: the dropdown lists all seeded categories, selecting one calls `PATCH /api/leads/:id` (check the Network tab) and toasts success, and reloading the page shows the previously-selected category still selected (confirms the round trip through `replyCategoryId`).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/conversation.routes.ts client/src/lib/api-types.ts client/src/components/features/conversations-page-view.tsx
git commit -m "feat: add classification badge and manual override dropdown to conversation view"
```

---

## Final Verification

- [ ] Run every standalone test file added in this plan, in order:

```bash
cd server
npx ts-node src/lib/__tests__/replyCategorySchema.test.ts
npx ts-node src/drafting/groqClient.test.ts
npx ts-node src/lib/replyClassifier.test.ts
npx ts-node src/services/processInboundMessage.test.ts
npx ts-node src/routes/replyCategories.routes.test.ts
npx ts-node src/routes/leadReplyOverride.test.ts
```

Expected: every file prints `All N tests passed`.

- [ ] Send a real test reply through the actual Unipile webhook (or replay a captured payload) for a lead with an active conversation, and confirm: a `ReplyClassificationEvent` row is created, `Lead.replyCategoryId` updates when confidence is high, and the conversation view's dropdown reflects it after a refresh.
- [ ] Confirm `git log --oneline` on this branch shows exactly 8 feature commits (one per task) plus the earlier spec commit.
