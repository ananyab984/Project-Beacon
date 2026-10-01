# Inbound Reply Classification — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the plan generated from this spec.

**Goal:** Automatically classify every inbound lead reply into one of a client-defined, owner-editable set of categories, surface the current classification on the lead, and let a recruiter/owner override it manually.

**Architecture:** Event-driven classification plugged into the existing `processInboundMessage.ts` webhook hook. A new `GroqClient` (mirroring `ClaudeClient`'s `chat()` interface) classifies each inbound reply's text against an owner-managed category list stored in a new `ReplyCategory` table, using Groq's low-latency inference on an open model — a good fit since classification is not a reasoning-heavy task. The result is written onto `Lead` as denormalized "current state," with every classification attempt (auto or manual) also logged to an insert-only history table, following this codebase's existing `StageHistory`/`LeadFlagEvent` pattern.

**Tech Stack:** Groq API via the `groq-sdk` npm package (OpenAI-compatible), Prisma/PostgreSQL, existing Express route + RBAC patterns, existing React/TanStack Query dashboard patterns (cloned from the FAQ manager).

## Global Constraints

- Classification is per-**lead** (a single current-state field on `Lead`), not per-message. Each new inbound reply's classification attempt is what may update it.
- The classifier stores **sub-category only** (one of the doc's 33 leaf categories) on `Lead`. The 6 top-level groups from the doc exist only as a `groupName` field on `ReplyCategory`, used for dashboard grouping/display — never duplicated onto `Lead`.
- Confidence threshold for accepting an auto-classification: **0.65** (matches the FAQ semantic-fallback system's proven threshold in `semanticFaqSearch.ts`).
- No language-detection gate on this feature (unlike the FAQ semantic fallback) — classifying intent doesn't require producing an English reply, so non-English messages are classified directly.
- **Override-preservation rule (the one non-obvious behavior in this feature):**
  - A **confident** new auto-classification (≥ 0.65) always overwrites whatever was there before, regardless of whether the previous state was `AUTO` or `MANUAL`. "Most recent confident signal wins."
  - A **low-confidence/unclassified** new auto-classification result only overwrites the Lead's current state if that current state's `replyClassificationSource` is `AUTO` (or the lead has never been classified). If the current state is `MANUAL`, the Lead is left untouched — a human's override survives an ambiguous/unrelated follow-up reply (e.g. "Thanks!").
  - Regardless of whether `Lead` gets updated, **every** classification attempt (confident or not) writes one `ReplyClassificationEvent` row, so the audit trail always shows what the classifier actually returned.
- Scope for this iteration is **classify & tag only** — no automated routing or notifications triggered by category. That's explicitly out of scope; this app's roles (owner/recruiter/contractor) don't map onto the doc's "Resources Team," so routing would need its own design pass later.
- `ReplyCategory` deletion is a hard delete; `Lead.replyCategoryId` and `ReplyClassificationEvent.categoryId` are `onDelete: SetNull`, so removing a category never breaks existing leads/history — they fall back to displaying "Unclassified"/a null category.
- Env vars: `GROQ_API_KEY`, `GROQ_MODEL` (default `llama-3.3-70b-versatile`) — already added to `server/.env` and `server/.env.example`.

---

## Component 1: Database Schema

**Files:**
- Modify: `server/prisma/schema.prisma`
- Migration: generated via `npx prisma migrate dev` (Neon dev instance, same flow as the FAQ migration)
- Seed: `server/prisma/seed.ts` — add all 33 categories from the client's doc

### New enum

```prisma
enum ClassificationSource {
  AUTO
  MANUAL
}
```

### New model: ReplyCategory

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
```

### New model: ReplyClassificationEvent

```prisma
// ----------------------------------------------------------------------------
// REPLY CLASSIFICATION EVENTS — insert-only audit log, one row per
// classification attempt (auto or manual). Lead.replyCategoryId is the fast
// "current state" read; this table is the source of truth for history,
// mirroring the StageHistory / LeadFlagEvent pattern already used for other
// denormalized Lead fields.
// ----------------------------------------------------------------------------
model ReplyClassificationEvent {
  id              String                @id @default(uuid())
  leadId          String                @map("lead_id")
  lead            Lead                  @relation(fields: [leadId], references: [id], onDelete: Cascade)
  categoryId      String?               @map("category_id") // null = classified as "Unclassified"
  category        ReplyCategory?        @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  confidence      Decimal?              @db.Decimal(4, 3) // null for MANUAL — a human has no confidence score
  source          ClassificationSource
  changedByUserId String?               @map("changed_by_user_id") // set for MANUAL; null for AUTO
  changedBy       User?                 @relation(fields: [changedByUserId], references: [id])
  createdAt       DateTime              @default(now()) @map("created_at")

  @@index([leadId])
  @@map("reply_classification_events")
}
```

### Modify: Lead

Add three columns and two relations to the existing `Lead` model:

```prisma
replyCategoryId           String?               @map("reply_category_id")
replyCategory             ReplyCategory?        @relation(fields: [replyCategoryId], references: [id], onDelete: SetNull)
replyClassificationSource ClassificationSource? @map("reply_classification_source")
replyClassifiedAt         DateTime?             @map("reply_classified_at")
classificationEvents      ReplyClassificationEvent[]
```

### Modify: User

Add the inverse relation for `ReplyClassificationEvent.changedBy`:

```prisma
replyClassificationEvents ReplyClassificationEvent[]
```

### Seed data

Seed all 33 categories from `Inbound_Reply_Classification.docx` into `ReplyCategory`, verbatim:

```ts
const replyCategories = [
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

---

## Component 2: Groq Client

**Files:**
- Create: `server/src/drafting/groqClient.ts`
- Modify: `server/src/drafting/config.ts` (add `groqApiKey`, `groqModel` to config)
- Modify: `server/package.json` (add `groq-sdk` dependency)

`GroqClient` mirrors `ClaudeClient`'s public interface exactly — same `Completion` shape, same `chat(system, user, opts): Promise<Completion>` signature, same `retryWithBackoff` usage — so any caller written against one can be read against the other without translation. Internally it uses `groq-sdk`'s `chat.completions.create`, and Groq's native OpenAI-compatible `response_format: { type: "json_object" }` for `jsonMode` instead of the manual JSON-salvage `extractJsonText` trick `ClaudeClient` needs (Groq's models support real JSON mode; Anthropic's don't).

```ts
import Groq from "groq-sdk";
import type { DraftingConfig } from "./config";
import { retryWithBackoff, isRetryableByDefault } from "../lib/retryWithBackoff";
import type { Completion, ChatOptions } from "./claudeClient"; // reuse the same shapes

export class GroqError extends Error {}

export class GroqClient {
  private client: Groq;
  private cfg: DraftingConfig;

  constructor(cfg: DraftingConfig) {
    this.cfg = cfg;
    this.client = new Groq({ apiKey: cfg.groqApiKey, maxRetries: 0, timeout: cfg.requestTimeoutMs });
  }

  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<Completion> {
    const model = opts.model || this.cfg.groqModel;
    const temperature = opts.temperature ?? 0.3; // lower than Claude's 0.5 default — classification wants determinism, not creativity
    const jsonMode = opts.jsonMode ?? false;
    const maxTokens = opts.maxTokens ?? 256; // classification responses are tiny: {categoryId, confidence}

    try {
      return await retryWithBackoff(
        async () => {
          const started = Date.now();
          const response = await this.client.chat.completions.create({
            model,
            temperature,
            max_tokens: maxTokens,
            response_format: jsonMode ? { type: "json_object" } : undefined,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });
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
            console.warn(`[groqClient] Groq call failed (attempt ${attempt + 1}/5): ${(err as any)?.message || err} — retrying in ${(delayMs / 1000).toFixed(1)}s`);
          },
        }
      );
    } catch (err: any) {
      throw new GroqError(`Groq call failed after retries: ${err?.cause?.message ?? err?.message ?? err}`);
    }
  }
}
```

---

## Component 3: Classifier Module

**Files:**
- Create: `server/src/lib/replyClassifier.ts`

```ts
export interface ClassificationResult {
  categoryId: string;
  confidence: number;
}

const CONFIDENCE_THRESHOLD = 0.65;

/**
 * Classifies one inbound reply against the active ReplyCategory list.
 * Returns null if no category clears the confidence threshold ("Unclassified").
 */
export async function classifyReply(
  client: GroqClient,
  messageText: string,
  categories: Array<{ id: string; name: string; description: string }>
): Promise<ClassificationResult | null> {
  if (categories.length === 0) return null;

  const categoryList = categories
    .map((c) => `- id: "${c.id}", name: "${c.name}" — ${c.description}`)
    .join("\n");

  const system =
    "You classify inbound email/LinkedIn replies from freelance linguist candidates into exactly one category from a fixed list. " +
    "Pick the single best-matching category id and a confidence score from 0 to 1. " +
    'If nothing in the list plausibly matches, return {"categoryId": null, "confidence": 0}. ' +
    'Respond with a JSON object: {"categoryId": string | null, "confidence": number}.';

  const user = `Categories:\n${categoryList}\n\nReply to classify:\n"""\n${messageText}\n"""`;

  const completion = await client.chat(system, user, { jsonMode: true, maxTokens: 200 });
  const parsed = JSON.parse(completion.text);

  if (!parsed.categoryId || typeof parsed.confidence !== "number") return null;
  if (parsed.confidence < CONFIDENCE_THRESHOLD) return null;
  if (!categories.some((c) => c.id === parsed.categoryId)) return null; // guard against a hallucinated id

  return { categoryId: parsed.categoryId, confidence: parsed.confidence };
}
```

---

## Component 4: Wiring into the Inbound Webhook

**Files:**
- Modify: `server/src/services/processInboundMessage.ts`

After the existing `processed: true` update, add:

1. Resolve the `Lead` for this `InboundMessage` (via `Conversation.unipileChatId === msg.threadId`, then `conversation.leadId`). If no matching conversation/lead is found, log and return — nothing to classify against.
2. Load active `ReplyCategory` rows.
3. Call `classifyReply(groqClient, msg.content, categories)`.
4. Always insert one `ReplyClassificationEvent` (`source: "AUTO"`, `categoryId` or `null`, `confidence` or `null`).
5. Decide whether to update `Lead`:
   - Result is confident (`categoryId` present) → update `Lead.replyCategoryId`, `replyClassificationSource = "AUTO"`, `replyClassifiedAt = now()`.
   - Result is `null` (unclassified) → update `Lead` the same way (clearing to "Unclassified") **only if** the lead's current `replyClassificationSource` is `AUTO` or `null`. If it's `MANUAL`, skip the `Lead` update — the override survives.
6. Wrap steps 2–5 in the same fire-and-forget try/catch this file already has — classification failure must never throw past this stub, matching its existing error-isolation contract.

---

## Component 5: Reply Category CRUD API

**Files:**
- Create: `server/src/routes/replyCategories.routes.ts`
- Modify: `server/src/app.ts` (or wherever routers are mounted — mount at `/api/reply-categories`)

Structurally identical to `faq.routes.ts`'s CRUD section (Zod schemas, `asyncHandler`, `ApiError`):

- `GET /api/reply-categories` — list all active categories, any authenticated role (needed for the override dropdown).
- `GET /api/reply-categories/:id`
- `POST /api/reply-categories` — owner only — body `{ groupName, name, description }`.
- `PATCH /api/reply-categories/:id` — owner only — any subset of `{ groupName, name, description, isActive }`.
- `DELETE /api/reply-categories/:id` — owner only — hard delete.

---

## Component 6: Manual Override

**Files:**
- Modify: `server/src/routes/lead.routes.ts` (the existing `PATCH /api/leads/:id` handler)

Extend the handler's Zod schema with one more optional, nullable field:

```ts
replyCategoryId: z.string().uuid().nullable().optional()
```

When the key is present in the request body (distinguishing "not sent" from "explicitly set to null," the same way this handler already treats other nullable fields — see the existing comment on nullable handling in that file), within the same transaction as the rest of the patch:

1. Update `Lead.replyCategoryId` to the given value (or `null` to explicitly clear back to Unclassified), `replyClassificationSource = "MANUAL"`, `replyClassifiedAt = now()`.
2. Insert one `ReplyClassificationEvent` with `source: "MANUAL"`, `changedByUserId: req.user!.id`, `confidence: null`, `categoryId` matching the new value.

No new endpoint, no new authorization rule — this reuses the handler's existing role/ownership checks (owner/recruiter/contractor-on-own-leads).

---

## Component 7: Owner Dashboard — Reply Category Manager

**Files:**
- Create: `client/src/routes/owner.reply-categories.tsx`
- Create: `client/src/components/dashboard/reply-category-manager.tsx`
- Modify: `client/src/lib/api.ts` (add `listReplyCategories`, `createReplyCategory`, `updateReplyCategory`, `deleteReplyCategory`)

A near-clone of `owner.faqs.tsx` / `faq-manager.tsx`: fetches categories via TanStack Query, renders them grouped by `groupName` (the 6 doc sections as headers), with inline create/edit/delete forms for `groupName`, `name`, `description`. Owner-only route, same pattern as the FAQ manager's route guard.

---

## Component 8: Lead Classification Badge + Override Dropdown

**Files:**
- Modify: `client/src/components/features/conversations-page-view.tsx` (or wherever the lead card/header renders — same surface as the existing "Check FAQ" button)
- Modify: `client/src/lib/api.ts` (extend the lead-update call to accept `replyCategoryId`)

- A badge showing `lead.replyCategory?.name ?? "Unclassified"` (muted styling when unclassified).
- A dropdown next to it, populated from `GET /api/reply-categories`, that calls the extended `PATCH /api/leads/:id` with the selected `replyCategoryId` on change — this is the override control. Available to owner/recruiter/contractor-on-own-leads, matching the endpoint's existing rule.

---

## Testing Plan

- `server/src/lib/__tests__/replyClassifier.test.ts` — mocked `GroqClient`, table-driven cases covering a representative sample across all 6 doc groups, plus: empty category list → `null`; confidence below 0.65 → `null`; hallucinated/unknown `categoryId` → `null`.
- Extend `server/src/__tests__/webhook.test.ts` (or a new `processInboundMessage.test.ts`) to assert:
  - Confident result → `Lead` updated + one `AUTO` event logged.
  - Low-confidence result over a lead whose current source is `MANUAL` → `Lead` untouched, event still logged.
  - Low-confidence result over a lead whose current source is `AUTO`/unset → `Lead` cleared to Unclassified, event logged.
  - No matching conversation/lead for the inbound message → no crash, no event, message still marked `processed`.
- `server/src/routes/__tests__/replyCategories.routes.test.ts` — full CRUD + RBAC (owner-only mutations, any-role reads), mirroring `faq.routes.ts` test coverage.
- Extend the existing `PATCH /api/leads/:id` test file with the manual-override path: event written, `replyClassificationSource` flips to `MANUAL`, contractor-can't-edit-others'-leads rule still enforced against this new field too.

---

## Explicitly Out of Scope (this iteration)

- Automated routing or notifications triggered by category (flagged during brainstorming as a separate design effort — this app's roles don't map onto the doc's "Resources Team").
- Per-message classification history shown in the conversation thread UI (the event table exists for audit/debugging; no UI surfaces it yet beyond the current-state badge).
- Multi-label classification (a reply matching more than one category) — the classifier always picks a single best match.
- Non-English handling beyond "the LLM classifies it directly" — no explicit multilingual testing/tuning pass.
